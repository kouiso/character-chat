// 動画生成 API（RIT-190）。POST で依頼登録、GET で上流ポーリング経由の状態取得。
// 実体の生成は video-generation.ts。ここは入力検証とエラー写像だけ。
import { z } from "zod";

import { ImageGenerationError } from "./image-generation";
import { getPlatform } from "./platform";
import { pollVideoGeneration, startVideoGeneration } from "./video-generation";

const json = (status: number, body: Record<string, unknown>): Response =>
  Response.json(body, { status });

const errorResponse = (error: unknown): Response => {
  if (error instanceof ImageGenerationError) {
    return json(error.status, { message: error.message });
  }
  throw error;
};

const startSchema = z.object({
  conversationId: z.string().min(1),
  messageId: z.string().min(1),
  instruction: z.string().max(400).optional(),
});

// POST /api/chat/:id/video — ギャラリー画像を first-frame に動画生成を登録する。
// 完了までは数分掛かるので 200 で generationId を返し、進捗は GET でポーリングする。
export const handleVideoStartRequest = async (
  characterId: string,
  request: Request,
): Promise<Response> => {
  const parsed = startSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return json(400, { message: "conversationIdとmessageIdを指定してください。" });
  }
  try {
    const { env } = await getPlatform();
    const result = await startVideoGeneration({
      env,
      characterId,
      conversationId: parsed.data.conversationId,
      sourceMessageId: parsed.data.messageId,
      instruction: parsed.data.instruction,
    });
    return json(200, result);
  } catch (error) {
    return errorResponse(error);
  }
};

// GET /api/chat/:id/video?generationId=… — 生成状態を取得。未終端なら上流を1回ポーリングする。
export const handleVideoStatusRequest = async (
  characterId: string,
  request: Request,
): Promise<Response> => {
  const generationId = new URL(request.url).searchParams.get("generationId");
  if (!generationId) return json(400, { message: "generationIdを指定してください。" });
  try {
    const { env } = await getPlatform();
    const result = await pollVideoGeneration({ env, characterId, generationId });
    return json(200, result);
  } catch (error) {
    return errorResponse(error);
  }
};
