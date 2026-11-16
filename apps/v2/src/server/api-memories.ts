// 記憶の手直し API（RIT-92）＋削除・復元（RIT-94）。消すは論理削除→復元窓→物理削除、
// 墓標・要約の伏せ直し待ち・検索箱の点・Queue の仕事まで 3 か所を揃える。
// D1 が正本で、Vectorize は内容が変わる操作の度に追従させる。vector 側の失敗は
// 記憶そのものの保存を妨げん（次の retrieval で D1 側が検証する）。
import {
  createDb,
  deleteMemory,
  describeError,
  findLatestConversationId,
  hashMemorySource,
  insertManualMemory,
  listCharacterMemories,
  loadOwnedMemory,
  restoreMemory,
  setMemoryPinned,
  storeEditedEmbedding,
  updateMemoryContent,
  MemoryAccessError,
  type MemoryRow,
} from "@v2/db";
import { z } from "zod";

import { LOCAL_USER_ID } from "./identity";
import { dropMemoryVector, purgeExpiredMemories } from "./memory-purge";
import {
  embedMemoryText,
  memoryNamespace,
  memoryVectorId,
  memoryVectorReady,
  type MemoryVectorBindings,
} from "./memory-vector";
import { reportFailure } from "./log";
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
  } catch (error) {
    reportFailure(env, {
      event: "memory_manual_index_failed",
      level: "error",
      reason: describeError(error),
    });
  }
};

// 伏せ直しの仕事を Queue へ。体は { type, conversationId } だけで、本文は入れん（NFR-2）。
// Queue が無い環境（既定の vars の開発）では送らん — 要約は伏せ直し待ちのまま指示文に入らん。
const enqueueSummaryRedact = async (
  env: { MEMORY_QUEUE?: Pick<Queue, "send"> },
  conversationId: string,
): Promise<void> => {
  if (!env.MEMORY_QUEUE) return;
  try {
    await env.MEMORY_QUEUE.send({ type: "summary_redact", conversationId });
  } catch (error) {
    reportFailure(env, {
      event: "summary_redact_publish_failed",
      level: "error",
      reason: describeError(error),
    });
  }
};

const handleError = (error: unknown): Response => {
  if (error instanceof MemoryAccessError) {
    return message(404, "会話または記憶が見つかりません。");
  }
  return message(503, "保存先を利用できません。再試行してください。");
};

type MemoryDb = Awaited<ReturnType<typeof createDb>>;
type MemoryScope = { userId: string; characterId: string };
type MemoryEnv = MemoryVectorBindings & { MEMORY_QUEUE?: Pick<Queue, "send"> };
type MemoryContext = { database: MemoryDb; env: MemoryEnv; scope: MemoryScope };

const NOT_FOUND_MESSAGE = "会話または記憶が見つかりません。";

// 会話の記憶 API の始めに、復元窓を過ぎた論理削除行を物理削除する（RIT-94 FR-7）。
// 失敗しても要求は止めん — 掃除は次の要求でまた走る。
const purgeExpired = async (context: MemoryContext): Promise<void> => {
  try {
    await purgeExpiredMemories(context.database, context.env, context.scope);
  } catch (error) {
    reportFailure(context.env, {
      event: "memory_purge_failed",
      level: "error",
      reason: describeError(error),
    });
  }
};

const handlePost = async (context: MemoryContext, request: Request): Promise<Response> => {
  await purgeExpired(context);
  const { database, env, scope } = context;
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
};

// 本文を差し替えたら古い vector を捨て、差し替え後の本文で索引し直す。
// 旧本文は墓標へ入ったので要約も伏せ直す（FR-8）。対象が無ければ false。
const replaceMemoryContent = async (
  { database, env, scope }: MemoryContext,
  memoryId: string,
  content: string,
): Promise<boolean> => {
  const updated = await updateMemoryContent(database, scope, memoryId, content);
  if (updated === null) return false;
  await dropMemoryVector(env, memoryId, updated.previous);
  const current = await loadOwnedMemory(database, scope, memoryId);
  if (current) await indexMemoryContent(database, env, scope, current);
  await enqueueSummaryRedact(env, updated.conversationId);
  return true;
};

