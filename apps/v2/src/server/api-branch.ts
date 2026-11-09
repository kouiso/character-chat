// 枝分かれ操作 API（RIT-202）。GET=系列一覧、POST=active 張替/戻る/進む/リライト。
// 再生成（assistant 枝の生成）はターン実行を伴うので /api/chat 側の経路で扱う。
import {
  activateBranch,
  createDb,
  listBranchSiblings,
  restoreFromTurn,
  rewriteUserMessage,
  truncateFromTurn,
} from "@v2/db";
import { z } from "zod";

import { LOCAL_USER_ID } from "./identity";
import { getPlatform } from "./platform";

const json = (status: number, body: Record<string, unknown>): Response =>
  Response.json(body, { status });

const notFound = () => json(404, { message: "会話が見つかりません。" });

// 所有者確認は生 D1（apps/v2 では drizzle 二重版の型衝突を避けるため）。
const ownerGuard = async (d1: D1Database, conversationId: string) => {
  const row = await d1
    .prepare("SELECT user_id FROM v2_conversation WHERE id = ?")
    .bind(conversationId)
    .first<{ user_id: string }>();
  return row?.user_id === LOCAL_USER_ID;
};

const listSchema = z.object({
  conversationId: z.string().min(1).max(120),
  turn: z.coerce.number().int().min(0),
  role: z.enum(["user", "assistant"]),
});

// GET /api/chat/:id/branch?conversationId&turn&role — 同じ (turn,role) の系列一覧。
export const handleBranchList = async (request: Request): Promise<Response> => {
  const url = new URL(request.url);
  const parsed = listSchema.safeParse({
    conversationId: url.searchParams.get("conversationId"),
    turn: url.searchParams.get("turn"),
    role: url.searchParams.get("role"),
  });
  if (!parsed.success) return json(422, { message: "conversationId・turn・role が必要です。" });
  const { env } = await getPlatform();
  const db = createDb(env.DB);
  if (!(await ownerGuard(env.DB, parsed.data.conversationId))) return notFound();
  const siblings = await listBranchSiblings(
    db,
    parsed.data.conversationId,
    parsed.data.turn,
    parsed.data.role,
  );
  return json(200, { siblings });
};

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("activate"),
    conversationId: z.string().min(1).max(120),
    messageId: z.string().min(1),
  }),
  z.object({
    action: z.literal("truncate"),
    conversationId: z.string().min(1).max(120),
    fromTurn: z.number().int().min(0),
  }),
  z.object({
    action: z.literal("restore"),
    conversationId: z.string().min(1).max(120),
    fromTurn: z.number().int().min(0),
  }),
  z.object({
    action: z.literal("rewrite"),
    conversationId: z.string().min(1).max(120),
    turn: z.number().int().min(0),
    content: z.string().min(1).max(8000),
  }),
]);

// POST /api/chat/:id/branch — activate/truncate/restore/rewrite。
export const handleBranchAction = async (request: Request): Promise<Response> => {
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json(422, { message: "action・conversationId が必要です。" });
  const { env } = await getPlatform();
  const db = createDb(env.DB);
  const input = parsed.data;
  if (!(await ownerGuard(env.DB, input.conversationId))) return notFound();
  switch (input.action) {
    case "activate":
      return (await activateBranch(db, input.messageId)) === "ok"
        ? json(200, { ok: true })
        : notFound();
    case "truncate":
      await truncateFromTurn(db, input.conversationId, input.fromTurn);
      return json(200, { ok: true });
    case "restore":
      await restoreFromTurn(db, input.conversationId, input.fromTurn);
      return json(200, { ok: true });
    case "rewrite": {
      const id = await rewriteUserMessage(db, input.conversationId, input.turn, input.content);
      return id ? json(200, { messageId: id }) : notFound();
    }
  }
};
