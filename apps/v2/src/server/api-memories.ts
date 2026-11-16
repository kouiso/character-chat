// 記憶の手直し API（RIT-92）＋削除・復元（RIT-94）＋「覚えた」問い合わせ。
// D1 が正本で、Vectorize は内容が変わる操作の度に追従させる。vector 側の失敗は
// 記憶そのものの保存を妨げん（次の retrieval で D1 側が検証する）。
import {
  createDb,
  deleteMemory,
  describeError,
  findLatestConversationId,
  hashMemorySource,
  insertManualMemory,
  listConversationMemories,
  loadCharacterName,
  loadLastTurnUsedMemoryIds,
  loadLearnedMemories,
  loadMemoryJobStatesForTurn,
  loadOwnedConversation,
  resolveMemoryLearnedState,
  restoreMemory,
  storeEditedEmbedding,
  updateMemory,
  MemoryAccessError,
  type MemoryCategory,
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
const categorySchema = z.enum(["long", "recent", "relation", "future"]);
const postSchema = z.object({
  // 省略時は直近の会話へ。会話そのものが無い時は 409 conversation_not_started。
  conversationId: idSchema.optional(),
  content: z.string().trim().min(1).max(500),
  category: categorySchema.default("long"),
  kind: z.enum(["fact", "preference"]).default("fact"),
});
const patchSchema = z
  .object({
    memoryId: idSchema,
    expectedRevision: z.number().int().min(1),
    content: z.string().trim().min(1).max(500).optional(),
    category: categorySchema.optional(),
    pinned: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.content !== undefined || value.category !== undefined || value.pinned !== undefined,
    { message: "content か category か pinned が要ります。" },
  );
const deleteSchema = z.object({ memoryId: idSchema });
const learnedQuerySchema = z.object({
  conversationId: idSchema,
  turn: z.coerce.number().int().min(1),
});

// 応答の記憶の形（RIT-92 の MemoryView）。subject・sourceTurn は画面に出さん。
type MemoryView = {
  id: string;
  conversationId: string;
  kind: "fact" | "summary" | "preference";
  category: MemoryCategory;
  content: string;
  pinned: boolean;
  origin: "extracted" | "manual";
  editedAt: number | null;
  createdAt: number;
  supersededBy: string | null;
  usedInLastReply: boolean;
  revision: number;
};

const toView = (row: MemoryRow, used: Set<string>): MemoryView => ({
  id: row.id,
  conversationId: row.conversationId,
  kind: row.kind,
  category: row.category,
  content: row.content,
  pinned: row.pinned,
  origin: row.origin,
  editedAt: row.editedAt,
  createdAt: row.createdAt,
  supersededBy: row.supersededBy,
  usedInLastReply: used.has(row.id),
  revision: row.revision,
});

const privateJson = (body: unknown, status = 200): Response =>
  Response.json(body, {
    status,
    headers: {
      "cache-control": "private, no-store",
      pragma: "no-cache",
      vary: "Authorization",
    },
  });

const fail = (status: number, code: string, text: string): Response =>
  privateJson({ code, message: text }, status);

const mutationRequestError = (request: Request): Response | null => {
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      if (new URL(origin).origin !== origin || origin !== new URL(request.url).origin) {
        return fail(403, "forbidden", "リクエストを確認してください。");
      }
    } catch {
      return fail(403, "forbidden", "リクエストを確認してください。");
    }
  }
  if (request.headers.get("sec-fetch-site")?.toLowerCase() === "cross-site") {
    return fail(403, "forbidden", "リクエストを確認してください。");
  }
  const mediaType = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  return mediaType === "application/json"
    ? null
    : fail(415, "unsupported_media_type", "JSON形式で送信してください。");
};

const parseJson = async (request: Request): Promise<unknown | Response> => {
  try {
    return await request.json();
  } catch {
    return fail(422, "invalid_input", "入力内容を確認してください。");
  }
};

const readBody = async <T>(
  request: Request,
  schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } },
): Promise<T | Response> => {
  const raw = await parseJson(request);
  if (raw instanceof Response) return raw;
  const parsed = schema.safeParse(raw);
  return parsed.success ? parsed.data : fail(422, "invalid_input", "入力内容を確認してください。");
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
    return fail(404, "not_found", "会話または記憶が見つかりません。");
  }
  return fail(503, "unavailable", "保存先を利用できません。再試行してください。");
};

type MemoryDb = Awaited<ReturnType<typeof createDb>>;
type MemoryScope = { userId: string; characterId: string };
type MemoryEnv = MemoryVectorBindings & { MEMORY_QUEUE?: Pick<Queue, "send"> };
type MemoryContext = { database: MemoryDb; env: MemoryEnv; scope: MemoryScope };

const NOT_STARTED_MESSAGE = "会話が始まってから記憶を追加できます。";

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

