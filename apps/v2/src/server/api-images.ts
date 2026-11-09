import { ConversationAccessError } from "@v2/db";
import { z } from "zod";

import { generateConversationImage, ImageGenerationError } from "./image-generation";
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
});

const json = (status: number, body: Record<string, unknown>): Response =>
  Response.json(body, { status });

const isNotFound = (error: unknown): boolean =>
  error instanceof ImageGenerationError && error.status === 404;

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
    const { conversationId, ...params } = parsed.data;
    const result = await generateConversationImage({
      env,
      characterId,
      conversationId,
      params,
    });
    if (!result.ok) return json(result.status, { message: result.message });
    return json(200, {
      messageId: result.messageId,
      imageUrl: result.imageUrl,
      generationId: result.generationId,
    });
  } catch (error) {
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
  }
};
