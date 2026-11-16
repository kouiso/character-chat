// GET /api/admin/character-check — キャラ全件を 1 件ずつ検査し、ページに分けて返す。
// 何も書き換えない（D1 へは SELECT、R2 へは head と先頭 12 バイトの get だけ）。
// 結果には本文（system_prompt・greeting）と名義の生の値を入れない。
import { asc, count, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";

import { characterTable, checkCharacterRow, createDb, v2CharacterPublishTable } from "@v2/db";

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

const readLegacyLinked = async (db: D1Database) => {
  const linked: { table: string; rows: number | null; missing: boolean }[] = [];
  for (const table of LEGACY_LINKED_TABLES) {
    const found = await db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .bind(table)
      .first<{ name: string }>();
    if (!found) {
      linked.push({ table, rows: null, missing: true });
      continue;
    }
    const counted = await db.prepare(`SELECT count(*) AS n FROM "${table}"`).first<{ n: number }>();
    linked.push({ table, rows: counted?.n ?? 0, missing: false });
  }
  return linked;
};

export const handleCharacterCheck = async (request: Request): Promise<Response> => {
  if (request.method !== "GET") return json({ code: "method_not_allowed" }, 405);
  const parsed = querySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams.entries()),
  );
  if (!parsed.success) return json({ code: "bad_request" }, 400);
  const { cursor } = parsed.data;
  const limit = parsed.data.limit ?? DEFAULT_LIMIT;

  const { env } = await getPlatform();
  const checkEnv = env as AvatarEnv & { DB: D1Database };
  try {
    const db = createDb(checkEnv.DB);
    const owners = await listOwnerIds(db);
    const [total] = await db.select({ n: count() }).from(characterTable);
    const rows = await db
      .select({
        id: characterTable.id,
        userId: characterTable.userId,
        name: characterTable.name,
        systemPrompt: characterTable.systemPrompt,
        greeting: characterTable.greeting,
        tags: sql<string>`${characterTable.tags}`,
        avatar: characterTable.avatar,
        gender: characterTable.gender,
        slug: characterTable.slug,
        isOfficial: characterTable.isOfficial,
        displayOrder: characterTable.displayOrder,
        createdAt: characterTable.createdAt,
        published: sql<boolean>`${v2CharacterPublishTable.characterId} is not null`.mapWith(
          Boolean,
        ),
      })
      .from(characterTable)
      .leftJoin(v2CharacterPublishTable, eq(v2CharacterPublishTable.characterId, characterTable.id))
      .where(cursor ? gt(characterTable.id, cursor) : undefined)
      .orderBy(asc(characterTable.id))
      .limit(limit + 1);

    const page = rows.slice(0, limit);
    const items: CharacterCheckItem[] = [];
    let currentId = "";
    try {
      for (const row of page) {
        currentId = row.id;
        const owned = owners.includes(row.userId);
        const avatar = await resolveAvatar(checkEnv, request.url, row.avatar, "check");
        items.push({
          id: row.id,
          zod: checkCharacterRow(row),
          visible: owned || row.isOfficial,
          published: row.published,
          canEdit: owned,
          owner: row.userId === LOCAL_USER_ID ? "local" : owned ? "legacy" : "other",
          official: row.isOfficial,
          avatar: { status: avatar.status },
        });
      }
    } catch {
      // R2/資産が読めなかった = 「無い」ではないので、その 1 件を missing にせず全体を 502 にする。
      return json({ code: "storage_failed", id: currentId }, 502);
    }

    return json({
      total: total.n,
      items,
      nextCursor: rows.length > limit ? (page.at(-1)?.id ?? null) : null,
      ...(cursor === undefined ? { legacyLinked: await readLegacyLinked(checkEnv.DB) } : {}),
    });
  } catch {
    return json({ code: "db_failed" }, 500);
  }
};
