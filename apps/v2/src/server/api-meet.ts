// 出会う（板 Meet・MeetList・MeetEmpty）: 会える子の一覧と「とっておく」の印。
// 一覧の正は character（local・公式・移行元名義）。公開カタログ（v2_character_publish）は
// 仕様書でも「あとで足す」なのでここには混ぜん（板は「公式と自作のキャラ」だけを描く）。
import { z } from "zod";

import { canAccessCharacter } from "./character-access";
import { LOCAL_USER_ID } from "./identity";
import { getPlatform } from "./platform";

const json = (status: number, body: Record<string, unknown>): Response =>
  Response.json(body, { status });

export type MeetCharacter = {
  id: string;
  name: string;
  avatar: string | null;
  greeting: string;
  tags: string[];
  official: boolean;
  // 持ち主の子（板の「つくった子」札）。公式は own=false。
  own: boolean;
  // 会話があれば最後に話した時刻（板の「話したことがある」札）
  lastTalkedAt: number | null;
  keptAt: number | null;
};

type MeetRow = {
  id: string;
  name: string;
  avatar: string | null;
  greeting: string | null;
  tags: string | null;
  official: number;
  own: number;
  last_talked_at: number | null;
  kept_at: number | null;
};

const tagsSchema = z.array(z.string());

// tags 列は JSON 文字列。壊れた行は札なしとして出す（loadCharacter の failures 集約と同じ考え）。
const parseTags = (raw: string | null): string[] => {
  if (!raw) return [];
  try {
    return tagsSchema.parse(JSON.parse(raw));
  } catch {
    return [];
  }
};

// 会える子 = local・移行元名義・公式。並びは板どおり「公式の子 → つくった子」
// （MeetList は公式カードが先、つくった子の札つきカードが後に並ぶ）。
export const listMeetCharacters = async (
  db: D1Database,
  userId: string = LOCAL_USER_ID,
): Promise<MeetCharacter[]> => {
  const { results } = await db
    .prepare(
      "SELECT c.id, c.name, c.avatar, c.greeting, c.tags, c.is_official AS official, " +
        "CASE WHEN c.user_id = ? OR c.user_id IN (" +
        "SELECT legacy_source_user_id FROM v2_conversation WHERE legacy_source_user_id IS NOT NULL" +
        ") THEN 1 ELSE 0 END AS own, " +
        "(SELECT MAX(conv.updated_at) FROM v2_conversation conv " +
        "WHERE conv.character_id = c.id AND conv.user_id = ?) AS last_talked_at, " +
        "(SELECT k.kept_at FROM v2_character_keep k " +
        "WHERE k.character_id = c.id AND k.user_id = ?) AS kept_at " +
        "FROM character c " +
        "WHERE c.user_id = ? OR c.is_official = 1 OR c.user_id IN (" +
        "SELECT legacy_source_user_id FROM v2_conversation WHERE legacy_source_user_id IS NOT NULL" +
        ") " +
        "ORDER BY c.is_official DESC, c.display_order ASC, c.created_at ASC",
    )
    .bind(userId, userId, userId, userId)
    .all<MeetRow>();
  return (results ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    avatar: row.avatar,
    greeting: row.greeting ?? "",
    tags: parseTags(row.tags),
    official: row.official === 1,
    own: row.own === 1,
    lastTalkedAt: row.last_talked_at,
    keptAt: row.kept_at,
  }));
};

// PUT /api/characters/:id/keep — とっておく（冪等 upsert）
export const handleKeepSet = async (characterId: string): Promise<Response> => {
  const { env } = await getPlatform();
  if (!(await canAccessCharacter(env.DB, characterId)))
    return json(404, { message: "キャラクターが見つかりません。" });
  await env.DB.prepare(
    "INSERT INTO v2_character_keep (character_id, user_id, kept_at) VALUES (?, ?, ?) " +
      "ON CONFLICT(character_id, user_id) DO NOTHING",
  )
    .bind(characterId, LOCAL_USER_ID, Date.now())
    .run();
  return json(200, { kept: true });
};

// DELETE /api/characters/:id/keep — とっておくを外す
export const handleKeepUnset = async (characterId: string): Promise<Response> => {
  const { env } = await getPlatform();
  await env.DB.prepare("DELETE FROM v2_character_keep WHERE character_id = ? AND user_id = ?")
    .bind(characterId, LOCAL_USER_ID)
    .run();
  return json(200, { kept: false });
};
