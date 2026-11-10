// クリップ API（RIT-30 ギャップ）。POST /api/clips で生成登録、GET /api/clips/:id で
// ポーリング、POST /api/clips/:id/play で再生数を加算。一覧・素材画像の読み出しは
// ページの server fn からも同じ関数を引く。
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { ImageGenerationError } from "./image-generation";
import { LOCAL_USER_ID } from "./identity";
import { getPlatform } from "./platform";
import { pollClipGeneration, startClipGeneration } from "./clip-generation";

const json = (status: number, body: Record<string, unknown>): Response =>
  Response.json(body, { status });

const errorResponse = (error: unknown): Response => {
  if (error instanceof ImageGenerationError) {
    return json(error.status, { message: error.message });
  }
  throw error;
};

export type ClipListItem = {
  id: string;
  characterId: string;
  characterName: string;
  status: string;
  prompt: string;
  playCount: number;
  videoUrl?: string;
  failureReason?: string;
  createdAt: number;
};

// 一覧は新しい順。自分のクリップだけ（個人利用なので user_id=local 固定）。
export const listClipRows = async (db: D1Database, userId: string): Promise<ClipListItem[]> => {
  const { results } = await db
    .prepare(
      "SELECT cl.id, cl.character_id AS characterId, c.name AS characterName, cl.status, cl.prompt, " +
        "cl.play_count AS playCount, cl.video_key AS videoKey, cl.failure_reason AS failureReason, " +
        "cl.created_at AS createdAt " +
        "FROM v2_clip cl JOIN character c ON c.id = cl.character_id " +
        "WHERE cl.user_id = ? ORDER BY cl.created_at DESC LIMIT 100",
    )
    .bind(userId)
    .all<Omit<ClipListItem, "videoUrl"> & { videoKey: string | null }>();
  return (results ?? []).map((row) => ({
    ...row,
    videoUrl:
      row.status === "ok" && row.videoKey
        ? `/api/clip-media/${encodeURIComponent(row.id)}`
        : undefined,
  }));
};

export type ClippableImage = {
  imageGenerationId: string;
  messageId: string;
  imageUrl: string;
  createdAt: number;
};

// 創作センターの素材選択肢。first-frame にできるのは生成済み画像だけ。
// 表示 URL は message_id 経由の既存 /api/media で所有者確認つき配信に乗せる。
export const listClippableImages = async (
  db: D1Database,
  characterId: string,
): Promise<ClippableImage[]> => {
  const { results } = await db
    .prepare(
      "SELECT ig.id AS imageGenerationId, ig.message_id AS messageId, ig.created_at AS createdAt " +
        "FROM v2_image_generation ig " +
        "WHERE ig.character_id = ? AND ig.status = 'ok' AND ig.image_key IS NOT NULL " +
        "AND ig.message_id IS NOT NULL ORDER BY ig.created_at DESC LIMIT 24",
    )
    .bind(characterId)
    .all<Omit<ClippableImage, "imageUrl">>();
  return (results ?? []).map((row) => ({
    ...row,
    imageUrl: `/api/media/${encodeURIComponent(row.messageId)}`,
  }));
};

const startSchema = z.object({
  characterId: z.string().min(1).max(120),
  imageGenerationId: z.string().min(1).max(120),
  instruction: z.string().max(400).optional(),
});

// POST /api/clips — クリップ生成の登録。完了までは数分掛かるので id を返し GET でポーリング。
export const handleClipStartRequest = async (request: Request): Promise<Response> => {
  const parsed = startSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return json(400, { message: "characterIdとimageGenerationIdを指定してください。" });
  }
  try {
    const { env } = await getPlatform();
    const result = await startClipGeneration({
      env,
      userId: LOCAL_USER_ID,
      characterId: parsed.data.characterId,
      imageGenerationId: parsed.data.imageGenerationId,
      instruction: parsed.data.instruction,
    });
    return json(200, result);
  } catch (error) {
    return errorResponse(error);
  }
};

// GET /api/clips/:id — 生成状態。未終端なら上流を1回ポーリングする。
export const handleClipStatusRequest = async (clipId: string): Promise<Response> => {
  try {
    const { env } = await getPlatform();
    const result = await pollClipGeneration({ env, userId: LOCAL_USER_ID, clipId });
    return json(200, result);
  } catch (error) {
    return errorResponse(error);
  }
};

// POST /api/clips/:id/play — 再生数を1足す。自分のクリップだけ加算可。
export const handleClipPlayRequest = async (clipId: string): Promise<Response> => {
  const { env } = await getPlatform();
  const updated = await env.DB.prepare(
    "UPDATE v2_clip SET play_count = play_count + 1 WHERE id = ? AND user_id = ? AND status = 'ok'",
  )
    .bind(clipId, LOCAL_USER_ID)
    .run();
  if (!updated.meta.changes) {
    return json(404, { message: "クリップが見つかりません。" });
  }
  const row = await env.DB.prepare("SELECT play_count AS playCount FROM v2_clip WHERE id = ?")
    .bind(clipId)
    .first<{ playCount: number }>();
  return json(200, { playCount: row?.playCount ?? 0 });
};

// GET /api/clip-media/:id — 動画配信。所有者確認つき（他人のクリップは 404）。
export const readClipVideoKey = async (db: D1Database, clipId: string): Promise<string | null> => {
  const row = await db
    .prepare("SELECT video_key AS videoKey FROM v2_clip WHERE id = ? AND user_id = ?")
    .bind(clipId, LOCAL_USER_ID)
    .first<{ videoKey: string | null }>();
  return row?.videoKey ?? null;
};

// ページ loader 用の server fn。REST 経由にせんのは型をそのまま往復させるため。
export const listClips = createServerFn({ method: "GET" }).handler(
  async (): Promise<ClipListItem[]> => {
    const { env } = await getPlatform();
    return listClipRows(env.DB, LOCAL_USER_ID);
  },
);

export const listClipImages = createServerFn({ method: "GET" })
  .validator((characterId: string) => characterId)
  .handler(async ({ data: characterId }): Promise<ClippableImage[]> => {
    const { env } = await getPlatform();
    return listClippableImages(env.DB, characterId);
  });
