import { describe, expect, it } from "vitest";

import {
  CHUNK_MAX_GAP_MS,
  CHUNK_MS_PER_CHAR,
  chunkSendTimes,
} from "./chunk-schedule";

const BASE = 1_700_000_000_000;

describe("chunkSendTimes (RIT-67: 壊しにいく確かめ)", () => {
  it("先頭は保存時刻と同じ、以降は前の塊の字数に比例して遅れる", () => {
    const times = chunkSendTimes(["ab", "cdef", "x"], BASE);
    expect(times[0]).toBe(BASE);
    expect(times[1]).toBe(BASE + 2 * CHUNK_MS_PER_CHAR);
    expect(times[2]).toBe(BASE + 2 * CHUNK_MS_PER_CHAR + 4 * CHUNK_MS_PER_CHAR);
  });

  it("1 文字だけの塊でも時刻が壊れん", () => {
    const times = chunkSendTimes(["x"], BASE);
    expect(times).toEqual([BASE]);
  });

  it("とても長い塊でも上限を超えん", () => {
    const long = "あ".repeat(100_000);
    const times = chunkSendTimes([long, "次"], BASE);
    expect(times[1] - times[0]).toBe(CHUNK_MAX_GAP_MS);
  });

  it("空の塊・空列でも壊れん", () => {
    expect(chunkSendTimes([], BASE)).toEqual([]);
    const times = chunkSendTimes(["", "次"], BASE);
    expect(times[1]).toBe(BASE);
  });

  it("予定時刻は単調非減少", () => {
    const texts = ["x".repeat(10), "y".repeat(5000), "z", "w".repeat(20)];
    const times = chunkSendTimes(texts, BASE);
    for (let i = 1; i < times.length; i++) {
      expect(times[i]).toBeGreaterThanOrEqual(times[i - 1]);
    }
  });
});
