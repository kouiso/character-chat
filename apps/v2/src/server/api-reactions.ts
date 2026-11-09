// 公開キャラへのリアクション API（RIT-207）。いいね・コメント・フォロー。
// 対象は公開中のキャラのみ（非公開は404）。user_id 列で多ユーザー移行を阻まない。
import { z } from "zod";

import { LOCAL_USER_ID } from "./identity";
import { getPlatform } from "./platform";

const json = (status: number, body: Record<string, unknown>): Response =>
  Response.json(body, { status });

const followKindSchema = z.enum(["character", "creator"]);

const commentBodySchema = z.object({
  body: z.string().trim().min(1).max(500),
});

// 公開中かの確認（publish 行が唯一の公開判定）
const publishedUserId = async (db: D1Database, characterId: string) => {
  const row = await db
    .prepare("SELECT user_id FROM v2_character_publish WHERE character_id = ?")
    .bind(characterId)
    .first<{ user_id: string }>();
  return row?.user_id ?? null;
};

const countOf = async (db: D1Database, sql: string, ...binds: string[]) => {
  const row = await db
    .prepare(sql)
    .bind(...binds)
    .first<{ n: number }>();
  return row?.n ?? 0;
};

// GET /api/catalog/:id/reactions — 自分の状態＋件数をまとめて返す
export const handleReactions = async (characterId: string): Promise<Response> => {
  const { env } = await getPlatform();
  if (!(await publishedUserId(env.DB, characterId)))
    return json(404, { message: "公開キャラクターが見つかりません。" });
  const [likeCount, liked, commentCount, followedCharacter, followedCreator] = await Promise.all([
    countOf(
      env.DB,
      "SELECT COUNT(*) AS n FROM v2_catalog_like WHERE character_id = ?",
      characterId,
    ),
    env.DB.prepare("SELECT 1 AS x FROM v2_catalog_like WHERE character_id = ? AND user_id = ?")
      .bind(characterId, LOCAL_USER_ID)
      .first(),
    countOf(
      env.DB,
      "SELECT COUNT(*) AS n FROM v2_catalog_comment WHERE character_id = ?",
      characterId,
    ),
    env.DB.prepare(
      "SELECT 1 AS x FROM v2_follow WHERE user_id = ? AND kind = 'character' AND target_id = ?",
    )
      .bind(LOCAL_USER_ID, characterId)
      .first(),
    env.DB.prepare(
      "SELECT 1 AS x FROM v2_follow WHERE user_id = ? AND kind = 'creator' AND target_id = (SELECT user_id FROM v2_character_publish WHERE character_id = ?)",
    )
      .bind(LOCAL_USER_ID, characterId)
      .first(),
  ]);
  return json(200, {
    likeCount,
    liked: liked !== null,
    commentCount,
    followedCharacter: followedCharacter !== null,
    followedCreator: followedCreator !== null,
  });
};

// POST /api/catalog/:id/like — いいねの冪等トグル
export const handleLikeToggle = async (characterId: string): Promise<Response> => {
  const { env } = await getPlatform();
  if (!(await publishedUserId(env.DB, characterId)))
    return json(404, { message: "公開キャラクターが見つかりません。" });
  const existing = await env.DB.prepare(
    "SELECT 1 AS x FROM v2_catalog_like WHERE character_id = ? AND user_id = ?",
  )
    .bind(characterId, LOCAL_USER_ID)
    .first();
  if (existing) {
    await env.DB.prepare("DELETE FROM v2_catalog_like WHERE character_id = ? AND user_id = ?")
      .bind(characterId, LOCAL_USER_ID)
      .run();
  } else {
    await env.DB.prepare(
      "INSERT INTO v2_catalog_like (character_id, user_id, created_at) VALUES (?, ?, ?)",
    )
      .bind(characterId, LOCAL_USER_ID, Date.now())
      .run();
  }
  const likeCount = await countOf(
    env.DB,
    "SELECT COUNT(*) AS n FROM v2_catalog_like WHERE character_id = ?",
    characterId,
  );
  return json(200, { liked: !existing, likeCount });
};

