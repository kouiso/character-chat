// キャラ公開 API（RIT-206）。公開状態は v2_character_publish（character は v1 共有表のため別表）。
// GET=公開状態、PUT=公開（summary 任意）、DELETE=非公開。公開は本人のキャラのみ。
import {
  characterContentSchema,
  createCharacterWithVersion,
  createDb,
  ensureLocalUser,
} from "@v2/db";
import { z } from "zod";

import { LOCAL_USER_ID } from "./identity";
import { getPlatform } from "./platform";

const json = (status: number, body: Record<string, unknown>): Response =>
  Response.json(body, { status });

const publishBodySchema = z.object({
  summary: z.string().max(500).optional(),
});

// 本人所有確認（生 D1：apps/v2 の drizzle 二重版ルール）
const ownsCharacter = async (db: D1Database, characterId: string): Promise<boolean> => {
  const row = await db
    .prepare("SELECT user_id FROM character WHERE id = ?")
    .bind(characterId)
    .first<{ user_id: string }>();
  return row?.user_id === LOCAL_USER_ID;
};

const publishedRow = async (db: D1Database, characterId: string) =>
  db
    .prepare(
      "SELECT character_id, user_id, summary, published_at FROM v2_character_publish WHERE character_id = ?",
    )
    .bind(characterId)
    .first<{
      character_id: string;
      user_id: string;
      summary: string | null;
      published_at: number;
    }>();

export type CatalogItem = {
  characterId: string;
  name: string;
  avatar: string | null;
  greeting: string;
  summary: string | null;
  authorUserId: string;
  publishedAt: number;
};

const toCatalogItem = (row: {
  character_id: string;
  user_id: string;
  summary: string | null;
  published_at: number;
  name: string;
  avatar: string | null;
  greeting: string;
}): CatalogItem => ({
  characterId: row.character_id,
  name: row.name,
  avatar: row.avatar,
  greeting: row.greeting,
  summary: row.summary,
  authorUserId: row.user_id,
  publishedAt: row.published_at,
});

// GET /api/characters/:id/publish — 自分のキャラの公開状態
export const handlePublishStatus = async (characterId: string): Promise<Response> => {
  const { env } = await getPlatform();
  if (!(await ownsCharacter(env.DB, characterId)))
    return json(404, { message: "キャラクターが見つかりません。" });
  const row = await publishedRow(env.DB, characterId);
  return json(200, { published: row !== null, summary: row?.summary ?? null });
};

// PUT /api/characters/:id/publish {summary?} — 公開（冪等 upsert）
export const handlePublishSet = async (
  characterId: string,
  request: Request,
): Promise<Response> => {
  const body = publishBodySchema.safeParse(await request.json().catch(() => ({})));
  if (!body.success) return json(422, { message: "summary は500字以内で指定してください。" });
  const { env } = await getPlatform();
  if (!(await ownsCharacter(env.DB, characterId)))
    return json(404, { message: "キャラクターが見つかりません。" });
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO v2_character_publish (character_id, user_id, summary, published_at, created_at) " +
      "VALUES (?, ?, ?, ?, ?) ON CONFLICT(character_id) DO UPDATE SET summary = excluded.summary",
  )
    .bind(characterId, LOCAL_USER_ID, body.data.summary ?? null, now, now)
    .run();
  return json(200, { published: true });
};

// DELETE /api/characters/:id/publish — 非公開に戻す
export const handlePublishUnset = async (characterId: string): Promise<Response> => {
  const { env } = await getPlatform();
  if (!(await ownsCharacter(env.DB, characterId)))
    return json(404, { message: "キャラクターが見つかりません。" });
  await env.DB.prepare("DELETE FROM v2_character_publish WHERE character_id = ?")
    .bind(characterId)
    .run();
  return json(200, { published: false });
};

// /catalog ページの server fn からも同じ一覧を引くためクエリを共有する
export const loadCatalogItems = async (db: D1Database): Promise<CatalogItem[]> => {
  const { results } = await db
    .prepare(
      "SELECT p.character_id, p.user_id, p.summary, p.published_at, c.name, c.avatar, c.greeting " +
        "FROM v2_character_publish p JOIN character c ON c.id = p.character_id " +
        "ORDER BY p.published_at DESC LIMIT 100",
    )
    .all<{
      character_id: string;
      user_id: string;
      summary: string | null;
      published_at: number;
      name: string;
      avatar: string | null;
      greeting: string;
    }>();
  return (results ?? []).map(toCatalogItem);
};

// GET /api/catalog — 公開キャラ一覧（新しい順）
export const handleCatalogList = async (): Promise<Response> => {
  const { env } = await getPlatform();
  return json(200, { items: await loadCatalogItems(env.DB) });
};

// GET /api/catalog/:id — 公開キャラ詳細（公開中のみ。プロンプト等は返さない）
export const handleCatalogDetail = async (characterId: string): Promise<Response> => {
  const { env } = await getPlatform();
  const row = await env.DB.prepare(
    "SELECT p.character_id, p.user_id, p.summary, p.published_at, c.name, c.avatar, c.greeting " +
      "FROM v2_character_publish p JOIN character c ON c.id = p.character_id " +
      "WHERE p.character_id = ?",
  )
    .bind(characterId)
    .first<{
      character_id: string;
      user_id: string;
      summary: string | null;
      published_at: number;
      name: string;
      avatar: string | null;
      greeting: string;
    }>();
  if (!row) return json(404, { message: "公開キャラクターが見つかりません。" });
  return json(200, toCatalogItem(row));
};

// POST /api/catalog/:id/fork — 公開キャラを自分のライブラリへ複製。
// 台帳・記憶・会話は持ち越さない（createCharacterWithVersion で新規作成するだけ）。
export const handleCatalogFork = async (characterId: string): Promise<Response> => {
  const { env } = await getPlatform();
  if (!(await publishedRow(env.DB, characterId)))
    return json(404, { message: "公開キャラクターが見つかりません。" });
  const version = await env.DB.prepare(
    "SELECT content_json FROM character_version WHERE character_id = ? ORDER BY version DESC LIMIT 1",
  )
    .bind(characterId)
    .first<{ content_json: string }>();
  if (!version) return json(404, { message: "公開キャラクターが見つかりません。" });
  let raw: unknown;
  try {
    raw = JSON.parse(version.content_json);
  } catch {
    return json(503, { message: "公開内容を読み込めませんでした。" });
  }
  const content = characterContentSchema.safeParse(raw);
  if (!content.success) return json(503, { message: "公開内容を読み込めませんでした。" });
  const db = createDb(env.DB);
  await ensureLocalUser(db);
  const created = await createCharacterWithVersion(db, LOCAL_USER_ID, content.data);
  return json(201, created);
};
