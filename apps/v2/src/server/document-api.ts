import {
  DocumentPdfError,
  DocumentServiceError,
  MAX_DOCUMENT_BYTES,
  type DocumentService,
} from "@v2/engine";
import { z } from "zod";

import type { StoredDocument } from "@v2/db";

const EditSchema = z
  .object({
    documentId: z.string().min(1),
    enabled: z.boolean().optional(),
    budgetChars: z.number().int().min(0).max(100_000).optional(),
  })
  .strict();
const TotalBudgetSchema = z.object({ budgetChars: z.number().int().min(0).max(100_000) }).strict();
const DeleteSchema = z.object({ documentId: z.string().min(1) }).strict();
const MAX_REQUEST_BYTES = MAX_DOCUMENT_BYTES + 16_384;

const json = (status: number, body: unknown): Response =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

const noStore = (response: Response): Response => {
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

const foreignMutation = (request: Request): boolean => {
  if (!["POST", "PATCH", "DELETE"].includes(request.method)) return false;
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  return (
    (origin !== null && origin !== new URL(request.url).origin) ||
    (site !== null && site !== "same-origin" && site !== "none")
  );
};
const publicDocument = (document: StoredDocument) => ({
  id: document.id,
  characterId: document.characterId,
  worldlineId: document.worldlineId,
  name: document.name,
  contentType: document.contentType,
  enabled: document.enabled,
  budgetChars: document.budgetChars,
  createdAt: document.createdAt,
  status: document.status,
});

const readLimitedBody = async (request: Request): Promise<Uint8Array<ArrayBuffer>> => {
  if (!request.body) throw new DocumentServiceError("invalid_document", "資料がありません");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_REQUEST_BYTES) {
        await reader.cancel();
        throw new DocumentServiceError("invalid_document", "リクエストが大きすぎます");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
};

const upload = async (service: DocumentService, request: Request): Promise<Response> => {
  const bytes = await readLimitedBody(request);
  const form = await new Response(bytes, {
    headers: { "content-type": request.headers.get("content-type") ?? "" },
  }).formData();
  const file: unknown = form.get("file");
  if (!(file instanceof File))
    return json(400, { code: "invalid_document", message: "file がありません" });
  const rawBudget = form.get("budgetChars");
  const budgetChars =
    rawBudget === null ? undefined : z.coerce.number().int().min(0).max(100_000).parse(rawBudget);
  const document = await service.upload({
    name: file.name,
    contentType: file.type,
    bytes: new Uint8Array(await file.arrayBuffer()),
    budgetChars,
  });
  return json(201, { document: publicDocument(document) });
};

const errorResponse = (error: unknown): Response => {
  if (error instanceof z.ZodError || error instanceof SyntaxError || error instanceof TypeError) {
    return json(400, { code: "invalid_document", message: "資料の入力を確認してください" });
  }
  if (error instanceof DocumentPdfError) {
    const messages = {
      invalid_pdf: "PDF の内容を確認してください",
      encrypted_pdf: "鍵付き PDF は取り込めません",
      image_only_pdf: "文字のない PDF は取り込めません。TXT を使ってください",
      unsupported_pdf: "この PDF 形式は未対応です。TXT を使ってください",
      pdf_too_large: "PDF は 2 MiB 以下にしてください",
    };
    return json(422, { code: error.code, message: messages[error.code] });
  }
  if (error instanceof DocumentServiceError) {
    const statuses = {
      invalid_document: 400,
      document_limit: 409,
      document_missing: 404,
      storage_failure: 503,
    };
    return json(statuses[error.code], {
      code: error.code,
      message: error.message,
      documentId: error.documentId,
    });
  }
  return json(503, { code: "document_unavailable", message: "資料の操作を再試行してください" });
};

const edit = async (service: DocumentService, request: Request): Promise<Response> => {
  const payload: unknown = await new Response(await readLimitedBody(request)).json();
  const total = TotalBudgetSchema.safeParse(payload);
  if (total.success) {
    await service.setBudget(total.data.budgetChars);
    return json(200, { settings: await service.settings() });
  }
  const { documentId, ...patch } = EditSchema.parse(payload);
  if (patch.enabled === undefined && patch.budgetChars === undefined)
    return json(400, { code: "invalid_document" });
  return json(200, { document: publicDocument(await service.update(documentId, patch)) });
};

// 認証担当の resolver がリクエストごとに所有者を検証し、所有者・キャラに固定した service を渡す。
export const createDocumentRequestHandler =
  (resolve: (request: Request, characterId: string) => Promise<DocumentService | Response>) =>
  async (characterId: string, request: Request): Promise<Response> => {
    try {
      // BASIC資格情報はブラウザが付けるため、別サイトのform投稿を認可へ進めない。
      if (foreignMutation(request))
        return json(403, {
          code: "origin_mismatch",
          message: "同じ画面から操作をやり直してください",
        });
      const resolved = await resolve(request, characterId);
      if (resolved instanceof Response) return noStore(resolved);
      switch (request.method) {
        case "GET":
          return json(200, {
            documents: (await resolved.list()).map(publicDocument),
            settings: await resolved.settings(),
          });
        case "POST":
          return await upload(resolved, request);
        case "PATCH":
          return await edit(resolved, request);
        case "DELETE": {
          const { documentId } = DeleteSchema.parse(
            await new Response(await readLimitedBody(request)).json(),
          );
          await resolved.remove(documentId);
          return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
        }
        default:
          return new Response(null, {
            status: 405,
            headers: { allow: "GET, POST, PATCH, DELETE", "cache-control": "no-store" },
          });
      }
    } catch (error) {
      return errorResponse(error);
    }
  };
