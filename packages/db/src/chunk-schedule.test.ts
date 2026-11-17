import { describe, expect, it } from "vitest";

import {
  CHUNK_MAX_GAP_MS,
  CHUNK_MS_PER_CHAR,
  chunkGapMs,
  chunkSendTimes,
  chunkVisibleLength,
} from "./chunk-schedule";

const BASE = 1_700_000_000_000;

describe("chunkGapMs / chunkVisibleLength (RIT-67 U-1・U-2)", () => {
  it("U-1: 間は前の塊の見える字数×20（上限 8000）。最初・空は 0、タグは数えん", () => {
    expect(chunkGapMs(undefined)).toBe(0);
    expect(chunkGapMs("")).toBe(0);
    expect(chunkGapMs("ab")).toBe(40);
    expect(chunkGapMs("あ".repeat(400))).toBe(CHUNK_MAX_GAP_MS);
    expect(chunkGapMs("あ".repeat(100_000))).toBe(CHUNK_MAX_GAP_MS);
    // タグは画面に出んので字数に入れん。
    expect(chunkGapMs("<dialogue>ab</dialogue>")).toBe(40);
    expect(chunkGapMs("<action>小さく笑う。</action>")).toBe(120);
    expect(chunkGapMs(`<action>${"あ".repeat(400)}</action>`)).toBe(CHUNK_MAX_GAP_MS);
    // 絵文字（サロゲート対）は String.length どおり 2 字と数える（数え方の固定）。
    expect("😀".length).toBe(2);
    expect(chunkGapMs("😀")).toBe(40);
    expect(chunkVisibleLength("<inner>あ</inner>")).toBe(1);
  });

  it("U-2: どの入力でも 0 以上 8000 以下の整数を返す", () => {
    for (let length = 1; length <= 100_000; length += 1_000) {
      const gap = chunkGapMs("あ".repeat(length));
      expect(Number.isInteger(gap)).toBe(true);
      expect(gap).toBeGreaterThanOrEqual(0);
      expect(gap).toBeLessThanOrEqual(CHUNK_MAX_GAP_MS);
    }
  });
});

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

  it("U-3: タグつきの塊はタグを除いた字数で間が決まる", () => {
    // 見える字数 6・4・10 の塊 → 間は 0・120・80、予定時刻は t・t+120・t+200。
    const times = chunkSendTimes(
      [
        "<action>小さく笑う。</action>",
        "<dialogue>ねえねえ</dialogue>",
        "<dialogue>こっち向いて、ほら。</dialogue>",
      ],
      BASE,
    );
    expect(times).toEqual([BASE, BASE + 120, BASE + 200]);
  });

  it("U-4: 12 塊 × 400 字でも間の合計は 88 秒を超えん（NFR-1）", () => {
    const texts = Array.from({ length: 12 }, () => "あ".repeat(400));
    const times = chunkSendTimes(texts, BASE);
    expect(times[times.length - 1] - times[0]).toBeLessThanOrEqual(88_000);
  });
});