const handlePatch = async (context: MemoryContext, request: Request): Promise<Response> => {
  await purgeExpired(context);
  const { database, scope } = context;
  const payload = await readBody(request, patchSchema);
  if (payload instanceof Response) return payload;
  if (
    payload.content !== undefined &&
    !(await replaceMemoryContent(context, payload.memoryId, payload.content))
  ) {
    return message(404, NOT_FOUND_MESSAGE);
  }
  if (
    payload.pinned !== undefined &&
    !(await setMemoryPinned(database, scope, payload.memoryId, payload.pinned))
  ) {
    return message(404, NOT_FOUND_MESSAGE);
  }
  const memory = await loadOwnedMemory(database, scope, payload.memoryId);
  return memory ? privateJson({ memory }) : message(404, NOT_FOUND_MESSAGE);
};

const handleDelete = async (context: MemoryContext, request: Request): Promise<Response> => {
  await purgeExpired(context);
  const { database, env, scope } = context;
  const payload = await readBody(request, deleteSchema);
  if (payload instanceof Response) return payload;
  const deleted = await deleteMemory(database, scope, payload.memoryId);
  if (deleted === null) return message(404, NOT_FOUND_MESSAGE);
  // 本体に加えて掃討された旧要約行の vector も消す（RIT-94 の3か所）。
  // 検索箱の失敗は中で握りつぶす（FR-9。読む道が D1 で除くので残り点は使われん）。
  for (const row of deleted.rows) {
    await dropMemoryVector(env, row.id, row.content);
  }
  await enqueueSummaryRedact(env, deleted.conversationId);
  return privateJson({ ok: true, deletedAt: deleted.deletedAt });
};

// 復元: 削除から 30 秒以内なら deleted_at を外し墓標を消し、検索箱へ入れ直す。
// 窓切れ・物理削除済みは 410。削除されとらん・無い・他人は 404。
const handleRestore = async (context: MemoryContext, request: Request): Promise<Response> => {
  const { database, env, scope } = context;
  const payload = await readBody(request, deleteSchema);
  if (payload instanceof Response) return payload;
  const result = await restoreMemory(database, scope, payload.memoryId);
  // 窓切れの行はここで物理削除してから 410 を返す（次の要求では 404 になる）。
  if (result === "expired") {
    await purgeExpired(context);
    return message(410, "restore_expired");
  }
  await purgeExpired(context);
  if (!result) return message(404, NOT_FOUND_MESSAGE);
  await indexMemoryContent(database, env, scope, result);
  return privateJson({ memory: result });
};

const MUTATION_HANDLERS = new Map<
  string,
  (context: MemoryContext, request: Request) => Promise<Response>
>([
  ["POST", handlePost],
  ["PATCH", handlePatch],
  ["DELETE", handleDelete],
]);

const resolveContext = async (characterId: string): Promise<MemoryContext | Response> => {
  const parsedId = idSchema.safeParse(characterId);
  if (!parsedId.success) return message(422, "入力内容を確認してください。");
  const scope = { userId: LOCAL_USER_ID, characterId: parsedId.data };
  const { env } = await getPlatform();
  return { database: createDb(env.DB), env, scope };
};

export const handleMemoriesRequest = async (
  characterId: string,
  request: Request,
): Promise<Response> => {
  try {
    const context = await resolveContext(characterId);
    if (context instanceof Response) return context;

    if (request.method === "GET") {
      await purgeExpired(context);
      return privateJson({
        memories: await listCharacterMemories(context.database, context.scope),
      });
    }

    const requestError = mutationRequestError(request);
    if (requestError) return requestError;

    const handler = MUTATION_HANDLERS.get(request.method);
    if (!handler) return message(405, "この操作には対応していません。");
    return await handler(context, request);
  } catch (error) {
    return handleError(error);
  }
};

export const handleMemoriesRestoreRequest = async (
  characterId: string,
  request: Request,
): Promise<Response> => {
  try {
    if (request.method !== "POST") return message(405, "この操作には対応していません。");
    const requestError = mutationRequestError(request);
    if (requestError) return requestError;
    const context = await resolveContext(characterId);
    if (context instanceof Response) return context;
    return await handleRestore(context, request);
  } catch (error) {
    return handleError(error);
  }
};
