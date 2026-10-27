import { z } from "zod";

import { extractDocumentPdf } from "./document-pdf";
import { DocumentSettingsSchema, type DocumentSource } from "./document-retrieval";

import type { DocumentRepository, DocumentScope, StoredDocument } from "@v2/db";

export const DOCUMENT_CHUNK_CHARS = 1200;
export const DOCUMENT_OVERLAP_CHARS = 200;
export const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;
export const MAX_DOCUMENT_CHARS = 200_000;
export const DEFAULT_DOCUMENT_BUDGET_CHARS = 2000;

const BudgetSchema = z.number().int().min(0).max(100_000);
const UploadSchema = z.object({
  name: z.string().trim().min(1).max(200),
  contentType: z.enum(["text/plain", "application/pdf"]),
  budgetChars: BudgetSchema.default(DEFAULT_DOCUMENT_BUDGET_CHARS),
});
const UpdateSchema = z
  .object({ enabled: z.boolean().optional(), budgetChars: BudgetSchema.optional() })
  .strict();

export class DocumentServiceError extends Error {
  readonly code: "invalid_document" | "document_limit" | "document_missing" | "storage_failure";
  readonly documentId?: string;
  constructor(
    code: "invalid_document" | "document_limit" | "document_missing" | "storage_failure",
    message: string,
    options?: ErrorOptions & { documentId?: string },
  ) {
    super(message, options);
    this.code = code;
    this.documentId = options?.documentId;
    this.name = "DocumentServiceError";
  }
}

export type DocumentBucket = {
  put: (
    key: string,
    bytes: Uint8Array,
    options: { httpMetadata: { contentType: string } },
  ) => Promise<{ key: string } | null>;
  delete: (key: string) => Promise<void>;
};

export type UploadDocumentInput = {
  name: string;
  contentType: string;
  bytes: Uint8Array;
  budgetChars?: number;
};

export const splitDocumentText = (text: string): string[] => {
  if (text.length === 0 || text.trim().length === 0) {
    throw new DocumentServiceError("invalid_document", "資料の文字数が対応範囲外です");
  }
  const chars: string[] = [];
  for (const char of text) {
    if (chars.length >= MAX_DOCUMENT_CHARS)
      throw new DocumentServiceError("invalid_document", "資料の文字数が対応範囲外です");
    chars.push(char);
  }
  const chunks: string[] = [];
  for (
    let start = 0;
    start < chars.length;
    start += DOCUMENT_CHUNK_CHARS - DOCUMENT_OVERLAP_CHARS
  ) {
    chunks.push(chars.slice(start, start + DOCUMENT_CHUNK_CHARS).join(""));
    if (start + DOCUMENT_CHUNK_CHARS >= chars.length) break;
  }
  return chunks;
};

const extractText = async (input: UploadDocumentInput): Promise<string> => {
  if (input.bytes.byteLength === 0 || input.bytes.byteLength > MAX_DOCUMENT_BYTES) {
    throw new DocumentServiceError("invalid_document", "資料のファイルサイズが対応範囲外です");
  }
  if (input.contentType === "application/pdf") return extractDocumentPdf(input.bytes);
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false })
      .decode(input.bytes)
      .replace(/^\uFEFF/u, "")
      .replace(/\r\n?/gu, "\n");
  } catch (cause) {
    throw new DocumentServiceError("invalid_document", "TXT は UTF-8 で読み込んでください", {
      cause,
    });
  }
};

export type DocumentService = ReturnType<typeof createDocumentService>;

export const createDocumentService = (deps: {
  repository: DocumentRepository;
  bucket: DocumentBucket;
  scope: DocumentScope;
  id?: () => string;
  now?: () => number;
}) => {
  const { repository, bucket, scope } = deps;
  const source: DocumentSource = {
    loadSettings: async (characterId) => {
      if (characterId !== scope.characterId) return { budgetChars: 0, documents: [] };
      return DocumentSettingsSchema.parse(await repository.loadSettings());
    },
    search: async (input) =>
      input.characterId === scope.characterId ? repository.search(input) : [],
  };

  const remove = async (id: string): Promise<void> => {
    const document = await repository.remove(id);
    if (!document) throw new DocumentServiceError("document_missing", "資料が見つかりません");
    try {
      await bucket.delete(document.objectKey);
    } catch (cause) {
      throw new DocumentServiceError(
        "storage_failure",
        "参照は停止しました。元資料の削除を再試行してください",
        { cause, documentId: id },
      );
    }
  };

  const rollback = async (id: string, key: string): Promise<void> => {
    // 索引の無効化を先に確定し、R2 の削除失敗で資料が参照へ戻らんようにする。
    try {
      await repository.remove(id);
    } finally {
      await bucket.delete(key);
    }
  };

  const upload = async (input: UploadDocumentInput): Promise<StoredDocument> => {
    const metadata = UploadSchema.parse(input);
    const chunks = splitDocumentText(await extractText(input));
    const id = (deps.id ?? (() => crypto.randomUUID()))();
    const key = ["v2", "document", scope.userId, scope.characterId, scope.worldlineId, id]
      .map(encodeURIComponent)
      .join("/");
    const reserved = await repository.reserve({
      ...metadata,
      id,
      objectKey: key,
      createdAt: (deps.now ?? Date.now)(),
    });
    if (!reserved) throw new DocumentServiceError("document_limit", "資料は1キャラ15個までです");
    try {
      const raw = await bucket.put(key, input.bytes, {
        httpMetadata: { contentType: metadata.contentType },
      });
      if (!raw || !(await repository.complete(id, chunks)))
        throw new Error("資料の索引を保存できませんでした");
    } catch (cause) {
      try {
        await rollback(id, key);
      } catch (cleanup) {
        throw new DocumentServiceError("storage_failure", "取り込みと後片付けに失敗しました", {
          cause: new AggregateError([cause, cleanup]),
          documentId: id,
        });
      }
      throw new DocumentServiceError("storage_failure", "資料の取り込みに失敗しました", { cause });
    }
    const saved = (await repository.list()).find((document) => document.id === id);
    if (!saved)
      throw new DocumentServiceError("document_missing", "取り込み後に資料が削除されました");
    return saved;
  };

  const update = async (
    id: string,
    patch: { enabled?: boolean; budgetChars?: number },
  ): Promise<StoredDocument> => {
    const saved = await repository.update(id, UpdateSchema.parse(patch));
    if (!saved) throw new DocumentServiceError("document_missing", "資料が見つかりません");
    return saved;
  };

  const setBudget = async (budgetChars: number): Promise<void> =>
    repository.setBudget(BudgetSchema.parse(budgetChars));
  return {
    source,
    list: repository.list,
    settings: () => source.loadSettings(scope.characterId),
    upload,
    update,
    remove,
    setBudget,
  };
};
