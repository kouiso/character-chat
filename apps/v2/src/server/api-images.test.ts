// RIT-183: 画像生成パラメータ露出の API 面の確かめ — Body の validation と
// 指定値が generateConversationImage へそのまま渡ることを見る。
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as ImageGen from "./image-generation";

const platform = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
const generate = vi.hoisted(() => vi.fn());

vi.mock("./platform", () => ({ getPlatform: async () => platform }));
vi.mock("./image-generation", async (importOriginal) => ({
  ...(await importOriginal<typeof ImageGen>()),
  generateConversationImage: generate,
}));

const { handleImageRequest } = await import("./api-images");

const post = (body: Record<string, unknown>) =>
  handleImageRequest(
    "char-1",
    new Request("https://example.com/api/chat/char-1/images", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );

describe("handleImageRequest", () => {
  beforeEach(() => {
    generate.mockReset();
    generate.mockResolvedValue({
      ok: true,
      messageId: "m1",
      imageUrl: "/api/media/m1",
      generationId: "g1",
    });
  });

  it("指定したパラメータが生成呼び出しへそのまま渡る", async () => {
    const response = await post({
      conversationId: "conv-1",
      cfg: 9,
      seed: 42,
      negativePrompt: "monochrome",
      width: 1024,
      height: 768,
      strength: 0.4,
    });
    expect(response.status).toBe(200);
    expect(generate).toHaveBeenCalledWith({
      env: platform.env,
      characterId: "char-1",
      conversationId: "conv-1",
      params: {
        cfg: 9,
        seed: 42,
        negativePrompt: "monochrome",
        width: 1024,
        height: 768,
        strength: 0.4,
      },
    });
  });

  it("i2i の参照元・依頼文が生成呼び出しへ渡る（RIT-184）", async () => {
    const response = await post({
      conversationId: "conv-1",
      sourceMessageId: "msg-9",
      instruction: "怒った顔",
      strength: 0.6,
    });
    expect(response.status).toBe(200);
    expect(generate).toHaveBeenCalledWith({
      env: platform.env,
      characterId: "char-1",
      conversationId: "conv-1",
      params: { strength: 0.6 },
      sourceMessageId: "msg-9",
      instruction: "怒った顔",
    });
  });

  it("未指定なら params は空のまま渡る（既定値は生成側で倒す）", async () => {
    const response = await post({ conversationId: "conv-1" });
    expect(response.status).toBe(200);
    expect(generate).toHaveBeenCalledWith({
      env: platform.env,
      characterId: "char-1",
      conversationId: "conv-1",
      params: {},
    });
  });

  it.each([
    ["cfg 範囲外", { cfg: 0 }],
    ["cfg 上限超え", { cfg: 31 }],
    ["seed 負数", { seed: -1 }],
    ["width 範囲外", { width: 256 }],
    ["width が 8 の倍数でない", { width: 833 }],
    ["height 上限超え", { height: 4096 }],
    ["strength 範囲外", { strength: 1.5 }],
    ["negativePrompt 長すぎ", { negativePrompt: "a".repeat(1025) }],
    ["instruction 長すぎ", { instruction: "a".repeat(501) }],
    ["sourceMessageId 空", { sourceMessageId: "" }],
  ])("異常値は 400: %s", async (_label, extra) => {
    const response = await post({ conversationId: "conv-1", ...extra });
    expect(response.status).toBe(400);
    expect(generate).not.toHaveBeenCalled();
  });
});
