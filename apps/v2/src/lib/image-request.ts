// 会話起点の画像生成（RIT-182）のクライアント側要求。
// 起動 → poll で状態を進めて、完了したら履歴の読み直しで画像メッセージが画面へ出る。
import { z } from "zod";

export type ImageGenerationStatus = "running" | "succeeded" | "failed";

const messageBodySchema = z.object({ message: z.string().optional() });
const createBodySchema = z.object({ generationId: z.string().min(1) });
const statusBodySchema = z.object({
  status: z.enum(["running", "succeeded", "failed"]),
  reason: z.string().optional(),
  messageId: z.string().optional(),
});

const readMessage = async (response: Response): Promise<string> => {
  try {
    const body = messageBodySchema.safeParse(await response.json());
    return body.success && body.data.message
      ? body.data.message
      : `要求が拒否されました（${response.status}）。`;
  } catch {
    return `要求が拒否されました（${response.status}）。`;
  }
};

export class ImageGenerationError extends Error {}

export const requestImageGeneration = async (input: {
  characterId: string;
  conversationId: string;
}): Promise<string> => {
  const response = await fetch(`/api/chat/${encodeURIComponent(input.characterId)}/images`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ conversationId: input.conversationId }),
  });
  if (!response.ok) throw new ImageGenerationError(await readMessage(response));
  const body = createBodySchema.safeParse(await response.json());
  if (!body.success) throw new ImageGenerationError("生成の受付に失敗しました。");
  return body.data.generationId;
};

export type ImageStatusResponse = {
  status: ImageGenerationStatus;
  reason?: string;
  messageId?: string;
};

export const readImageGeneration = async (generationId: string): Promise<ImageStatusResponse> => {
  const response = await fetch(`/api/image-generations/${encodeURIComponent(generationId)}`);
  if (!response.ok) throw new ImageGenerationError(await readMessage(response));
  const body = statusBodySchema.safeParse(await response.json());
  if (!body.success) throw new ImageGenerationError("生成状況を確認できませんでした。");
  return body.data;
};

const POLL_INTERVAL_MS = 2_500;
const POLL_TIMEOUT_MS = 200_000;

// poll ごとにサーバ側で上流の状態が進む。完了/失敗で抜け、時間切れは失敗扱い。
export const waitImageGeneration = async (
  generationId: string,
  signal: AbortSignal,
): Promise<ImageStatusResponse> => {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (signal.aborted) throw new DOMException("aborted", "AbortError");
    const status = await readImageGeneration(generationId);
    if (status.status !== "running") return status;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  return { status: "failed", reason: "生成が時間内に完了しませんでした。" };
};
