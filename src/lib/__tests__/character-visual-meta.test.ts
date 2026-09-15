import { describe, expect, it } from "vitest";

import {
  DEFAULT_VISUAL_DRAFT,
  deriveVisualMetaFromText,
  resolveVisualMetaForSave,
} from "@/lib/character-visual-meta";
import type { VisualMeta } from "@/schema/character-visual-enums";

const SILVER_ROW: VisualMeta = {
  hairColor: "silver",
  hairStyle: "straight",
  hairLength: "long",
  eyeColor: "blue",
  skinTone: "pale",
  bodyType: "slender",
  breastSize: null,
  heightBand: null,
  ageApparent: 20,
  distinctiveMarks: [],
  defaultOutfit: [],
  undressProgression: {},
};

describe("resolveVisualMetaForSave", () => {
  it("行が無く見た目も触っていない保存では行を作らない", () => {
    const result = resolveVisualMetaForSave({
      draft: DEFAULT_VISUAL_DRAFT,
      baseMeta: null,
      visualTouched: false,
    });

    expect(result).toBeNull();
  });

  it("行が無くてもユーザーが見た目を選んだなら保存する", () => {
    const result = resolveVisualMetaForSave({
      draft: { ...DEFAULT_VISUAL_DRAFT, hairColor: "silver" },
      baseMeta: null,
      visualTouched: true,
    });

    expect(result?.hairColor).toBe("silver");
  });

  it("既存行があれば触っていなくても保存し、行の値を保持する", () => {
    const result = resolveVisualMetaForSave({
      draft: {
        hairColor: "silver",
        hairLength: "long",
        bodyType: "slender",
        defaultOutfit: "",
      },
      baseMeta: SILVER_ROW,
      visualTouched: false,
    });

    expect(result).not.toBeNull();
    expect(result?.hairColor).toBe("silver");
    // フォームが持たない項目は既存行の値を落とさない
    expect(result?.eyeColor).toBe("blue");
    expect(result?.skinTone).toBe("pale");
    expect(result?.ageApparent).toBe(20);
  });

  it("既定値のまま触っていない保存が黒髪・茶目を焼き付けない", () => {
    const result = resolveVisualMetaForSave({
      draft: DEFAULT_VISUAL_DRAFT,
      baseMeta: undefined,
      visualTouched: false,
    });

    expect(result).toBeNull();
  });
});

describe("deriveVisualMetaFromText", () => {
  it("髪色の根拠が無ければ null を返す", () => {
    expect(deriveVisualMetaFromText("優しくて面倒見のいいお姉さん")).toBeNull();
  });

  it("日本語の記述から髪色を拾う", () => {
    const meta = deriveVisualMetaFromText("銀髪ロングヘアの華奢な女性");

    expect(meta?.hairColor).toBe("silver");
    expect(meta?.hairLength).toBe("long");
    expect(meta?.bodyType).toBe("slender");
  });

  it("英語の記述からも髪色を拾う", () => {
    expect(deriveVisualMetaFromText("a woman with blonde hair")?.hairColor).toBe("blonde");
  });

  it("髪色以外の根拠が無い項目は既定値のままにする", () => {
    const meta = deriveVisualMetaFromText("黒髪の同僚");

    expect(meta?.hairColor).toBe("black");
    expect(meta?.hairLength).toBe("medium");
  });
});
