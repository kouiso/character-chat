// POST /api/admin/memory-reindex — 索引の失敗を戻す・記憶を全部入れ直す運用の口（RIT-74 FR-6/FR-8）。
// 認可は api-admin-migration と同じく入口の Basic 認証・Cloudflare Access に任せ、この口では確かめない。
// 対象は LOCAL_USER_ID の会話だけ（v2_conversation.user_id が境界）。戻した job は
// 次の送り（ChatRoom alarm の publishMemories）で拾われて索引をやり直す。
import { createDb, describeError, resetAllMemoryIndex, resetFailedMemoryIndex } from "@v2/db";
import { z } from "zod";

import { LOCAL_USER_ID } from "./identity";
import { reportFailure } from "./log";
import { getPlatform } from "./platform";

const bodySchema = z
  .object({
    conversationId: z.string().min(1).max(120).optional(),
    mode: z.enum(["failed", "all"]).default("failed"),
  })
  .strict()
  // mode:all は会話を 1 つに絞る入れ直し。省略時に全会話の embedding を消すのは
  // 広すぎる操作なので、会話の指定無しには受理せん（RIT-74 FR-8）。
  .refine((body) => body.mode !== "all" || body.conversationId !== undefined);

const errorJson = (code: string, status: number) => Response.json({ code }, { status });

export const handleMemoryReindex = async (request: Request): Promise<Response> => {
  if (request.method !== "POST") return errorJson("method_not_allowed", 405);
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return errorJson("content_type_required", 415);
  }
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return errorJson("invalid_request", 400);
  }
  const parsed = bodySchema.safeParse(payload);
  if (!parsed.success) return errorJson("invalid_request", 400);
  const { env } = await getPlatform();
  const db = createDb(env.DB);
  try {
    const reset =
      parsed.data.mode === "all"
        ? await resetAllMemoryIndex(db, LOCAL_USER_ID, parsed.data.conversationId)
        : await resetFailedMemoryIndex(db, LOCAL_USER_ID, parsed.data.conversationId);
    return Response.json({ reset });
  } catch (error: unknown) {
    reportFailure(env, {
      event: "memory_reindex_failed",
      level: "error",
      status: 503,
      route: "/api/admin/memory-reindex",
      reason: describeError(error),
    });
    return errorJson("db_unavailable", 503);
  }
};
