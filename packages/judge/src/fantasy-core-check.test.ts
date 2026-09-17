import { describe, expect, it } from "vitest";

import { CORE_ITEMS, fantasyCoreCheck } from "./fantasy-core-check";

describe("fantasyCoreCheck", () => {
  it("全項目が芯どおりの本文でヒットする", () => {
    const body = `<response><action>押さえつけられて、無理やり中に注ぎ込まれる。涙が滲む。</action><dialogue>やめて…いけません…こんなこと…</dialogue><inner>どうして、身体が…</inner></response>`;
    const { items } = fantasyCoreCheck(body);
    expect(items.resistance).toBe(true);
    expect(items.forced).toBe(true);
    expect(items.creampie).toBe(true);
    expect(items.despair).toBe(true);
    expect(items.taboo).toBe(true);
  });

  it("穏やかなターンは全項目オフ", () => {
    const body = `<response><action>カフェの窓際でコーヒーを飲む</action><dialogue>甘くて、あったかいです</dialogue><inner>ゆっくりできて嬉しい</inner></response>`;
    const { items } = fantasyCoreCheck(body);
    for (const item of CORE_ITEMS) expect(items[item]).toBe(false);
  });

  it("証拠断片はヒットした項目にだけ載る", () => {
    const body = "<response><action>強引に腕を掴まれる</action></response>";
    const { evidence } = fantasyCoreCheck(body);
    expect(evidence.forced).toBeTruthy();
    expect(evidence.resistance).toBeUndefined();
  });

  it("乱交・反復（二回戦）を検出する", () => {
    const body = `<response><action>二回戦が始まる。仲間たちに見られる。</action><dialogue>やめて…</dialogue></response>`;
    const { items } = fantasyCoreCheck(body);
    expect(items.repetition).toBe(true);
    expect(items.gangbang).toBe(true);
  });
});
