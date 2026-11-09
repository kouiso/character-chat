import {
  ConversationAccessError,
  createDb,
  deleteConversationImage,
  listConversationImages,
} from "@v2/db";
import { PROMPT_VERSION } from "@v2/prompt";
import { z } from "zod";

import { LOCAL_USER_ID } from "./identity";
import {
  COMIC_PANEL_COUNT,
  generateConversationComic,
  generateConversationImage,
  ImageGenerationError,
} from "./image-generation";
import { getPlatform } from "./platform";

// RIT-183: 生成パラメータの露出。未指定は確定レシピの既定値へ倒す。
// strength は img2img 専用（後続 SBI）。受け付けて記録へ残すが txt2img では上流へ送らん。
const BodySchema = z.object({
  conversationId: z.string().min(1).max(120),
  cfg: z.number().min(1).max(30).optional(),
  // Novita の seed は 32bit 整数。-1 はランダム指定なのでユーザー入力は 0 以上に限る。
  seed: z.number().int().min(0).max(4294967295).optional(),
  negativePrompt: z.string().max(1024).optional(),
  // SDXL の latent 倍数制約は 8。レシピ値 832x1216 も 32 の倍数。
  width: z.number().int().min(512).max(2048).multipleOf(8).optional(),
  height: z.number().int().min(512).max(2048).multipleOf(8).optional(),
  strength: z.number().min(0).max(1).optional(),
  // i2i（RIT-184）: 参照元は同一会話の画像メッセージ id。依頼文は表情変更等の自由文。
  sourceMessageId: z.string().min(1).max(120).optional(),
  instruction: z.string().max(500).optional(),
});

const json = (status: number, body: Record<string, unknown>): Response =>
  Response.json(body, { status });

const isNotFound = (error: unknown): boolean =>
  error instanceof ImageGenerationError && error.status === 404;

const imageErrorResponse = (error: unknown): Response => {
  if (error instanceof ConversationAccessError || isNotFound(error)) {
    return json(404, { message: "会話またはキャラクターが見つかりません。" });
  }
  if (error instanceof ImageGenerationError) {
    return json(error.status, { message: error.message });
  }
  globalThis.console.error(
    JSON.stringify({ event: "image_generation_error", message: String(error) }),
  );
  return json(500, { message: "画像を生成できませんでした。" });
};

export const handleImageRequest = async (
  characterId: string,
  request: Request,
): Promise<Response> => {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json(400, { message: "JSON形式で送信してください。" });
  }
  const parsed = BodySchema.safeParse(payload);
  if (!parsed.success) return json(400, { message: "送信内容を確認してください。" });
  try {
    const { env } = await getPlatform();
    const { conversationId, sourceMessageId, instruction, ...params } = parsed.data;
    const result = await generateConversationImage({
      env,
      characterId,
      conversationId,
      params,
      sourceMessageId,
      instruction,
    });
    if (!result.ok) return json(result.status, { message: result.message });
    return json(200, {
      messageId: result.messageId,
      imageUrl: result.imageUrl,
      generationId: result.generationId,
    });
  } catch (error) {
    return imageErrorResponse(error);
  }
};

