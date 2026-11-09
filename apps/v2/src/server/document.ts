// RIT-115: キャラの設定資料。原本を R2 へ置き、1,200 字・200 字重ねで切って
// 断片を D1 と検索箱（Vectorize、bge-m3）へ載せる。1 キャラ 15 個まで。
import {
  countCharacterDocuments,
  deleteCharacterDocument,
  DOCUMENT_MAX_PER_CHARACTER,
  hashMemorySource,
  insertCharacterDocument,
  insertDocumentChunks,
  loadCharacterDocument,
  loadDocumentChunks,
  type V2Db,
} from "@v2/db";
import { extractText } from "unpdf";

import {
  embedMemoryText,
  memoryNamespace,
  memoryVectorId,
  memoryVectorReady,
  type MemoryVectorBindings,
} from "./memory-vector";

export const DOCUMENT_CHUNK_SIZE = 1_200;
export const DOCUMENT_CHUNK_OVERLAP = 200;

export class DocumentError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export type DocumentBucket = Pick<R2Bucket, "put" | "delete">;
export type DocumentVectorIndex = Pick<VectorizeIndex, "upsert" | "query" | "deleteByIds">;

export type DocumentBindings = MemoryVectorBindings & {
  BUCKET?: DocumentBucket;
  MEMORY_INDEX?: DocumentVectorIndex;
};

export const documentStorageReady = (
  env: DocumentBindings,
): env is DocumentBindings & { BUCKET: DocumentBucket } => Boolean(env.BUCKET);

export const documentVectorReady = (
  env: DocumentBindings,
): env is DocumentBindings & {
  AI: Pick<Ai, "run">;
  BUCKET: DocumentBucket;
  MEMORY_INDEX: DocumentVectorIndex;
} => memoryVectorReady(env) && Boolean(env.BUCKET && env.MEMORY_INDEX?.deleteByIds);

const normalizeText = (text: string): string => text.replace(/\r\n?/g, "\n").trim();

// 1,200 字ごとに切り、次の断片は末尾 200 字を重ねる。語の切れ目は句点・改行で合わせる。
export const chunkDocumentText = (text: string): string[] => {
  const normalized = normalizeText(text);
  if (!normalized) return [];
  const chunks: string[] = [];
  let start = 0;
  while (start < normalized.length) {
    let end = Math.min(start + DOCUMENT_CHUNK_SIZE, normalized.length);
    if (end < normalized.length) {
      const window = normalized.slice(start, end);
      const breakAt = Math.max(window.lastIndexOf("。"), window.lastIndexOf("\n"));
      if (breakAt > DOCUMENT_CHUNK_SIZE / 2) end = start + breakAt + 1;
    }
    chunks.push(normalized.slice(start, end).trim());
    if (end >= normalized.length) break;
    start = Math.max(end - DOCUMENT_CHUNK_OVERLAP, start + 1);
  }
  return chunks.filter(Boolean);
};

const TXT_TYPES = new Set(["text/plain", "text/markdown", "text/x-markdown"]);

export const extractDocumentText = async (bytes: Uint8Array, mime: string): Promise<string> => {
  if (TXT_TYPES.has(mime) || /\.(txt|md)$/i.test(mime)) {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  }
  if (mime === "application/pdf" || /\.pdf$/i.test(mime)) {
    // 鍵つき・画像だけの PDF は unpdf が空や例外を返すので、そのまま 422 に写す。
    try {
      const { text } = await extractText(bytes, { mergePages: true });
      const body = normalizeText(Array.isArray(text) ? text.join("\n") : text);
      if (!body) throw new Error("empty");
      return body;
    } catch {
      throw new DocumentError(
        422,
        "PDF から文字を抜けませんでした。鍵つき・画像だけの PDF は読めません。",
      );
    }
  }
  throw new DocumentError(415, "対応しているのは TXT / Markdown / PDF だけです。");
};

const documentR2Key = (characterId: string, documentId: string): string =>
  `v2-docs/${characterId}/${documentId}`;

export type UploadedDocument = {
  id: string;
  title: string;
  mime: string;
  byteSize: number;
  chunkCount: number;
};

export const uploadCharacterDocument = async (
  db: V2Db,
  env: DocumentBindings,
  input: {
    userId: string;
    characterId: string;
    title: string;
    mime: string;
    bytes: Uint8Array;
  },
): Promise<UploadedDocument> => {
  if (!documentStorageReady(env)) {
    throw new DocumentError(503, "資料の置き場（R2）がつながっていません。");
  }
  const count = await countCharacterDocuments(db, input.characterId, input.userId);
  if (count >= DOCUMENT_MAX_PER_CHARACTER) {
    throw new DocumentError(409, "資料は 1 キャラ 15 個までです。");
  }
  const text = await extractDocumentText(input.bytes, input.mime);
  const chunks = chunkDocumentText(text);
  if (chunks.length === 0) {
    throw new DocumentError(422, "本文が空です。");
  }
  const id = crypto.randomUUID();
  const r2Key = documentR2Key(input.characterId, id);
  await env.BUCKET.put(r2Key, input.bytes, {
    httpMetadata: { contentType: input.mime },
  });
  await insertCharacterDocument(db, {
    id,
    userId: input.userId,
    characterId: input.characterId,
    title: input.title,
    r2Key,
    mime: input.mime,
    byteSize: input.bytes.byteLength,
    status: "active",
    createdAt: Date.now(),
  });
  const chunkRows: {
    id: string;
    documentId: string;
    seq: number;
    content: string;
    vectorId: string;
  }[] = [];
  for (const [seq, content] of chunks.entries()) {
    const chunkId = `${id}:${seq}`;
    chunkRows.push({
      id: chunkId,
      documentId: id,
      seq,
      content,
      vectorId: await memoryVectorId(chunkId, await hashMemorySource(content)),
    });
  }
  await insertDocumentChunks(db, chunkRows);
  if (memoryVectorReady(env)) {
    for (const row of chunkRows) {
      const hash = await hashMemorySource(row.content);
      const values = await embedMemoryText(env.AI, row.content);
      await env.MEMORY_INDEX.upsert([
        {
          id: row.vectorId,
          values,
          namespace: await memoryNamespace(input),
          metadata: {
            kind: "doc_chunk",
            chunk_id: row.id,
            document_id: id,
            character_id: input.characterId,
            content_hash: hash,
          },
        },
      ]);
    }
  }
  return {
    id,
    title: input.title,
    mime: input.mime,
    byteSize: input.bytes.byteLength,
    chunkCount: chunks.length,
  };
};

export const deleteCharacterDocumentById = async (
  db: V2Db,
  env: DocumentBindings,
  documentId: string,
  userId: string,
): Promise<void> => {
  const document = await loadCharacterDocument(db, documentId, userId);
  if (!document) throw new DocumentError(404, "資料が見つかりません。");
  const chunks = await loadDocumentChunks(db, documentId);
  if (env.MEMORY_INDEX?.deleteByIds && chunks.length > 0) {
    try {
      await env.MEMORY_INDEX.deleteByIds(chunks.map((chunk) => chunk.vectorId));
    } catch {
      globalThis.console.error(
        JSON.stringify({ event: "document_vector_delete_failed", documentId }),
      );
    }
  }
  await deleteCharacterDocument(db, documentId, userId);
  if (env.BUCKET) {
    try {
      await env.BUCKET.delete(document.r2Key);
    } catch {
      globalThis.console.error(JSON.stringify({ event: "document_r2_delete_failed", documentId }));
    }
  }
};