const handleGet = async (context: MemoryContext, request: Request): Promise<Response> => {
  await purgeExpired(context);
  const { database, scope } = context;
  const param = new URL(request.url).searchParams.get("conversationId");
  if (param !== null && !idSchema.safeParse(param).success) {
    return fail(422, "invalid_input", "入力内容を確認してください。");
  }
  const conversationId = param ?? (await findLatestConversationId(database, scope));
  const characterName = await loadCharacterName(database, scope.characterId);
  if (characterName === null) return fail(404, "not_found", "キャラが見つかりません。");
  if (!conversationId) return privateJson({ conversationId: null, characterName, memories: [] });
  const [rows, used] = await Promise.all([
    listConversationMemories(database, { ...scope, conversationId }),
    loadLastTurnUsedMemoryIds(database, conversationId),
  ]);
  return privateJson({
    conversationId,
    characterName,
    memories: rows.map((row) => toView(row, used)),
  });
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
    return fail(409, "conversation_not_started", NOT_STARTED_MESSAGE);
  }
  const memory = await insertManualMemory(database, { ...scope, conversationId }, payload);
  if (!memory) {
    return fail(409, "conversation_not_started", NOT_STARTED_MESSAGE);
  }
  await indexMemoryContent(database, env, scope, memory);
  const used = await loadLastTurnUsedMemoryIds(database, memory.conversationId);
  return privateJson({ memory: toView(memory, used) }, 201);
};

const handlePatch = async (context: MemoryContext, request: Request): Promise<Response> => {
  await purgeExpired(context);
  const { database, env, scope } = context;
  const payload = await readBody(request, patchSchema);
  if (payload instanceof Response) return payload;
  const result = await updateMemory(database, scope, payload.memoryId, {
    expectedRevision: payload.expectedRevision,
    content: payload.content,
    category: payload.category,
    pinned: payload.pinned,
  });
  if (result.type === "not_found")
    return fail(404, "not_found", "会話または記憶が見つかりません。");
  if (result.type === "revision_conflict") {
    return privateJson({ code: "revision_conflict", currentRevision: result.currentRevision }, 409);
  }
  if (result.type === "pin_limit") {
    return fail(409, "pin_limit", "固定できるのは 8 件までです。");
  }
  // 本文を差し替えたら古い vector を捨て、差し替え後の本文で索引し直す（RIT-94）。
  if (result.contentChanged) {
    await dropMemoryVector(env, payload.memoryId, result.previous);
    await indexMemoryContent(database, env, scope, result.memory);
    await enqueueSummaryRedact(env, result.memory.conversationId);
  }
  const used = await loadLastTurnUsedMemoryIds(database, result.memory.conversationId);
  return privateJson({ memory: toView(result.memory, used) });
};

const handleDelete = async (context: MemoryContext, request: Request): Promise<Response> => {
  await purgeExpired(context);
  const { database, env, scope } = context;
  const payload = await readBody(request, deleteSchema);
  if (payload instanceof Response) return payload;
  const deleted = await deleteMemory(database, scope, payload.memoryId);
  if (deleted === null) return fail(404, "not_found", "会話または記憶が見つかりません。");
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
    return fail(410, "restore_expired", "元に戻せる時間が過ぎています。");
  }
  await purgeExpired(context);
  if (!result) return fail(404, "not_found", "会話または記憶が見つかりません。");
  await indexMemoryContent(database, env, scope, result);
  const used = await loadLastTurnUsedMemoryIds(database, result.conversationId);
  return privateJson({ memory: toView(result, used) });
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
  if (!parsedId.success) return fail(422, "invalid_input", "入力内容を確認してください。");
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

    if (request.method === "GET") return await handleGet(context, request);

    const requestError = mutationRequestError(request);
    if (requestError) return requestError;

    const handler = MUTATION_HANDLERS.get(request.method);
    if (!handler) return fail(405, "method_not_allowed", "この操作には対応していません。");
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
    if (request.method !== "POST")
      return fail(405, "method_not_allowed", "この操作には対応していません。");
    const requestError = mutationRequestError(request);
    if (requestError) return requestError;
    const context = await resolveContext(characterId);
    if (context instanceof Response) return context;
    return await handleRestore(context, request);
  } catch (error) {
    return handleError(error);
  }
};

// 「覚えた：…」リンクの問い合わせ（RIT-92 FR-13）。そのターンの抽出仕事の状態と、
// 生まれた記憶を返す。所有は他の記憶 API と同じ（他人・無い会話は 404）。
export const handleMemoriesLearnedRequest = async (
  characterId: string,
  request: Request,
): Promise<Response> => {
  try {
    if (request.method !== "GET")
      return fail(405, "method_not_allowed", "この操作には対応していません。");
    const context = await resolveContext(characterId);
    if (context instanceof Response) return context;
    const { database, scope } = context;
    const url = new URL(request.url);
    const parsed = learnedQuerySchema.safeParse({
      conversationId: url.searchParams.get("conversationId"),
      turn: url.searchParams.get("turn"),
    });
    if (!parsed.success) return fail(422, "invalid_input", "入力内容を確認してください。");
    const { conversationId, turn } = parsed.data;
    const owned = await loadOwnedConversation(database, { ...scope, conversationId });
    if (!owned) return fail(404, "not_found", "会話または記憶が見つかりません。");
    const state = resolveMemoryLearnedState(
      await loadMemoryJobStatesForTurn(database, conversationId, turn),
    );
    const memories =
      state === "done" ? await loadLearnedMemories(database, conversationId, turn) : [];
    return privateJson({ state, memories });
  } catch (error) {
    return handleError(error);
  }
};
