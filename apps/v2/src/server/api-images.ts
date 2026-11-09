import { ConversationAccessError } from "@v2/db";
import { z } from "zod";

import { generateConversationImage, ImageGenerationError } from "./image-generation";
import { getPlatform } from "./platform";

const BodySchema = z.object({ conversationId: z.string().min(1).max(120) });

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
    const result = await generateConversationImage({
      env,
      characterId,
      conversationId: parsed.data.conversationId,
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
