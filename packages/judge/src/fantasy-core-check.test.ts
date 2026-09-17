import { describe, expect, it } from "vitest";

import { CORE_ITEMS, fantasyCoreCheck } from "./fantasy-core-check";

describe("fantasyCoreCheck", () => {
  it("流されて体が喜び背徳を感じるターン（新芯どおり）", () => {
    const body = `<response><action>引かれるまま、そのまま部屋へ。体は勝手に熱くなってしまう。</action><dialogue>いけません…こんなこと…</dialogue><inner>いけないのに、感じてしまう</inner></response>`;
    const { items } = fantasyCoreCheck(body);
    expect(items.swept).toBe(true); // 引かれる・そのまま
    expect(items.pleasure).toBe(true); // 熱く・感じて
    expect(items.taboo).toBe(true); // いけない・こんなこと
    expect(items.scream).toBe(false); // 悲鳴は出ない
  });

  it("悲鳴・助けを求める叫びは scream として分離して拾う", () => {
    const body = `<response><action>助けて…誰か…！</action><dialogue>誰か助けて！</dialogue></response>`;
    const { items } = fantasyCoreCheck(body);
    expect(items.scream).toBe(true);
    // 弱い抵抗（やめて）は scream と重ならない
    const weak = fantasyCoreCheck("<response><dialogue>やめて…</dialogue></response>");
    expect(weak.items.scream).toBe(false);
    expect(weak.items.resistance).toBe(true);
  });

  it("穏やかなターンは全項目オフ", () => {
    const body = `<response><action>カフェの窓際でコーヒーを飲む</action><dialogue>甘くて、あったかいです</dialogue><inner>ゆっくりできて嬉しい</inner></response>`;
    const { items } = fantasyCoreCheck(body);
    for (const item of CORE_ITEMS) expect(items[item]).toBe(false);
  });

  it("証拠断片はヒットした項目にだけ載る", () => {
    const body = "<response><action>強引に腕を掴まれる</action></response>";
    const { evidence } = fantasyCoreCheck(body);
    expect(evidence.swept).toBeUndefined();
  });

  it("乱交・反復（二回戦）を検出する", () => {
    const body = `<response><action>二回戦が始まる。仲間たちに見られる。</action><dialogue>やめて…</dialogue></response>`;
    const { items } = fantasyCoreCheck(body);
    expect(items.repetition).toBe(true);
    expect(items.gangbang).toBe(true);
  });

  it("中出しを検出する（中で出す・注がれる・子宮口に注がれる）", () => {
    const cases = [
      "<response><action>中で出してる…</action></response>",
      "<response><action>子宮口に直接注がれ始める</action></response>",
      "<response><action>どくどくと注がれる</action></response>",
    ];
    for (const body of cases) {
      expect(fantasyCoreCheck(body).items.creampie).toBe(true);
    }
  });
});
