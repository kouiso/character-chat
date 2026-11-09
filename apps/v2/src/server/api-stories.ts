// 章構成ストーリー API（RIT-214）。story=キャラ＋世界観、chapter=順序・本文・ナレーション。
// 全操作は所有ストーリーのみ。並び替えは ids 配列の順に ord を振り直す。
import { z } from "zod";

import { LOCAL_USER_ID } from "./identity";
import { getPlatform } from "./platform";

const json = (status: number, body: Record<string, unknown> | unknown[]): Response =>
  Response.json(body, { status });

const newId = (): string => crypto.randomUUID();

const ownsCharacter = async (db: D1Database, characterId: string): Promise<boolean> => {
  const row = await db
    .prepare("SELECT user_id FROM character WHERE id = ?")
    .bind(characterId)
    .first<{ user_id: string }>();
  return row?.user_id === LOCAL_USER_ID;
};

const ownsStory = async (db: D1Database, storyId: string): Promise<boolean> => {
  const row = await db
    .prepare("SELECT user_id FROM v2_story WHERE id = ?")
    .bind(storyId)
    .first<{ user_id: string }>();
  return row?.user_id === LOCAL_USER_ID;
};

const storyListQuery = `
  SELECT s.id, s.title, s.character_id AS characterId, s.worldview, s.updated_at AS updatedAt,
         c.name AS characterName,
         (SELECT COUNT(*) FROM v2_chapter ch WHERE ch.story_id = s.id) AS chapterCount
  FROM v2_story s
  LEFT JOIN character c ON c.id = s.character_id
  WHERE s.user_id = ?
  ORDER BY s.updated_at DESC`;

export type StoryListRow = {
  id: string;
  title: string;
  characterId: string;
  characterName: string | null;
  worldview: string;
  updatedAt: number;
  chapterCount: number;
};

export type ChapterRow = {
  id: string;
  ord: number;
  title: string;
  body: string;
  narration: string;
  imageKey: string | null;
  comicKeys: string | null;
  videoKey: string | null;
  videoTaskId: string | null;
  updatedAt: number;
};

export type StoryDetailRow = {
  id: string;
  title: string;
  characterId: string;
  worldview: string;
  createdAt: number;
  updatedAt: number;
  chapters: ChapterRow[];
};

// ページ loader（server fn）と API の共用クエリ。
export const listStoryRows = (db: D1Database) =>
  db.prepare(storyListQuery).bind(LOCAL_USER_ID).all<StoryListRow>();

export const storyDetailRows = async (
  db: D1Database,
  storyId: string,
): Promise<StoryDetailRow | null> => {
  const story = await db
    .prepare(
      "SELECT id, title, character_id AS characterId, worldview, created_at AS createdAt, updated_at AS updatedAt FROM v2_story WHERE id = ? AND user_id = ?",
    )
    .bind(storyId, LOCAL_USER_ID)
    .first<Omit<StoryDetailRow, "chapters">>();
  if (!story) return null;
  const { results: chapters } = await db
    .prepare(
      "SELECT id, ord, title, body, narration, image_key AS imageKey, comic_keys AS comicKeys, video_key AS videoKey, video_task_id AS videoTaskId, updated_at AS updatedAt FROM v2_chapter WHERE story_id = ? ORDER BY ord ASC",
    )
    .bind(storyId)
    .all<ChapterRow>();
  return { ...story, chapters };
};

export const handleStoriesGet = async (): Promise<Response> => {
  const { env } = await getPlatform();
  const { results } = await listStoryRows(env.DB);
  return json(200, results);
};

const createBodySchema = z.object({
  characterId: z.string().min(1),
  title: z.string().min(1).max(120),
  worldview: z.string().max(8000).optional(),
});

export const handleStoriesPost = async (request: Request): Promise<Response> => {
  const parsed = createBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json(400, { error: "invalid_body" });
  const { env } = await getPlatform();
  if (!(await ownsCharacter(env.DB, parsed.data.characterId)))
    return json(404, { error: "character_not_found" });
  const id = newId();
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO v2_story (id, user_id, character_id, title, worldview, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      id,
      LOCAL_USER_ID,
      parsed.data.characterId,
      parsed.data.title,
      parsed.data.worldview ?? "",
      now,
      now,
    )
    .run();
  return json(201, { id });
};

export const handleStoryGet = async (storyId: string): Promise<Response> => {
  const { env } = await getPlatform();
  const detail = await storyDetailRows(env.DB, storyId);
  if (!detail) return json(404, { error: "story_not_found" });
  return json(200, detail);
};

const patchSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  worldview: z.string().max(8000).optional(),
});

export const handleStoryPut = async (storyId: string, request: Request): Promise<Response> => {
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json(400, { error: "invalid_body" });
  const { env } = await getPlatform();
  if (!(await ownsStory(env.DB, storyId))) return json(404, { error: "story_not_found" });
  const cur = await env.DB.prepare("SELECT title, worldview FROM v2_story WHERE id = ?")
    .bind(storyId)
    .first<{ title: string; worldview: string }>();
  await env.DB.prepare("UPDATE v2_story SET title = ?, worldview = ?, updated_at = ? WHERE id = ?")
    .bind(
      parsed.data.title ?? cur?.title ?? "",
      parsed.data.worldview ?? cur?.worldview ?? "",
      Date.now(),
      storyId,
    )
    .run();
  return json(200, { ok: true });
};

