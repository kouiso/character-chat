import { describe, expect, it } from "vitest";

import { parseSseEvent } from "./sse-events";

const delivery = {
  conversationId: "synthetic-conversation",
  turn: 1,
  generationId: "synthetic-generation",
  serverNow: 1_800_000_000_000,
  chunks: [{ seq: 0, text: "<dialogue>合成の返信</dialogue>", scheduledAt: 1_800_000_000_500 }],
};

describe("delivery SSE parser", () => {
  it("保存済みの予定時刻と識別子を変更せず渡す", () => {
    expect(parseSseEvent("delivery", JSON.stringify(delivery))).toEqual({
      ...delivery,
      type: "delivery",
    });
  });

  it.each([
    { ...delivery, chunks: null },
    { ...delivery, serverNow: "1800000000000" },
    { ...delivery, turn: 0 },
    { ...delivery, chunks: [{ ...delivery.chunks[0], scheduledAt: -1 }] },
    { ...delivery, chunks: [{ ...delivery.chunks[0], scheduledAt: 8_640_000_000_000_001 }] },
    { ...delivery, chunks: [{ ...delivery.chunks[0], seq: 0.5 }] },
    { ...delivery, chunks: [{ ...delivery.chunks[0], text: {} }] },
  ])("不正な配送はタイマーと表示へ渡さない", (invalid) => {
    expect(parseSseEvent("delivery", JSON.stringify(invalid))).toBeNull();
  });

  it("dataのtypeでSSE event種別を上書きしない", () => {
    expect(parseSseEvent("delivery", JSON.stringify({ type: "token", text: "未確定" }))).toBeNull();
  });
});
