import { describe, expect, it } from "vitest";

import { dayLabel } from "./day-label";

// 見本の「きょう」は 11月7日 土曜（JST）。
const NOW = Date.parse("2026-11-07T21:00:00+09:00");
const at = (iso: string) => Date.parse(iso);

describe("dayLabel", () => {
  it("同じ日は「きょう」、前の日は「きのう」", () => {
    expect(dayLabel(at("2026-11-07T00:10:00+09:00"), NOW)).toBe("きょう");
    expect(dayLabel(at("2026-11-06T23:59:00+09:00"), NOW)).toBe("きのう");
  });

  it("1 週間以内は曜日、それより前は日付", () => {
    expect(dayLabel(at("2026-11-03T12:00:00+09:00"), NOW)).toBe("火曜");
    expect(dayLabel(at("2026-11-02T12:00:00+09:00"), NOW)).toBe("月曜");
    expect(dayLabel(at("2026-10-31T12:00:00+09:00"), NOW)).toBe("10月31日");
  });

  it("JST の 0 時で日が変わる（UTC の 9 時ではない）", () => {
    expect(dayLabel(at("2026-11-06T15:30:00Z"), NOW)).toBe("きょう");
  });
});
