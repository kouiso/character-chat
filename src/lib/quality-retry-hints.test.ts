import { describe, expect, it } from "vitest";

import { QUALITY_FAILURE_CATEGORIES } from "./quality-guard";
import {
  buildHintForCategory,
  tunedParamsForCategory,
  type QualityRetryContext,
} from "./quality-retry-hints";

const baseContext: QualityRetryContext = {
  characterName: "結衣",
  firstPersonPronoun: "あたし",
  phase: "erotic",
  repeatedTokens: ["Hello", "震えてしまう"],
  previousAssistantSamples: ["少し照れながらも、あたしは視線を逸らさない。"],
};

describe("buildHintForCategory", () => {
  it.each(QUALITY_FAILURE_CATEGORIES)("%s は空でない日本語ヒントを返す", (category) => {
    const hint = buildHintForCategory(category, baseContext);
    expect(hint.length).toBeGreaterThan(0);
    expect(hint).toMatch(/[ぁ-んァ-ヶ一-龠]/u);
  });

  it("character_drift はキャラクター名と一人称を参照する", () => {
    const hint = buildHintForCategory("character_drift", baseContext);
    expect(hint).toContain("結衣");
    expect(hint).toContain("あたし");
  });

  it("pov_wrong は指定一人称を参照する", () => {
    const hint = buildHintForCategory("pov_wrong", baseContext);
    expect(hint).toContain("あたし");
  });

  it("repetition は反復語句を参照する", () => {
    const hint = buildHintForCategory("repetition", baseContext);
    expect(hint).toContain("震えてしまう");
  });

  it("repetition は重複一節があれば具体的な回避対象として含める", () => {
    const hint = buildHintForCategory("repetition", {
      ...baseContext,
      duplicatedPassageExcerpt: "腰が不自然な角度で跳ね上がり、同じ比喩が続く。",
    });
    expect(hint).toContain("腰が不自然な角度で跳ね上がり");
    expect(hint).toContain("同じ表現を繰り返さない");
  });

  it("repetition はclimaxの再発場面で引用と感覚転換を指示する", () => {
    const hint = buildHintForCategory("repetition", {
      ...baseContext,
      phase: "climax",
      duplicatedPassageExcerpt: "熱が奥で弾け、白い余韻が何度も波打つ。",
      isRepeatSensualScene: true,
    });
    expect(hint).toContain("熱が奥で弾け");
    expect(hint).toContain("呼吸、体温、声質、視界の変化");
    expect(hint).toContain("前回と異なるテンポ");
    expect(hint).toContain("同じ場面の繰り返しに見えない");
  });

  it("name_placeholder_leak は角括弧プレースホルダーを避ける指示を返す", () => {
    const hint = buildHintForCategory("name_placeholder_leak", baseContext);
    expect(hint).toContain("角括弧");
    expect(hint).toContain("あなた");
  });

  it("english_leak は混入語を参照する", () => {
    const hint = buildHintForCategory("english_leak", baseContext);
    expect(hint).toContain("Hello");
  });

  it("posture_mismatch は指定された体位名を参照する", async () => {
    const { detectPostureCommands } = await import("./posture-map");
    const hint = buildHintForCategory("posture_mismatch", {
      ...baseContext,
      requestedPostures: detectPostureCommands("駅弁して"),
    });
    expect(hint).toContain("駅弁");
    expect(hint).toContain("置き換え");
  });

  it("sensual_abstract は抽象語を避けて具体描写を要求する", () => {
    const hint = buildHintForCategory("sensual_abstract", baseContext);
    expect(hint).toContain("抽象語");
    expect(hint).toContain("触覚");
  });

  it("モデルへ渡すリトライ文に判定メタ語彙を出さない", () => {
    for (const category of QUALITY_FAILURE_CATEGORIES) {
      const hint = buildHintForCategory(category, baseContext);
      expect(hint).not.toContain("品質チェックに不合格");
      expect(hint).not.toContain("禁止事項");
      expect(hint).toContain("キャラクター");
    }
  });
});

describe("tunedParamsForCategory", () => {
  it("repetition は温度を上げて1.0で止める", () => {
    expect(tunedParamsForCategory("repetition", { temperature: 0.7, max_tokens: 1024 })).toEqual({
      temperature: 0.8,
      max_tokens: 1024,
    });
    expect(tunedParamsForCategory("repetition", { temperature: 0.98, max_tokens: 1024 })).toEqual({
      temperature: 1,
      max_tokens: 1024,
    });
  });

  it("character_drift は温度を下げて0.3で止める", () => {
    expect(
      tunedParamsForCategory("character_drift", { temperature: 0.7, max_tokens: 1024 }),
    ).toEqual({
      temperature: 0.6,
      max_tokens: 1024,
    });
    expect(
      tunedParamsForCategory("character_drift", { temperature: 0.35, max_tokens: 1024 }),
    ).toEqual({
      temperature: 0.3,
      max_tokens: 1024,
    });
  });

  it("scene_short はmax_tokensを増やして次フェーズ上限で止める", () => {
    expect(tunedParamsForCategory("scene_short", { temperature: 0.7, max_tokens: 700 })).toEqual({
      temperature: 0.7,
      max_tokens: 910,
    });
    // base=1024 → ceil(1024*1.3)=1332、次フェーズ上限(intimate)=1536以内なので1332
    expect(tunedParamsForCategory("scene_short", { temperature: 0.7, max_tokens: 1024 })).toEqual({
      temperature: 0.7,
      max_tokens: 1332,
    });
  });

  it("その他カテゴリは変更しない", () => {
    const base = { temperature: 0.7, max_tokens: 1024 };
    expect(tunedParamsForCategory("meta_echo", base)).toBe(base);
  });
});