// POST /api/catalog/:id/follow {kind} — フォローの冪等トグル（creator は作者を解決）
export const handleFollowToggle = async (
  characterId: string,
  request: Request,
): Promise<Response> => {
  const raw: unknown = await request.json().catch(() => ({}));
  const parsed = followKindSchema.safeParse(
    typeof raw === "object" && raw !== null && "kind" in raw ? raw.kind : "character",
  );
  if (!parsed.success) return json(422, { message: "kind は character か creator です。" });
  const { env } = await getPlatform();
  const author = await publishedUserId(env.DB, characterId);
  if (!author) return json(404, { message: "公開キャラクターが見つかりません。" });
  const targetId = parsed.data === "creator" ? author : characterId;
  const existing = await env.DB.prepare(
    "SELECT 1 AS x FROM v2_follow WHERE user_id = ? AND kind = ? AND target_id = ?",
  )
    .bind(LOCAL_USER_ID, parsed.data, targetId)
    .first();
  if (existing) {
    await env.DB.prepare("DELETE FROM v2_follow WHERE user_id = ? AND kind = ? AND target_id = ?")
      .bind(LOCAL_USER_ID, parsed.data, targetId)
      .run();
  } else {
    await env.DB.prepare(
      "INSERT INTO v2_follow (user_id, kind, target_id, created_at) VALUES (?, ?, ?, ?)",
    )
      .bind(LOCAL_USER_ID, parsed.data, targetId, Date.now())
      .run();
  }
  return json(200, { following: !existing });
};

// GET /api/follows — 自分のフォロー一覧
export const handleFollowList = async (): Promise<Response> => {
  const { env } = await getPlatform();
  const { results } = await env.DB.prepare(
    "SELECT kind, target_id FROM v2_follow WHERE user_id = ? ORDER BY created_at DESC",
  )
    .bind(LOCAL_USER_ID)
    .all<{ kind: string; target_id: string }>();
  return json(200, {
    items: (results ?? []).map((row) => ({ kind: row.kind, targetId: row.target_id })),
  });
};

// GET /api/catalog/:id/comments — コメント一覧（新しい順・mine 付き）
export const handleCommentList = async (characterId: string): Promise<Response> => {
  const { env } = await getPlatform();
  if (!(await publishedUserId(env.DB, characterId)))
    return json(404, { message: "公開キャラクターが見つかりません。" });
  const { results } = await env.DB.prepare(
    "SELECT id, user_id, body, created_at FROM v2_catalog_comment WHERE character_id = ? ORDER BY created_at DESC LIMIT 100",
  )
    .bind(characterId)
    .all<{ id: string; user_id: string; body: string; created_at: number }>();
  return json(200, {
    items: (results ?? []).map((row) => ({
      id: row.id,
      userId: row.user_id,
      body: row.body,
      createdAt: row.created_at,
      mine: row.user_id === LOCAL_USER_ID,
    })),
  });
};

// POST /api/catalog/:id/comments {body} — 投稿
export const handleCommentCreate = async (
  characterId: string,
  request: Request,
): Promise<Response> => {
  const parsed = commentBodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return json(422, { message: "本文は1〜500字で指定してください。" });
  const { env } = await getPlatform();
  if (!(await publishedUserId(env.DB, characterId)))
    return json(404, { message: "公開キャラクターが見つかりません。" });
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO v2_catalog_comment (id, character_id, user_id, body, created_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(id, characterId, LOCAL_USER_ID, parsed.data.body, Date.now())
    .run();
  return json(201, { id });
};

// DELETE /api/catalog/:id/comments/:cid — 本人のコメントのみ削除
export const handleCommentDelete = async (
  characterId: string,
  commentId: string,
): Promise<Response> => {
  const { env } = await getPlatform();
  const row = await env.DB.prepare(
    "SELECT user_id FROM v2_catalog_comment WHERE id = ? AND character_id = ?",
  )
    .bind(commentId, characterId)
    .first<{ user_id: string }>();
  if (!row || row.user_id !== LOCAL_USER_ID)
    return json(404, { message: "コメントが見つかりません。" });
  await env.DB.prepare("DELETE FROM v2_catalog_comment WHERE id = ?").bind(commentId).run();
  return json(200, { deleted: true });
};