// POST /api/chat/:id/comic — 直近シーンを4コマへ分けて同時生成（RIT-189）。
// コマごとの成否は panels へ個別に入る。全部落ちた時だけ 502 にする。
export const handleComicRequest = async (
  characterId: string,
  request: Request,
): Promise<Response> => {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json(400, { message: "JSON形式で送信してください。" });
  }
  const parsed = z
    .object({
      conversationId: z.string().min(1).max(120),
      // 失敗コマだけの再生成（RIT-189）。束とコマ番号はセットでのみ受ける。
      groupId: z.string().min(1).max(120).optional(),
      panelIndex: z
        .number()
        .int()
        .min(0)
        .max(COMIC_PANEL_COUNT - 1)
        .optional(),
    })
    .safeParse(payload);
  if (!parsed.success) return json(400, { message: "送信内容を確認してください。" });
  const { conversationId, groupId, panelIndex } = parsed.data;
  if ((groupId === undefined) !== (panelIndex === undefined)) {
    return json(400, { message: "送信内容を確認してください。" });
  }
  try {
    const { env } = await getPlatform();
    const result = await generateConversationComic({
      env,
      characterId,
      conversationId,
      groupId,
      panelIndex,
    });
    const panels = result.panels.map((panel) => ({
      panelIndex: panel.panelIndex,
      ok: panel.ok,
      ...(panel.ok
        ? {
            messageId: panel.messageId,
            imageUrl: panel.imageUrl,
            generationId: panel.generationId,
          }
        : { generationId: panel.generationId, message: panel.message }),
    }));
    if (!result.ok) return json(502, { message: "画像を生成できませんでした。", panels });
    return json(200, { groupId: result.groupId, panelCount: COMIC_PANEL_COUNT, panels });
  } catch (error) {
    return imageErrorResponse(error);
  }
};

const storeOpts = (characterId: string) => ({
  userId: LOCAL_USER_ID,
  characterId,
  promptVersion: PROMPT_VERSION,
});

const readQuery = (request: Request, key: string): string | null => {
  const value = new URL(request.url).searchParams.get(key);
  return value && value.length <= 120 ? value : null;
};

// GET /api/chat/:id/images?conversationId=… — この会話で残っとる画像を新しい順で返す（RIT-185）。
// 一覧の正は v2_message なので、消えた画像はここにも出ん。
export const handleImageListRequest = async (
  characterId: string,
  request: Request,
): Promise<Response> => {
  const conversationId = readQuery(request, "conversationId");
  if (!conversationId) return json(400, { message: "conversationIdを指定してください。" });
  try {
    const { env } = await getPlatform();
    const rows = await listConversationImages(
      createDb(env.DB),
      storeOpts(characterId),
      conversationId,
    );
    return json(200, {
      images: rows.map((row) => ({
        messageId: row.id,
        imageUrl: `/api/media/${encodeURIComponent(row.id)}`,
        generationId: row.generationId,
        groupId: row.groupId,
        panelIndex: row.panelIndex,
        // mp4 キーは動画メッセージ（RIT-190）。ギャラリーはこれで <video> 描画へ分ける。
        mediaKind: row.imageKey.endsWith(".mp4") ? ("video" as const) : ("image" as const),
        turn: row.turn,
        createdAt: row.createdAt,
      })),
    });
  } catch (error) {
    if (error instanceof ConversationAccessError) {
      return json(404, { message: "会話またはキャラクターが見つかりません。" });
    }
    throw error;
  }
};

// DELETE /api/chat/:id/images?conversationId=…&messageId=… — 画像メッセージと R2 の実体を消す。
// 消した画像は一覧・タイムライン・i2i 参照元の全部から姿を消す（RIT-185）。
export const handleImageDeleteRequest = async (
  characterId: string,
  request: Request,
): Promise<Response> => {
  const conversationId = readQuery(request, "conversationId");
  const messageId = readQuery(request, "messageId");
  if (!conversationId || !messageId) {
    return json(400, { message: "conversationIdとmessageIdを指定してください。" });
  }
  try {
    const { env } = await getPlatform();
    const imageKey = await deleteConversationImage(
      createDb(env.DB),
      storeOpts(characterId),
      conversationId,
      messageId,
    );
    if (!imageKey) return json(404, { message: "画像が見つかりません。" });
    // D1 の行だけ消すと R2 に実体が残り配信経路外のゴミになるので、実体も消す。
    await env.BUCKET.delete(imageKey);
    return json(200, { deleted: true });
  } catch (error) {
    if (error instanceof ConversationAccessError) {
      return json(404, { message: "会話またはキャラクターが見つかりません。" });
    }
    throw error;
  }
};
