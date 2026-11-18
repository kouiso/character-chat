// アルバム（板 Album）: 届いた画像とクリップを時系列で並べる一覧の読み出し。
// 正は v2_message（消した画像は出ん）と v2_clip（ok の実体だけ）。
// 種類は 画像 / 4コマ（group_id つき）/ クリップ（v2_clip・mp4 動画メッセージ）で絞る。

export type AlbumItemKind = "image" | "comic" | "clip";

export type AlbumItem = {
  id: string;
  kind: AlbumItemKind;
  characterId: string;
  characterName: string;
  // 画像は /api/media/:messageId、クリップは /api/clip-media/:id の所有者確認つき配信。
  mediaUrl: string;
  mediaKind: "image" | "video";
  groupId: string | null;
  createdAt: number;
};

type ImageRow = {
  messageId: string;
  imageKey: string;
  characterId: string;
  characterName: string;
  groupId: string | null;
  createdAt: number;
};

type ClipRow = {
  id: string;
  characterId: string;
  characterName: string;
  createdAt: number;
};

// 画像の一覧。他人の会話は conv.user_id で除外。漫画のコマは group_id が揃うので別種にする。
const listImageRows = async (db: D1Database, userId: string): Promise<ImageRow[]> => {
  const { results } = await db
    .prepare(
      "SELECT m.id AS messageId, m.image_key AS imageKey, m.created_at AS createdAt, " +
        "conv.character_id AS characterId, c.name AS characterName, ig.group_id AS groupId " +
        "FROM v2_message m " +
        "JOIN v2_conversation conv ON conv.id = m.conversation_id " +
        "JOIN character c ON c.id = conv.character_id " +
        "LEFT JOIN v2_image_generation ig ON ig.message_id = m.id " +
        "WHERE conv.user_id = ? AND m.active = 1 AND m.image_key IS NOT NULL " +
        "ORDER BY m.created_at DESC, m.id DESC LIMIT 300",
    )
    .bind(userId)
    .all<ImageRow>();
  return results ?? [];
};

// クリップの一覧。生成中・失敗は実体が無いので出さん（板の「描いています」は会話側の仕事）。
const listClipRows = async (db: D1Database, userId: string): Promise<ClipRow[]> => {
  const { results } = await db
    .prepare(
      "SELECT cl.id, cl.character_id AS characterId, c.name AS characterName, cl.created_at AS createdAt " +
        "FROM v2_clip cl JOIN character c ON c.id = cl.character_id " +
        "WHERE cl.user_id = ? AND cl.status = 'ok' AND cl.video_key IS NOT NULL " +
        "ORDER BY cl.created_at DESC LIMIT 200",
    )
    .bind(userId)
    .all<ClipRow>();
  return results ?? [];
};

const KIND_ORDER: Record<AlbumItemKind, number> = { image: 0, comic: 1, clip: 2 };

export const listAlbumItems = async (db: D1Database, userId: string): Promise<AlbumItem[]> => {
  const [images, clips] = await Promise.all([listImageRows(db, userId), listClipRows(db, userId)]);
  const items: AlbumItem[] = [
    ...images.map((row): AlbumItem => {
      const isVideo = row.imageKey.endsWith(".mp4");
      return {
        id: row.messageId,
        kind: row.groupId ? "comic" : isVideo ? "clip" : "image",
        characterId: row.characterId,
        characterName: row.characterName,
        mediaUrl: `/api/media/${encodeURIComponent(row.messageId)}`,
        mediaKind: isVideo ? "video" : "image",
        groupId: row.groupId,
        createdAt: row.createdAt,
      };
    }),
    ...clips.map((row): AlbumItem => ({
      id: `clip-${row.id}`,
      kind: "clip",
      characterId: row.characterId,
      characterName: row.characterName,
      mediaUrl: `/api/clip-media/${encodeURIComponent(row.id)}`,
      mediaKind: "video",
      groupId: null,
      createdAt: row.createdAt,
    })),
  ];
  // 同刻は動画系（クリップ）を先に。板の並びは新しい順だけなので種類順は安定ソートのタイブレーク。
  return items.sort((a, b) => b.createdAt - a.createdAt || KIND_ORDER[b.kind] - KIND_ORDER[a.kind]);
};
