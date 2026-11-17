// POST /api/admin/legacy-migration — 旧会話を v2 へ移す受け口（RIT-77）。
// mode は 1 つだけ: sources（利用者の札の一覧）・conversations（確認だけ/書き込み、ページ区切り）・
// verify-conversations（1件ずつの照合、書かない）。memory・corpus・verify-memory・verify-corpus は
// RIT-78 が足すまで 400 を返す。
// 応答には旧発言の本文・題名・利用者 ID を出さない（札と件数だけ）。書き込みは apply: true と
// 確認だけで見た expected の一致がそろった時だけで、ずれていれば何も書かず 409。
import {
  createDb,
  describeError,
  LegacyPlanChangedError,
  listLegacySources,
  migrateLegacyConversations,
  resolveLegacySourceOwner,
  verifyLegacyConversations,
} from "@v2/db";
import { z } from "zod";

import { LOCAL_USER_ID } from "./identity";
import { reportFailure } from "./log";
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
]);

const errorJson = (code: string, status: number, extra?: Record<string, unknown>) =>
  Response.json({ code, ...extra }, { status });

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
    if (error instanceof LegacyPlanChangedError) {
      return errorJson("plan_changed", 409, { planned: error.planned });
    }
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
    switch (parsed.data.mode) {
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
        return await runConversations(db, parsed.data);
      case "verify-conversations":
        return await runVerify(db, parsed.data);
    }
  } catch (e) {
    reportFailure(env, {
      event: "legacy_migration_failed",
      level: "error",
      status: 500,
      route: "/api/admin/legacy-migration",
      reason: describeError(e),
    });
    return errorJson("internal", 500);
  }
};
