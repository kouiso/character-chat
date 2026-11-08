// RIT-115/116: キャラの設定資料の API。
// POST /api/characters/:id/documents（multipart: file + title）
// GET  同上（一覧）
// PATCH /api/characters/:id/documents/:docId（{status:"active"|"disabled"}）
// DELETE 同上
import {
  createDb,
  listCharacterDocuments,
  loadCharacterDocument,
  readCharacterDetail,
  setCharacterDocumentStatus,
} from "@v2/db";
import { z } from "zod";

import { deleteCharacterDocumentById, DocumentError, uploadCharacterDocument } from "./document";
import { LOCAL_USER_ID } from "./identity";
import { getPlatform } from "./platform";

const privateJson = (body: unknown, status = 200): Response =>
  Response.json(body, {
    status,
    headers: {
      "cache-control": "private, no-store",
      pragma: "no-cache",
      vary: "Authorization",
    },
  });

const message = (status: number, text: string): Response => privateJson({ message: text }, status);

// 別オリジンからの multipart 直叩きを弾く。origin / sec-fetch-site のどちらかが不審なら拒否。
const badOrigin = (request: Request): boolean => {
  const origin = request.headers.get("origin");
  try {
    if (origin && (new URL(origin).origin !== origin || origin !== new URL(request.url).origin)) {
      return true;
    }
  } catch {
    return true;
  }
  return request.headers.get("sec-fetch-site")?.toLowerCase() === "cross-site";
};

const requestError = (request: Request, mediaTypes: string[]): Response | null => {
  if (badOrigin(request)) return message(403, "リクエストを確認してください。");
  const mediaType = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  return mediaType && mediaTypes.includes(mediaType)
    ? null
    : message(415, "送信形式を確認してください。");
};

const handleError = (error: unknown): Response => {
  if (error instanceof DocumentError) return message(error.status, error.message);
  return message(503, "保存先を利用できません。再試行してください。");
};

const characterExists = async (db: ReturnType<typeof createDb>, characterId: string) => {
  const character = await readCharacterDetail(db, characterId, LOCAL_USER_ID);
  return Boolean(character);
};

const mimeFor = (file: File, fallback: string): string => {
  if (file.type) return file.type;
  if (/\.pdf$/i.test(file.name)) return "application/pdf";
  if (/\.md$/i.test(file.name)) return "text/markdown";
  return fallback;
};

const uploadFromForm = async (
  db: ReturnType<typeof createDb>,
  env: Awaited<ReturnType<typeof getPlatform>>["env"],
  characterId: string,
  request: Request,
): Promise<Response> => {
  const requestErrorResponse = requestError(request, ["multipart/form-data"]);
  if (requestErrorResponse) return requestErrorResponse;
  try {
    if (!(await characterExists(db, characterId))) {
      return message(404, "キャラクターが見つかりません。");
    }
    const form = await request.formData();
    const file = form.get("file");
    const title = form.get("title");
    if (!(file instanceof File) || file.size === 0) {
      return message(422, "資料のファイルを付けてください。");
    }
    if (file.size > 5 * 1024 * 1024) {
      return message(413, "資料は 5MB までです。");
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const uploaded = await uploadCharacterDocument(db, env, {
      userId: LOCAL_USER_ID,
      characterId,
      title:
        typeof title === "string" && title.trim()
          ? title.trim().slice(0, 120)
          : file.name.slice(0, 120),
      mime: mimeFor(file, "text/plain"),
      bytes,
    });
    return privateJson(uploaded, 201);
  } catch (error) {
    return handleError(error);
  }
};

export const handleDocumentsRequest = async (
  characterId: string,
  request: Request,
): Promise<Response> => {
  const { env } = await getPlatform();
  const db = createDb(env.DB);
  if (request.method === "GET") {
    const documents = await listCharacterDocuments(db, characterId, LOCAL_USER_ID);
    return privateJson({
      documents: documents.map(({ id, title, mime, byteSize, status, createdAt }) => ({
        id,
        title,
        mime,
        byteSize,
        status,
        createdAt,
      })),
    });
  }
  if (request.method !== "POST") return message(405, "この操作には対応していません。");
  return uploadFromForm(db, env, characterId, request);
};

const patchSchema = z.object({ status: z.enum(["active", "disabled"]) });

const removeDocument = async (
  db: ReturnType<typeof createDb>,
  env: Awaited<ReturnType<typeof getPlatform>>["env"],
  documentId: string,
  request: Request,
): Promise<Response> => {
  const requestErrorResponse = requestError(request, [
    "application/json",
    "application/octet-stream",
  ]);
  // DELETE は本体を持たん実装もあるので content-type 無しも通す。
  if (requestErrorResponse && request.headers.get("content-type")) {
    return requestErrorResponse;
  }
  try {
    await deleteCharacterDocumentById(db, env, documentId, LOCAL_USER_ID);
    return privateJson({ deleted: true });
  } catch (error) {
    return handleError(error);
  }
};

const patchDocument = async (
  db: ReturnType<typeof createDb>,
  documentId: string,
  request: Request,
): Promise<Response> => {
  const requestErrorResponse = requestError(request, ["application/json"]);
  if (requestErrorResponse) return requestErrorResponse;
  try {
    const body = patchSchema.safeParse(await request.json());
    if (!body.success) return message(422, "入力内容を確認してください。");
    const updated = await setCharacterDocumentStatus(
      db,
      documentId,
      LOCAL_USER_ID,
      body.data.status,
    );
    return updated
      ? privateJson({ id: documentId, status: body.data.status })
      : message(404, "資料が見つかりません。");
  } catch (error) {
    return handleError(error);
  }
};

export const handleDocumentRequest = async (
  characterId: string,
  documentId: string,
  request: Request,
): Promise<Response> => {
  if (request.method !== "DELETE" && request.method !== "PATCH") {
    return message(405, "この操作には対応していません。");
  }
  const { env } = await getPlatform();
  const db = createDb(env.DB);
  // 資料はURLのキャラに紐付くものだけ触れる。別キャラのIDを差されても404に倒す。
  const document = await loadCharacterDocument(db, documentId, LOCAL_USER_ID);
  if (!document || document.characterId !== characterId) {
    return message(404, "資料が見つかりません。");
  }
  return request.method === "DELETE"
    ? removeDocument(db, env, documentId, request)
    : patchDocument(db, documentId, request);
};
