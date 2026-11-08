import {
  CharacterConflictError,
  CharacterVersionNotFoundError,
  characterContentSchema,
  createCharacterWithVersion,
  createDb,
  ensureLocalUser,
  listCharacterVersions,
  readCharacterDetail,
  readCharacterVersion,
  restoreCharacterVersion,
  updateCharacterWithVersion,
} from "@v2/db";
import { z } from "zod";

import { LOCAL_USER_ID } from "./identity";
import { getPlatform } from "./platform";

const idSchema = z.string().min(1).max(120);
const revisionSchema = z.number().int().nonnegative();
const updateSchema = z.object({
  expectedRevision: revisionSchema,
  content: z.unknown(),
});
const restoreSchema = z.object({
  versionId: idSchema,
  expectedRevision: revisionSchema,
});

type RequestSchema<T> = {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
};

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

const mutationRequestError = (request: Request): Response | null => {
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      if (new URL(origin).origin !== origin || origin !== new URL(request.url).origin) {
        return message(403, "リクエストを確認してください。");
      }
    } catch {
      return message(403, "リクエストを確認してください。");
    }
  }
  if (request.headers.get("sec-fetch-site")?.toLowerCase() === "cross-site") {
    return message(403, "リクエストを確認してください。");
  }
  const mediaType = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  return mediaType === "application/json" ? null : message(415, "JSON形式で送信してください。");
};

const parseJson = async (request: Request): Promise<unknown | Response> => {
  try {
    return await request.json();
  } catch {
    return message(422, "入力内容を確認してください。");
  }
};

const readBody = async <T>(request: Request, schema: RequestSchema<T>): Promise<T | Response> => {
  const raw = await parseJson(request);
  if (raw instanceof Response) return raw;
  const parsed = schema.safeParse(raw);
  return parsed.success ? parsed.data : message(422, "入力内容を確認してください。");
};

const handleError = (error: unknown): Response => {
  if (error instanceof CharacterConflictError) {
    return message(409, "別の画面で変更されています。最新の内容を読み直してください。");
  }
  if (error instanceof CharacterVersionNotFoundError) {
    return message(404, "キャラクターまたは指定された版が見つかりません。");
  }
  return message(503, "保存先を利用できません。再試行してください。");
};

const db = async () => {
  const { env } = await getPlatform();
  return createDb(env.DB);
};

export const handleCharactersRequest = async (request: Request): Promise<Response> => {
  if (request.method !== "POST") return message(405, "この操作には対応していません。");
  const requestError = mutationRequestError(request);
  if (requestError) return requestError;
  const content = await readBody(request, characterContentSchema);
  if (content instanceof Response) return content;
  try {
    const database = await db();
    await ensureLocalUser(database);
    const result = await createCharacterWithVersion(database, LOCAL_USER_ID, content);
    return privateJson(result, 201);
  } catch (error) {
    return handleError(error);
  }
};

export const handleCharacterRequest = async (id: string, request: Request): Promise<Response> => {
  const parsedId = idSchema.safeParse(id);
  if (!parsedId.success) return message(422, "入力内容を確認してください。");
  try {
    const database = await db();
    if (request.method === "GET") {
      const result = await readCharacterDetail(database, parsedId.data, LOCAL_USER_ID);
      return result
        ? privateJson(result)
        : message(404, "キャラクターまたは指定された版が見つかりません。");
    }
    if (request.method === "PUT") {
      const requestError = mutationRequestError(request);
      if (requestError) return requestError;
      const payload = await readBody(request, updateSchema);
      if (payload instanceof Response) return payload;
      const content = characterContentSchema.safeParse(payload.content);
      if (!content.success) return message(422, "入力内容を確認してください。");
      const result = await updateCharacterWithVersion(database, {
        id: parsedId.data,
        userId: LOCAL_USER_ID,
        expectedRevision: payload.expectedRevision,
        content: content.data,
      });
      return result
        ? privateJson({ id: parsedId.data, ...result })
        : message(404, "キャラクターまたは指定された版が見つかりません。");
    }
    return message(405, "この操作には対応していません。");
  } catch (error) {
    return handleError(error);
  }
};

export const handleCharacterVersionsRequest = async (
  id: string,
  request: Request,
): Promise<Response> => {
  if (request.method !== "GET") return message(405, "この操作には対応していません。");
  const parsedId = idSchema.safeParse(id);
  if (!parsedId.success) return message(422, "入力内容を確認してください。");
  try {
    const result = await listCharacterVersions(await db(), parsedId.data, LOCAL_USER_ID);
    return result
      ? privateJson(result)
      : message(404, "キャラクターまたは指定された版が見つかりません。");
  } catch (error) {
    return handleError(error);
  }
};

export const handleCharacterVersionRequest = async (
  id: string,
  versionId: string,
  request: Request,
): Promise<Response> => {
  if (request.method !== "GET") return message(405, "この操作には対応していません。");
  const parsed = z.object({ id: idSchema, versionId: idSchema }).safeParse({ id, versionId });
  if (!parsed.success) return message(422, "入力内容を確認してください。");
  try {
    const result = await readCharacterVersion(await db(), {
      characterId: parsed.data.id,
      versionId: parsed.data.versionId,
      userId: LOCAL_USER_ID,
    });
    return result
      ? privateJson(result)
      : message(404, "キャラクターまたは指定された版が見つかりません。");
  } catch (error) {
    return handleError(error);
  }
};

export const handleCharacterRestoreRequest = async (
  id: string,
  request: Request,
): Promise<Response> => {
  if (request.method !== "POST") return message(405, "この操作には対応していません。");
  const parsedId = idSchema.safeParse(id);
  if (!parsedId.success) return message(422, "入力内容を確認してください。");
  const requestError = mutationRequestError(request);
  if (requestError) return requestError;
  const payload = await readBody(request, restoreSchema);
  if (payload instanceof Response) return payload;
  try {
    const result = await restoreCharacterVersion(await db(), {
      id: parsedId.data,
      userId: LOCAL_USER_ID,
      ...payload,
    });
    return privateJson({ id: parsedId.data, ...result });
  } catch (error) {
    return handleError(error);
  }
};
