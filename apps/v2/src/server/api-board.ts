// 雑談広場 API（RIT-209）。公開テキストボード。投稿・一覧（カーソル頁）・本人削除。
import { z } from "zod";

import { LOCAL_USER_ID } from "./identity";
import { getPlatform } from "./platform";

const json = (status: number, body: Record<string, unknown>): Response =>
  Response.json(body, { status });

const postBodySchema = z.object({
  body: z.string().trim().min(1).max(500),
});

const PAGE_SIZE = 30;

export type BoardPageData = {
  items: { id: string; userId: string; body: string; createdAt: number; mine: boolean }[];
  nextCursor: string | null;
};

// /board ページの server fn からも同じクエリを引くため共有する
export const loadBoardPage = async (db: D1Database, before?: number): Promise<BoardPageData> => {
  const { results } = await db
    .prepare(
      `SELECT id, user_id, body, created_at FROM v2_board_post
       ${before !== undefined ? "WHERE created_at < ?" : ""}
       ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .bind(...(before !== undefined ? [before, PAGE_SIZE + 1] : [PAGE_SIZE + 1]))
    .all<{ id: string; user_id: string; body: string; created_at: number }>();
  const rows = results ?? [];
  const page = rows.slice(0, PAGE_SIZE);
  return {
    items: page.map((row) => ({
      id: row.id,
      userId: row.user_id,
      body: row.body,
      createdAt: row.created_at,
      mine: row.user_id === LOCAL_USER_ID,
    })),
    nextCursor: rows.length > PAGE_SIZE ? String(page[page.length - 1].created_at) : null,
  };
};

// GET /api/board?before=<created_at> — 新しい順のカーソルページング。
// nextCursor は最終行の created_at。同時刻は id でタイブレークする。
export const handleBoardList = async (request: Request): Promise<Response> => {
  const url = new URL(request.url);
  const raw = url.searchParams.get("before");
  const before = raw === null ? undefined : Number(raw);
  const { env } = await getPlatform();
  return json(200, await loadBoardPage(env.DB, Number.isFinite(before) ? before : undefined));
};

// POST /api/board {body} — 投稿
export const handleBoardPost = async (request: Request): Promise<Response> => {
  const parsed = postBodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return json(422, { message: "本文は1〜500字で指定してください。" });
  const { env } = await getPlatform();
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO v2_board_post (id, user_id, body, created_at) VALUES (?, ?, ?, ?)",
  )
    .bind(id, LOCAL_USER_ID, parsed.data.body, Date.now())
    .run();
  return json(201, { id });
};

// DELETE /api/board/:id — 本人の投稿のみ削除
export const handleBoardDelete = async (postId: string): Promise<Response> => {
  const { env } = await getPlatform();
  const row = await env.DB.prepare("SELECT user_id FROM v2_board_post WHERE id = ?")
    .bind(postId)
    .first<{ user_id: string }>();
  if (!row || row.user_id !== LOCAL_USER_ID)
    return json(404, { message: "投稿が見つかりません。" });
  await env.DB.prepare("DELETE FROM v2_board_post WHERE id = ?").bind(postId).run();
  return json(200, { deleted: true });
};
