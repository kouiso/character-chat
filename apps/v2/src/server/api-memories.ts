// 記憶の手直し API（RIT-92）。見る・直す・消す・固定・手で足す。
// D1 が正本で、Vectorize は内容が変わる操作の度に追従させる。vector 側の失敗は
// 記憶そのものの保存を妨げん（次の retrieval で D1 側が検証する）。
import {
  createDb,
  deleteMemory,
  findLatestConversationId,
  hashMemorySource,
  insertManualMemory,
  listCharacterMemories,
  loadOwnedMemory,
  setMemoryPinned,
  storeEditedEmbedding,
  updateMemoryContent,
  MemoryAccessError,
  type MemoryRow,
} from "@v2/db";
import { z } from "zod";

import { LOCAL_USER_ID } from "./identity";
import {
  embedMemoryText,
  memoryNamespace,
  memoryVectorId,
  memoryVectorReady,
  type MemoryVectorBindings,
} from "./memory-vector";
import { getPlatform } from "./platform";

const idSchema = z.string().min(1).max(120);
const contentSchema = z.string().min(1).max(4000);
const postSchema = z.object({
  conversationId: idSchema.optional(),
  content: contentSchema,
  kind: z.enum(["fact", "preference"]).default("fact"),
});
const patchSchema = z
  .object({
    memoryId: idSchema,
    content: contentSchema.optional(),
    pinned: z.boolean().optional(),
  })
  .refine((value) => value.content !== undefined || value.pinned !== undefined, {
    message: "content か pinned が要ります。",
  });
const deleteSchema = z.object({ memoryId: idSchema });

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

const readBody = async <T>(
  request: Request,
  schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } },
): Promise<T | Response> => {
  const raw = await parseJson(request);
  if (raw instanceof Response) return raw;
  const parsed = schema.safeParse(raw);
  return parsed.success ? parsed.data : message(422, "入力内容を確認してください。");
};

// 記憶が変わる操作のあと vector index を追従させる。失敗しても D1 は正本のまま残る。
const indexMemoryContent = async (
  db: Awaited<ReturnType<typeof createDb>>,
  env: MemoryVectorBindings,
  scope: { userId: string; characterId: string },
  memory: MemoryRow,
): Promise<void> => {
  if (!memoryVectorReady(env)) return;
  try {
    const values = await embedMemoryText(env.AI, memory.content);
    const hash = await hashMemorySource(memory.content);
    await env.MEMORY_INDEX.upsert([
      {
        id: await memoryVectorId(memory.id, hash),
        namespace: await memoryNamespace(scope),
        values,
        metadata: {
          memory_id: memory.id,
          content_hash: hash,
          kind: memory.kind,
          conversation_id: memory.conversationId,
        },
      },
    ]);
    await storeEditedEmbedding(db, memory.id, memory.content, values);
  } catch {
    globalThis.console.error(JSON.stringify({ event: "memory_manual_index_failed" }));
  }
};

const dropMemoryVector = async (
  env: MemoryVectorBindings,
  memoryId: string,
  content: string,
): Promise<void> => {
  if (!memoryVectorReady(env)) return;
  try {
    const hash = await hashMemorySource(content);
    await env.MEMORY_INDEX.deleteByIds?.([await memoryVectorId(memoryId, hash)]);
  } catch {
    globalThis.console.error(JSON.stringify({ event: "memory_vector_drop_failed" }));
  }
};

const handleError = (error: unknown): Response => {
  if (error instanceof MemoryAccessError) {
    return message(404, "会話または記憶が見つかりません。");
  }
  return message(503, "保存先を利用できません。再試行してください。");
};

export const handleMemoriesRequest = async (
  characterId: string,
  request: Request,
): Promise<Response> => {
  const parsedId = idSchema.safeParse(characterId);
  if (!parsedId.success) return message(422, "入力内容を確認してください。");
  const scope = { userId: LOCAL_USER_ID, characterId: parsedId.data };

  try {
    const { env } = await getPlatform();
    const database = createDb(env.DB);

    if (request.method === "GET") {
      return privateJson({ memories: await listCharacterMemories(database, scope) });
    }

    const requestError = mutationRequestError(request);
    if (requestError) return requestError;

    if (request.method === "POST") {
      const payload = await readBody(request, postSchema);
      if (payload instanceof Response) return payload;
      // 会話の指定が無ければ直近の会話に紐付ける（記憶の検索は会話単位なので）
      const conversationId =
        payload.conversationId ?? (await findLatestConversationId(database, scope));
      if (!conversationId) {
        return message(409, "会話が始まってから記憶を追加できます。");
      }
      const memory = await insertManualMemory(database, { ...scope, conversationId }, payload);
      if (!memory) {
        return message(409, "会話が始まってから記憶を追加できます。");
      }
      await indexMemoryContent(database, env, scope, memory);
      return privateJson({ memory }, 201);
    }

    if (request.method === "PATCH") {
      const payload = await readBody(request, patchSchema);
      if (payload instanceof Response) return payload;
      if (payload.content !== undefined) {
        const previous = await updateMemoryContent(
          database,
          scope,
          payload.memoryId,
          payload.content,
        );
        if (previous === null) return message(404, "会話または記憶が見つかりません。");
        await dropMemoryVector(env, payload.memoryId, previous);
        const current = await loadOwnedMemory(database, scope, payload.memoryId);
        if (current) await indexMemoryContent(database, env, scope, current);
      }
      if (payload.pinned !== undefined) {
        const ok = await setMemoryPinned(database, scope, payload.memoryId, payload.pinned);
        if (!ok) return message(404, "会話または記憶が見つかりません。");
      }
      const memory = await loadOwnedMemory(database, scope, payload.memoryId);
      return memory ? privateJson({ memory }) : message(404, "会話または記憶が見つかりません。");
    }

    if (request.method === "DELETE") {
      const payload = await readBody(request, deleteSchema);
      if (payload instanceof Response) return payload;
      const deleted = await deleteMemory(database, scope, payload.memoryId);
      if (deleted === null) return message(404, "会話または記憶が見つかりません。");
      // 本体に加えて掃討された要約の vector も消す（RIT-94 の3か所）
      for (const row of deleted) {
        await dropMemoryVector(env, row.id, row.content);
      }
      return privateJson({ ok: true });
    }

    return message(405, "この操作には対応していません。");
  } catch (error) {
    return handleError(error);
  }
};
