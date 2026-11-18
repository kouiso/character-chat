// POST /api/admin/legacy-migration — 旧会話・旧記憶メモ・検索の塊を v2 へ移す受け口
// （RIT-77 が骨組み、RIT-78 が memory・corpus・verify-memory・verify-corpus を足した）。
// mode は 1 つだけ。応答には旧発言・記憶・塊の本文と利用者 ID を出さない（札と件数と旧 id だけ）。
// 書き込みは apply: true と確認だけで見た expected の一致がそろった時だけで、ずれていれば
// 何も書かず 409。検索箱が使えない時は 503 で、0 件の成功としては返さない。
import {
  createDb,
  describeError,
  LegacyCorpusPlanChangedError,
  LegacyMemoryPlanChangedError,
  LegacyPlanChangedError,
  listLegacySources,
  migrateLegacyConversations,
  migrateLegacyMemoryNotes,
  resolveLegacyMemoryOwner,
  resolveLegacySourceOwner,
  verifyLegacyConversations,
  verifyLegacyMemoryNotes,
} from "@v2/db";
import { z } from "zod";

import { LOCAL_USER_ID } from "./identity";
import {
  indexMemoryTargets,
  MemoryVectorUnavailableError,
  runLegacyCorpusPage,
  verifyLegacyCorpusPage,
} from "./legacy-memory-migration";
import { reportFailure } from "./log";
import { retrieveVectorMemories } from "./memory-rag";
import { memoryVectorReady, type MemoryVectorBindings } from "./memory-vector";
import { getPlatform } from "./platform";

const sourceOwnerSchema = z.string().regex(/^(local|owner-[0-9a-f]{8})$/);
const cursorSchema = z.string().min(1);
const limitSchema = z.number().int().min(1).max(20);
const expectedSchema = z
  .object({
    insertedConversations: z.number().int().nonnegative(),
    insertedMessages: z.number().int().nonnegative(),
  })
  .strict();
const expectedMemorySchema = z
  .object({ insertedMemories: z.number().int().nonnegative() })
  .strict();
const expectedCorpusSchema = z.object({ chunks: z.number().int().nonnegative() }).strict();

const bodySchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("sources") }).strict(),
  z
    .object({
      mode: z.literal("conversations"),
      sourceOwner: sourceOwnerSchema,
      apply: z.boolean().optional(),
      cursor: cursorSchema.optional(),
      limit: limitSchema.optional(),
      expected: expectedSchema.optional(),
    })
    .strict(),
  z
    .object({
      mode: z.literal("verify-conversations"),
      sourceOwner: sourceOwnerSchema,
      cursor: cursorSchema.optional(),
      limit: limitSchema.optional(),
    })
    .strict(),
  z
    .object({
      mode: z.literal("memory"),
      sourceOwner: sourceOwnerSchema,
      apply: z.boolean().optional(),
      cursor: cursorSchema.optional(),
      limit: limitSchema.optional(),
      expected: expectedMemorySchema.optional(),
    })
    .strict(),
  z
    .object({
      mode: z.literal("verify-memory"),
      sourceOwner: sourceOwnerSchema,
      cursor: cursorSchema.optional(),
      limit: limitSchema.optional(),
      search: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      mode: z.literal("corpus"),
      apply: z.boolean().optional(),
      cursor: cursorSchema.optional(),
      limit: limitSchema.optional(),
      expected: expectedCorpusSchema.optional(),
    })
    .strict(),
  z
    .object({
      mode: z.literal("verify-corpus"),
      cursor: cursorSchema.optional(),
      limit: limitSchema.optional(),
    })
    .strict(),
]);

const errorJson = (code: string, status: number, extra?: Record<string, unknown>) =>
  Response.json({ code, ...extra }, { status });

// 予定通りの失敗を HTTP 符号へ写す。写せない物は null（呼び出し側が投げ直す）。
const migrationErrorResponse = (error: unknown): Response | null => {
  if (
    error instanceof LegacyPlanChangedError ||
    error instanceof LegacyMemoryPlanChangedError ||
    error instanceof LegacyCorpusPlanChangedError
  ) {
    return errorJson("plan_changed", 409, { planned: error.planned });
  }
  if (error instanceof MemoryVectorUnavailableError) {
    return errorJson("vector_unavailable", 503);
  }
  return null;
};

type Db = ReturnType<typeof createDb>;

