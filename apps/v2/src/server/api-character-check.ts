// GET /api/admin/character-check — キャラ全件を 1 件ずつ検査し、ページに分けて返す。
// 何も書き換えない（D1 へは SELECT、R2 へは head と先頭 12 バイトの get だけ）。
// 結果には本文（system_prompt・greeting）と名義の生の値を入れない。
import { z } from "zod";

import { checkCharacterRow, createDb } from "@v2/db";

import { resolveAvatar, type AvatarEnv, type AvatarStatus } from "./avatar";
import { listOwnerIds, LOCAL_USER_ID } from "./identity";
import { getPlatform } from "./platform";

const querySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(25).optional(),
});

const DEFAULT_LIMIT = 10;

// キャラに付く旧表 7 つ。無い環境（drizzle/ から作った D1）でも 200 で missing を返す。
const LEGACY_LINKED_TABLES = [
  "character_visual",
  "character_sub_image",
  "character_default_outfit_tag",
  "character_distinctive_mark",
  "character_prompt_version",
  "character_undress_progression",
  "character_scene_default",
] as const;

type OwnerKind = "local" | "legacy" | "other";

export type CharacterCheckItem = {
  id: string;
  zod: { ok: boolean; issues: { path: string; message: string }[] };
  visible: boolean;
  published: boolean;
  canEdit: boolean;
  owner: OwnerKind;
  official: boolean;
  avatar: { status: AvatarStatus };
};

const json = (body: unknown, status = 200): Response => Response.json(body, { status });

// apps/v2 から drizzle を直接 import すると @v2/db 側と別インスタンスの型が衝突するので、
// ここも canServeAvatar と同じく生 D1 で読む。
type CharacterPageRow = {
  id: string;
  user_id: string;
  name: string;
  system_prompt: string;
  greeting: string;
  tags: string;
  avatar: string | null;
  gender: string | null;
  slug: string | null;
  is_official: number;
  display_order: number;
  created_at: number;
  published: number;
};

const listCharacterPage = (db: D1Database, cursor: string | undefined, limit: number) =>
  db
    .prepare(
      `SELECT c.id, c.user_id, c.name, c.system_prompt, c.greeting, c.tags, c.avatar,
              c.gender, c.slug, c.is_official, c.display_order, c.created_at,
              p.character_id IS NOT NULL AS published
       FROM character c
       LEFT JOIN v2_character_publish p ON p.character_id = c.id
       ${cursor ? "WHERE c.id > ?" : ""}
       ORDER BY c.id ASC LIMIT ?`,
    )
    .bind(...(cursor ? [cursor] : []), limit + 1)
    .all<CharacterPageRow>();

// 1 件の検査項目を組み立てる。R2・資産の読み失敗は呼び出し側へ投げる（「無い」と混ぜない）。
const toCheckItem = async (
  env: AvatarEnv,
  requestUrl: string,
  owners: readonly string[],
  row: CharacterPageRow,
): Promise<CharacterCheckItem> => {
  const owned = owners.includes(row.user_id);
  const official = row.is_official === 1;
  const avatar = await resolveAvatar(env, requestUrl, row.avatar, "check");
  return {
    id: row.id,
    zod: checkCharacterRow({
      id: row.id,
      name: row.name,
      systemPrompt: row.system_prompt,
      greeting: row.greeting,
      tags: row.tags,
      avatar: row.avatar,
      gender: row.gender,
      slug: row.slug,
      isOfficial: official,
      displayOrder: row.display_order,
      createdAt: row.created_at,
    }),
    visible: owned || official,
    published: row.published === 1,
    canEdit: owned,
    owner: row.user_id === LOCAL_USER_ID ? "local" : owned ? "legacy" : "other",
    official,
    avatar: { status: avatar.status },
  };
};

// R2/資産が読めなかった = 「無い」ではないので、その 1 件を missing にせず失敗した id で返す。
const checkCharacterItems = async (
  env: AvatarEnv,
  requestUrl: string,
  owners: readonly string[],
  page: CharacterPageRow[],
): Promise<{ ok: true; items: CharacterCheckItem[] } | { ok: false; failedId: string }> => {
  const items: CharacterCheckItem[] = [];
  for (const row of page) {
    try {
      items.push(await toCheckItem(env, requestUrl, owners, row));
    } catch {
      return { ok: false, failedId: row.id };
    }
  }
  return { ok: true, items };
};

const countLegacyTable = async (db: D1Database, table: string) => {
  const found = await db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .bind(table)
    .first<{ name: string }>();
  if (!found) return { table, rows: null, missing: true };
  const counted = await db.prepare(`SELECT count(*) AS n FROM "${table}"`).first<{ n: number }>();
  return { table, rows: counted?.n ?? 0, missing: false };
};

const readLegacyLinked = (db: D1Database) =>
  Promise.all(LEGACY_LINKED_TABLES.map((table) => countLegacyTable(db, table)));

// 最初のページだけに旧表の集計を足す。
const firstPageExtras = async (env: { DB: D1Database }, isFirst: boolean) =>
  isFirst ? { legacyLinked: await readLegacyLinked(env.DB) } : {};

const runCharacterCheck = async (
  env: AvatarEnv & { DB: D1Database },
  requestUrl: string,
  cursor: string | undefined,
  limit: number,
): Promise<Response> => {
  try {
    const owners = await listOwnerIds(createDb(env.DB));
    const total = await env.DB.prepare("SELECT count(*) AS n FROM character").first<{
      n: number;
    }>();
    const { results: rows } = await listCharacterPage(env.DB, cursor, limit);

    const page = rows.slice(0, limit);
    const checked = await checkCharacterItems(env, requestUrl, owners, page);
    if (!checked.ok) return json({ code: "storage_failed", id: checked.failedId }, 502);

    return json({
      total: total?.n ?? 0,
      items: checked.items,
      nextCursor: rows.length > limit ? (page.at(-1)?.id ?? null) : null,
      ...(await firstPageExtras(env, cursor === undefined)),
    });
  } catch {
    return json({ code: "db_failed" }, 500);
  }
};

export const handleCharacterCheck = async (request: Request): Promise<Response> => {
  if (request.method !== "GET") return json({ code: "method_not_allowed" }, 405);
  const parsed = querySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams.entries()),
  );
  if (!parsed.success) return json({ code: "bad_request" }, 400);

  const { env } = await getPlatform();
  return runCharacterCheck(
    env as AvatarEnv & { DB: D1Database },
    request.url,
    parsed.data.cursor,
    parsed.data.limit ?? DEFAULT_LIMIT,
  );
};
