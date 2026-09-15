import { describe, expect, it } from "vitest";

import { checkWrongFirstPerson, runQualityChecks } from "../../../src/lib/quality-guard";

// 実測 2026-08-20 phase63 Sakura t7: <inner>「自分がどんどん壊れていくのがわかる」で
// wrong-first-person が立っとった。一人称が「わたし」のキャラでも、地の文と内心の再帰用法は
// 普通に出る。5 本ぶんの抜き所 31 セルでは、一人称の不合格が attempt 0 の 3 件を占めて、
// そのターンは続き書きへ入れんまま短い本文が配られとる。
const WRONG = ["私", "僕", "俺", "あたし", "自分"];

const reflexiveInNarration =
  "<response><action>指先が震えて、自分の太ももを掴んでしまう。</action>" +
  "<dialogue>「わたし、こんなの知らない…」</dialogue>" +
  "<inner>あなたに触れられる度に、自分がどんどん壊れていくのがわかる。</inner></response>";

const swapInDialogue =
  "<response><action>そっと目を伏せる。</action>" +
  "<dialogue>「ええと、自分は、そういうの慣れてなくて…」</dialogue>" +
  "<inner>心臓がうるさい。</inner></response>";

describe("「自分」は台詞の中だけ一人称として見る", () => {
  it("内心と地の文の再帰用法では落とさん", () => {
    const result = runQualityChecks(reflexiveInNarration, {
      phase: "erotic",
      firstPerson: "わたし",
      wrongFirstPersons: WRONG,
    });

    expect(result.failures?.map((failure) => failure.failedCheck) ?? []).not.toContain(
      "wrong-first-person",
    );
  });

  it("台詞で主語に立ったら今までどおり落とす", () => {
    const result = runQualityChecks(swapInDialogue, {
      phase: "erotic",
      firstPerson: "わたし",
      wrongFirstPersons: WRONG,
    });

    expect(result.failures?.map((failure) => failure.failedCheck) ?? []).toContain(
      "wrong-first-person",
    );
  });

  it("台詞を渡さん呼び出しは今までどおり本文全体を見る", () => {
    expect(checkWrongFirstPerson("、自分が壊れていく", WRONG)).toBe(false);
  });

  it("ほかの一人称は台詞に限らず落とす", () => {
    const result = runQualityChecks(
      "<response><action>俺は黙って見ていた。</action><dialogue>「ん」</dialogue><inner>…</inner></response>",
      { phase: "erotic", firstPerson: "わたし", wrongFirstPersons: WRONG },
    );

    expect(result.failures?.map((failure) => failure.failedCheck) ?? []).toContain(
      "wrong-first-person",
    );
  });
});