const runConversations = async (
  db: Db,
  data: Extract<z.infer<typeof bodySchema>, { mode: "conversations" }>,
): Promise<Response> => {
  const sourceUserId = await resolveLegacySourceOwner(db, data.sourceOwner);
  if (sourceUserId === null) return errorJson("source_not_found", 404);
  const apply = data.apply === true;
  if (apply && data.expected === undefined) return errorJson("bad_request", 400);
  try {
    const { nextCursor, ...page } = await migrateLegacyConversations(db, {
      sourceUserId,
      targetUserId: LOCAL_USER_ID,
      apply,
      cursor: data.cursor,
      limit: data.limit ?? 5,
      expected: data.expected,
    });
    return Response.json({
      mode: "conversations",
      apply,
      sourceOwner: data.sourceOwner,
      nextCursor,
      page,
    });
  } catch (error: unknown) {
    const mapped = migrationErrorResponse(error);
    if (mapped) return mapped;
    throw error;
  }
};

const runVerify = async (
  db: Db,
  data: Extract<z.infer<typeof bodySchema>, { mode: "verify-conversations" }>,
): Promise<Response> => {
  const sourceUserId = await resolveLegacySourceOwner(db, data.sourceOwner);
  if (sourceUserId === null) return errorJson("source_not_found", 404);
  const { nextCursor, ...page } = await verifyLegacyConversations(db, {
    sourceUserId,
    targetUserId: LOCAL_USER_ID,
    cursor: data.cursor,
    limit: data.limit ?? 5,
  });
  return Response.json({
    mode: "verify-conversations",
    sourceOwner: data.sourceOwner,
    nextCursor,
    page,
  });
};

const runMemory = async (
  db: Db,
  env: MemoryVectorBindings,
  data: Extract<z.infer<typeof bodySchema>, { mode: "memory" }>,
): Promise<Response> => {
  const sourceUserId = await resolveLegacyMemoryOwner(db, data.sourceOwner);
  if (sourceUserId === null) return errorJson("source_not_found", 404);
  const apply = data.apply === true;
  if (apply && data.expected === undefined) return errorJson("bad_request", 400);
  const vectorReady = memoryVectorReady(env);
  if (apply && !vectorReady) return errorJson("vector_unavailable", 503);
  try {
    const { nextCursor, indexTargets, ...page } = await migrateLegacyMemoryNotes(db, {
      sourceUserId,
      targetUserId: LOCAL_USER_ID,
      apply,
      cursor: data.cursor,
      limit: data.limit ?? 10,
      expected: data.expected,
    });
    // 埋めるのは D1 の確定後に 1 件ずつ。失敗はその 1 件だけ index_failed で返す。
    const { indexed, failures } = apply
      ? await indexMemoryTargets(db, env, LOCAL_USER_ID, indexTargets)
      : { indexed: 0, failures: [] };
    return Response.json({
      mode: "memory",
      apply,
      sourceOwner: data.sourceOwner,
      vectorReady,
      nextCursor,
      page: { ...page, indexedMemories: indexed, failures: [...page.failures, ...failures] },
    });
  } catch (error: unknown) {
    const mapped = migrationErrorResponse(error);
    if (mapped) return mapped;
    throw error;
  }
};

// match の記憶を検索箱を通る道で実際に引いてみる（固定の道は通らない）。
const searchTestMemory = async (
  db: Db,
  env: MemoryVectorBindings,
  item: { characterId?: string; conversationId?: string; content?: string; memoryId?: string },
): Promise<boolean> => {
  const ranked = await retrieveVectorMemories(
    db,
    env,
    {
      userId: LOCAL_USER_ID,
      characterId: item.characterId ?? "",
      conversationId: item.conversationId ?? "",
    },
    item.content ?? "",
  );
  return ranked.some((entry) => entry.id === item.memoryId);
};

// 1 件ずつの応答を作る。search の時は match の記憶だけ検索箱を通る道で引いてみる。
const verifyMemoryItems = async (
  db: Db,
  env: MemoryVectorBindings,
  items: Awaited<ReturnType<typeof verifyLegacyMemoryNotes>>["items"],
  search: boolean,
) => {
  const out: { noteId: string; status: string; retrievable?: boolean }[] = [];
  for (const item of items) {
    out.push(
      search && item.status === "match"
        ? {
            noteId: item.noteId,
            status: item.status,
            retrievable: await searchTestMemory(db, env, item),
          }
        : { noteId: item.noteId, status: item.status },
    );
  }
  return out;
};

