// メッセージへの印 API（RIT-204）。GET=印一覧、POST=印の冪等トグル。
// bookmark は有無だけ、feedback は value=1（いいね）/-1（良くない）を持ち、
// 同じ値の再押しで外れる。全クエリは生 D1（drizzle 二重版の型衝突を避けるため）。
import { z } from "zod";

import { LOCAL_USER_ID } from "./identity";
import { getPlatform } from "./platform";

const json = (status: number, body: Record<string, unknown>): Response =>
  Response.json(body, { status });

const listSchema = z.object({
  conversationId: z.string().min(1).max(120),
  detail: z.enum(["bookmark"]).optional(),
});

const toggleSchema = z.object({
  conversationId: z.string().min(1).max(120),
  messageId: z.string().min(1).max(120),
  kind: z.enum(["bookmark", "feedback"]),
  value: z.union([z.literal(1), z.literal(-1)]).optional(),
});

type MarkRow = { message_id: string; kind: string; value: number };

const listMarks = async (db: D1Database, conversationId: string): Promise<MarkRow[]> => {
  const { results } = await db
    .prepare(
      "SELECT message_id, kind, value FROM v2_message_mark WHERE conversation_id = ? ORDER BY created_at",
    )
    .bind(conversationId)
    .all<MarkRow>();
  return results ?? [];
};

// 所有者確認 + メッセージがその会話のものか（他人の会話を 404 で隠す）。生 D1 2発。
const ownership = async (db: D1Database, conversationId: string, messageId?: string) => {
  const conv = await db
    .prepare("SELECT user_id FROM v2_conversation WHERE id = ?")
    .bind(conversationId)
    .first<{ user_id: string }>();
  if (conv?.user_id !== LOCAL_USER_ID) return false;
  if (messageId === undefined) return true;
  const msg = await db
    .prepare("SELECT 1 AS x FROM v2_message WHERE id = ? AND conversation_id = ?")
    .bind(messageId, conversationId)
    .first<{ x: number }>();
  return msg !== null;
};

const toBody = (rows: MarkRow[]) => ({
  marks: rows.map((row) => ({ messageId: row.message_id, kind: row.kind, value: row.value })),
});

// GET /api/chat/:id/marks?conversationId — 会話内の印一覧。detail=bookmark で
// ブックマーク済みメッセージのターンと抜粋も返す（一覧ジャンプ用）。
export const handleMarkList = async (request: Request): Promise<Response> => {
  const url = new URL(request.url);
  const parsed = listSchema.safeParse({
    conversationId: url.searchParams.get("conversationId"),
    detail: url.searchParams.get("detail") ?? undefined,
  });
  if (!parsed.success) return json(422, { message: "conversationId を指定してください。" });
  const { env } = await getPlatform();
  if (!(await ownership(env.DB, parsed.data.conversationId)))
    return json(404, { message: "会話が見つかりません。" });
  const marks = await listMarks(env.DB, parsed.data.conversationId);
  if (parsed.data.detail !== "bookmark") return json(200, toBody(marks));
  const bookmarkIds = marks.filter((m) => m.kind === "bookmark").map((m) => m.message_id);
  const items: { messageId: string; turn: number; excerpt: string }[] = [];
  for (const messageId of bookmarkIds) {
    const row = await env.DB.prepare(
      "SELECT turn, substr(content, 1, 60) AS excerpt FROM v2_message WHERE id = ?",
    )
      .bind(messageId)
      .first<{ turn: number; excerpt: string }>();
    if (row) items.push({ messageId, turn: row.turn, excerpt: row.excerpt });
  }
  return json(200, { ...toBody(marks), bookmarks: items });
};

// POST /api/chat/:id/marks — 印の冪等トグル。bookmark は value 固定 1、
// feedback は 1/-1 を送り、同じ値が既にあれば外す（無ければ付ける・違えば張替）。
export const handleMarkToggle = async (request: Request): Promise<Response> => {
  const parsed = toggleSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return json(400, { message: "conversationId・messageId・kind を正しく指定してください。" });
  const { conversationId, messageId, kind } = parsed.data;
  const { env } = await getPlatform();
  if (!(await ownership(env.DB, conversationId, messageId)))
    return json(404, { message: "会話が見つかりません。" });

  const value = kind === "bookmark" ? 1 : (parsed.data.value ?? 1);
  const existing = await env.DB.prepare(
    "SELECT value FROM v2_message_mark WHERE message_id = ? AND kind = ?",
  )
    .bind(messageId, kind)
    .first<{ value: number }>();

  if (existing?.value === value) {
    await env.DB.prepare("DELETE FROM v2_message_mark WHERE message_id = ? AND kind = ?")
      .bind(messageId, kind)
      .run();
  } else {
    await env.DB.prepare(
      "INSERT INTO v2_message_mark (message_id, conversation_id, kind, value, created_at) " +
        "VALUES (?, ?, ?, ?, ?) ON CONFLICT(message_id, kind) DO UPDATE SET value = excluded.value",
    )
      .bind(messageId, conversationId, kind, value, Date.now())
      .run();
  }
  return json(200, toBody(await listMarks(env.DB, conversationId)));
};