export const handleStoryDelete = async (storyId: string): Promise<Response> => {
  const { env } = await getPlatform();
  if (!(await ownsStory(env.DB, storyId))) return json(404, { error: "story_not_found" });
  await env.DB.prepare("DELETE FROM v2_chapter WHERE story_id = ?").bind(storyId).run();
  await env.DB.prepare("DELETE FROM v2_story WHERE id = ?").bind(storyId).run();
  return json(200, { ok: true });
};

const chapterBodySchema = z.object({
  title: z.string().max(120).optional(),
  body: z.string().max(40000).optional(),
  narration: z.string().max(8000).optional(),
});

export const handleChapterPost = async (storyId: string, request: Request): Promise<Response> => {
  const parsed = chapterBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json(400, { error: "invalid_body" });
  const { env } = await getPlatform();
  if (!(await ownsStory(env.DB, storyId))) return json(404, { error: "story_not_found" });
  const top = await env.DB.prepare("SELECT MAX(ord) AS m FROM v2_chapter WHERE story_id = ?")
    .bind(storyId)
    .first<{ m: number | null }>();
  const id = newId();
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO v2_chapter (id, story_id, ord, title, body, narration, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      id,
      storyId,
      (top?.m ?? -1) + 1,
      parsed.data.title ?? "",
      parsed.data.body ?? "",
      parsed.data.narration ?? "",
      now,
      now,
    )
    .run();
  return json(201, { id });
};

const ownsChapter = async (
  db: D1Database,
  storyId: string,
  chapterId: string,
): Promise<boolean> => {
  const row = await db
    .prepare(
      "SELECT s.user_id FROM v2_chapter ch JOIN v2_story s ON s.id = ch.story_id WHERE ch.id = ? AND ch.story_id = ?",
    )
    .bind(chapterId, storyId)
    .first<{ user_id: string }>();
  return row?.user_id === LOCAL_USER_ID;
};

type ChapterPatch = { title?: string; body?: string; narration?: string };

const mergeChapterPatch = (
  patch: ChapterPatch,
  cur: { title: string; body: string; narration: string } | null,
): [string, string, string] => [
  patch.title ?? cur?.title ?? "",
  patch.body ?? cur?.body ?? "",
  patch.narration ?? cur?.narration ?? "",
];

// 章削除後の欠番を残さないよう残存章の ord を詰め直す。
const repackChapterOrd = async (db: D1Database, storyId: string): Promise<void> => {
  const { results } = await db
    .prepare("SELECT id FROM v2_chapter WHERE story_id = ? ORDER BY ord ASC")
    .bind(storyId)
    .all<{ id: string }>();
  let i = 0;
  for (const row of results) {
    await db.prepare("UPDATE v2_chapter SET ord = ? WHERE id = ?").bind(i, row.id).run();
    i += 1;
  }
};

export const handleChapterPut = async (
  storyId: string,
  chapterId: string,
  request: Request,
): Promise<Response> => {
  const parsed = chapterBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json(400, { error: "invalid_body" });
  const { env } = await getPlatform();
  if (!(await ownsChapter(env.DB, storyId, chapterId)))
    return json(404, { error: "chapter_not_found" });
  const cur = await env.DB.prepare("SELECT title, body, narration FROM v2_chapter WHERE id = ?")
    .bind(chapterId)
    .first<{ title: string; body: string; narration: string }>();
  const [title, body, narration] = mergeChapterPatch(parsed.data, cur);
  await env.DB.prepare(
    "UPDATE v2_chapter SET title = ?, body = ?, narration = ?, updated_at = ? WHERE id = ?",
  )
    .bind(title, body, narration, Date.now(), chapterId)
    .run();
  return json(200, { ok: true });
};

export const handleChapterDelete = async (
  storyId: string,
  chapterId: string,
): Promise<Response> => {
  const { env } = await getPlatform();
  if (!(await ownsChapter(env.DB, storyId, chapterId)))
    return json(404, { error: "chapter_not_found" });
  await env.DB.prepare("DELETE FROM v2_chapter WHERE id = ?").bind(chapterId).run();
  await repackChapterOrd(env.DB, storyId);
  return json(200, { ok: true });
};

const reorderSchema = z.object({ ids: z.array(z.string()).min(1) });

export const handleChapterReorder = async (
  storyId: string,
  request: Request,
): Promise<Response> => {
  const parsed = reorderSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json(400, { error: "invalid_body" });
  const { env } = await getPlatform();
  if (!(await ownsStory(env.DB, storyId))) return json(404, { error: "story_not_found" });
  const { results } = await env.DB.prepare("SELECT id FROM v2_chapter WHERE story_id = ?")
    .bind(storyId)
    .all<{ id: string }>();
  const valid = new Set(results.map((r) => r.id));
  // 送られてきた ids は当該ストーリーの章集合と完全一致のみ受理（部分集合だと欠番化する）。
  if (parsed.data.ids.length !== valid.size || parsed.data.ids.some((id) => !valid.has(id)))
    return json(400, { error: "invalid_ids" });
  let i = 0;
  for (const id of parsed.data.ids) {
    await env.DB.prepare("UPDATE v2_chapter SET ord = ? WHERE id = ?").bind(i, id).run();
    i += 1;
  }
  return json(200, { ok: true });
};