const runVerifyMemory = async (
  db: Db,
  env: MemoryVectorBindings,
  data: Extract<z.infer<typeof bodySchema>, { mode: "verify-memory" }>,
): Promise<Response> => {
  const sourceUserId = await resolveLegacyMemoryOwner(db, data.sourceOwner);
  if (sourceUserId === null) return errorJson("source_not_found", 404);
  const search = data.search === true;
  // 検索で引けるかを実際に試す時は 1 ページ 10 件まで（1 件につき埋める呼び出しが 1 回出る）。
  if (search && data.limit !== undefined && data.limit > 10) {
    return errorJson("bad_request", 400);
  }
  if (search && !memoryVectorReady(env)) return errorJson("vector_unavailable", 503);
  const { nextCursor, items, notes } = await verifyLegacyMemoryNotes(db, {
    sourceUserId,
    targetUserId: LOCAL_USER_ID,
    cursor: data.cursor,
    limit: data.limit ?? (search ? 10 : 20),
  });
  return Response.json({
    mode: "verify-memory",
    sourceOwner: data.sourceOwner,
    nextCursor,
    page: { notes, items: await verifyMemoryItems(db, env, items, search) },
  });
};

const runCorpus = async (
  db: Db,
  env: MemoryVectorBindings,
  data: Extract<z.infer<typeof bodySchema>, { mode: "corpus" }>,
): Promise<Response> => {
  const apply = data.apply === true;
  if (apply && data.expected === undefined) return errorJson("bad_request", 400);
  const vectorReady = memoryVectorReady(env);
  if (apply && !vectorReady) return errorJson("vector_unavailable", 503);
  try {
    const { nextCursor, ...page } = await runLegacyCorpusPage(db, env, {
      apply,
      cursor: data.cursor,
      limit: data.limit ?? 10,
      expected: data.expected,
    });
    return Response.json({ mode: "corpus", apply, vectorReady, nextCursor, page });
  } catch (error: unknown) {
    const mapped = migrationErrorResponse(error);
    if (mapped) return mapped;
    throw error;
  }
};

const runVerifyCorpus = async (
  db: Db,
  env: MemoryVectorBindings,
  data: Extract<z.infer<typeof bodySchema>, { mode: "verify-corpus" }>,
): Promise<Response> => {
  try {
    const { nextCursor, ...page } = await verifyLegacyCorpusPage(db, env, {
      cursor: data.cursor,
      limit: data.limit ?? 20,
    });
    return Response.json({ mode: "verify-corpus", nextCursor, page });
  } catch (error: unknown) {
    const mapped = migrationErrorResponse(error);
    if (mapped) return mapped;
    throw error;
  }
};

const dispatch = async (
  db: Db,
  env: MemoryVectorBindings,
  data: z.infer<typeof bodySchema>,
): Promise<Response> => {
  switch (data.mode) {
    case "sources": {
      const sources = await listLegacySources(db);
      // 利用者 ID は応答に出さん。札と件数だけ。
      return Response.json({
        sources: sources.map((row) => ({
          sourceOwner: row.sourceOwner,
          conversations: row.conversations,
          messages: row.messages,
          importedConversations: row.importedConversations,
        })),
      });
    }
    case "conversations":
      return await runConversations(db, data);
    case "verify-conversations":
      return await runVerify(db, data);
    case "memory":
      return await runMemory(db, env, data);
    case "verify-memory":
      return await runVerifyMemory(db, env, data);
    case "corpus":
      return await runCorpus(db, env, data);
    case "verify-corpus":
      return await runVerifyCorpus(db, env, data);
  }
};

export const handleLegacyMigration = async (request: Request): Promise<Response> => {
  if (request.method !== "POST") return errorJson("method_not_allowed", 405);
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return errorJson("content_type_required", 415);
  }
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return errorJson("bad_request", 400);
  }
  const parsed = bodySchema.safeParse(payload);
  if (!parsed.success) return errorJson("bad_request", 400);
  const { env } = await getPlatform();
  const db = createDb(env.DB);
  try {
    return await dispatch(db, env, parsed.data);
  } catch (error: unknown) {
    reportFailure(env, {
      event: "legacy_migration_failed",
      level: "error",
      status: 500,
      method: request.method,
      route: "/api/admin/legacy-migration",
      reason: describeError(error),
    });
    return errorJson("internal", 500);
  }
};
