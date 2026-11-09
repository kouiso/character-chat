// RIT-190: 動画生成 API の面の確かめ — Body の validation、登録・状態取得の返し方、
// 上流失敗の写像を見る。生成本体は video-generation.test.ts で実 D1 越しに確かめる。
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const platform = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
const start = vi.hoisted(() => vi.fn());
const poll = vi.hoisted(() => vi.fn());

vi.mock("./platform", () => ({ getPlatform: async () => platform }));
vi.mock("./video-generation", () => ({
  startVideoGeneration: start,
  pollVideoGeneration: poll,
}));

const { handleVideoStartRequest, handleVideoStatusRequest } = await import("./api-video");

const post = (body: Record<string, unknown>) =>
  handleVideoStartRequest(
    "char-1",
    new Request("https://example.com/api/chat/char-1/video", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );

const get = (query: string) =>
  handleVideoStatusRequest(
    "char-1",
    new Request(`https://example.com/api/chat/char-1/video?${query}`),
  );

describe("handleVideoStartRequest", () => {
  beforeEach(() => {
    start.mockReset();
    start.mockResolvedValue({ generationId: "gen-1", status: "processing" });
  });

  it("conversationId+messageId を生成呼び出しへ渡し、generationId を返す", async () => {
    const response = await post({ conversationId: "conv-1", messageId: "m-1" });
    expect(response.status).toBe(200);
    expect(start).toHaveBeenCalledWith({
      env: platform.env,
      characterId: "char-1",
      conversationId: "conv-1",
      sourceMessageId: "m-1",
      instruction: undefined,
    });
    const body: { generationId: string; status: string } = await response.json();
    expect(body.generationId).toBe("gen-1");
    expect(body.status).toBe("processing");
  });

  it("conversationId・messageId が欠けたら 400", async () => {
    expect((await post({ conversationId: "conv-1" })).status).toBe(400);
    expect((await post({ messageId: "m-1" })).status).toBe(400);
    expect((await post({})).status).toBe(400);
  });

  it("元画像が無い 404 はそのまま返す", async () => {
    const { ImageGenerationError } = await import("./image-generation");
    start.mockRejectedValue(new ImageGenerationError("元画像が見つかりません。", 404));
    const response = await post({ conversationId: "conv-1", messageId: "m-x" });
    expect(response.status).toBe(404);
  });
});

describe("handleVideoStatusRequest", () => {
  beforeEach(() => {
    poll.mockReset();
    poll.mockResolvedValue({ generationId: "gen-1", status: "ok", messageId: "m-9" });
  });

  it("generationId で状態を返す", async () => {
    const response = await get("generationId=gen-1");
    expect(response.status).toBe(200);
    expect(poll).toHaveBeenCalledWith({
      env: platform.env,
      characterId: "char-1",
      generationId: "gen-1",
    });
    const body: { status: string; messageId?: string } = await response.json();
    expect(body.status).toBe("ok");
    expect(body.messageId).toBe("m-9");
  });

  it("generationId が無ければ 400", async () => {
    expect((await get("")).status).toBe(400);
  });

  it("未知の生成は 404", async () => {
    const { ImageGenerationError } = await import("./image-generation");
    poll.mockRejectedValue(new ImageGenerationError("動画生成が見つかりません。", 404));
    expect((await get("generationId=nope")).status).toBe(404);
  });
});
