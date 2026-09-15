import { describe, expect, it } from "vitest";

import { buildEncounterTensionContext } from "../[[route]]";

describe("buildEncounterTensionContext", () => {
  it("システムプロンプトが無くても共通層を返す", () => {
    const directive = buildEncounterTensionContext(undefined);
    expect(directive).toContain("【出会いの空気】");
  });

  it("【シナリオ】からナンパ系の緊張を組み立てる", () => {
    const systemContent =
      "【キャラクター】さくら\n【シナリオ】ナンパされて始まった関係。\n【追加設定】特になし";
    const directive = buildEncounterTensionContext(systemContent);
    expect(directive).toContain("出会った直後");
  });

  it("幼馴染など既存関係では共通層だけを返す", () => {
    const systemContent =
      "【キャラクター】さくら\n【シナリオ】幼馴染で昔からずっと一緒にいる。\n【追加設定】特になし";
    const directive = buildEncounterTensionContext(systemContent);
    expect(directive).not.toContain("出会った直後");
    expect(directive).toContain("状況");
  });

  it("キャラ設定に無い枠を足さない", () => {
    const directive = buildEncounterTensionContext(
      "【シナリオ】ナンパされて始まった関係。\n【関係性】まだ距離がある",
    );
    for (const framing of ["合意", "同意", "セーフワード", "境界", "配慮", "倫理"]) {
      expect(directive).not.toContain(framing);
    }
  });
});
