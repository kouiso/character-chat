import { describe, expect, it } from "vitest";

import { scheduleChunks } from "./chunk-schedule";

describe("返信の塊ごとの予定時刻", () => {
  it("本文の字数に比例して順に遅らせ、長い塊でも間隔を上限内に収める", () => {
    const chunks = [
      { text: "<dialogue>あ</dialogue>" },
      { text: "<action>😀い</action>" },
      { text: "う".repeat(20_000) },
      { text: "" },
    ];
    expect(scheduleChunks(chunks, 1_000).map((chunk) => chunk.scheduledAt)).toEqual([
      1_050, 1_150, 6_150, 6_150,
    ]);
    expect(chunks[0]).toEqual({ text: "<dialogue>あ</dialogue>" });
  });

  it("空の返事では保存する予定も増やさない", () => {
    expect(scheduleChunks([], 1_000)).toEqual([]);
  });

  it.each([NaN, Infinity, -1, Number.MAX_SAFE_INTEGER])(
    "不正な基準時刻は保存前に拒否する (%s)",
    (now) => {
      expect(() => scheduleChunks([{ text: "あ" }], now)).toThrow(RangeError);
    },
  );
});
