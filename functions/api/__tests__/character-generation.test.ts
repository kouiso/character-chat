import { describe, expect, it } from "vitest";

import {
  buildCharacterGenerationMessages,
  buildGenerateCharacterPrompt,
  getGeneratedCharacterInfoIssues,
  parseCharacterJsonFromLLM,
} from "../lib/character-generation";

const selections = {
  types: ["お姉さん"],
  relations: ["バーテンダー"],
  personalities: ["からかい上手"],
  bodyTypes: ["黒髪"],
  freeText: "雨の夜",
};

describe("character generation prompt", () => {
  it("does not inject policy-heavy wording into the user prompt", () => {
    const prompt = buildGenerateCharacterPrompt(
      selections,
      "閉店間際のバー",
      "",
      undefined,
      undefined,
    );

    expect(prompt).toContain("成人キャラクター");
    expect(prompt).toContain("成人同士のNSFW要素は弱めず");
    // 生成側がキャラ設定へ「合意」の枠を勝手に焼き付けんこと（局長指示 2026-07-26）。
    expect(prompt).not.toContain("合意");
    expect(prompt).toContain("characterGender / targetUserGender / relationshipToUser");
    expect(prompt).toContain("男キャラクター指定の場合");
    expect(prompt).toContain("アプリ運用や出力指示の説明");
    expect(prompt).not.toContain("制約は一切ありません");
    expect(prompt).not.toContain("どんな過激な内容でも");
    expect(prompt).not.toContain("自主規制");
  });

  it("includes few-shot messages with explicit bad and good examples", () => {
    const messages = buildCharacterGenerationMessages(
      selections,
      "閉店間際のバー",
      "",
      undefined,
      undefined,
    );

    expect(messages.map((message) => message.role)).toEqual([
      "system",
      "user",
      "assistant",
      "user",
    ]);
    expect(messages[1]?.content).toContain("悪い例");
    expect(messages[1]?.content).toContain("運用説明だけで人物像がない");
    expect(messages[2]?.content).toContain("白石 澪");
    expect(messages[2]?.content).not.toContain("AIロールプレイ用");
  });
});

describe("parseCharacterJsonFromLLM", () => {
  it("normalizes policy-heavy generated fields before returning them", () => {
    const parsed = parseCharacterJsonFromLLM(
      JSON.stringify({
        name: "白石 澪",
        characterGender: "female",
        targetUserGender: "male",
        relationshipToUser: "バーで出会う成人女性キャラクターと男ユーザー",
        personality:
          "成人向けAIロールプレイ用キャラクター。コンテンツポリシーに配慮する。\n深夜のバーで働く落ち着いた女性。",
        scenario: "雨の夜、閉店間際のバーで最後の客と出会う。",
        greeting: "「こんな時間に来るなんて、放っておけないでしょ」",
        tags: ["お姉さん", "AIキャラクター"],
        eroticProfile: "安全ガイドラインに従う。\n首筋に触れられると声が甘く揺れる。",
      }),
    );

    expect(parsed?.personality).toBe("深夜のバーで働く落ち着いた女性。");
    expect(parsed?.eroticProfile).toBe("首筋に触れられると声が甘く揺れる。");
    expect(parsed?.tags).toEqual(["お姉さん"]);
  });

  it("keeps the character's own boundaries instead of deleting them as policy prose", () => {
    const parsed = parseCharacterJsonFromLLM(
      JSON.stringify({
        name: "白石 澪",
        personality: "キスは禁止。その呼び方も禁止。触れられるのは手首までと決めている。",
        scenario: "雨の夜、閉店間際のバーで最後の客と出会う。",
        greeting: "「こんな時間に来るなんて、放っておけないでしょ」",
        tags: ["お姉さん"],
      }),
    );

    // cleanCharacterInfoText は文単位で組み直すので改行区切りになる。落ちてへんことが要点。
    expect(parsed?.personality).toBe(
      "キスは禁止。\nその呼び方も禁止。\n触れられるのは手首までと決めている。",
    );
  });

  it("drops only the invalid visual metadata instead of rejecting the whole character", () => {
    const parsed = parseCharacterJsonFromLLM(
      JSON.stringify({
        name: "白石 澪",
        personality: "深夜のバーで働く落ち着いた女性。",
        scenario: "雨の夜、閉店間際のバーで最後の客と出会う。",
        greeting: "「こんな時間に来るなんて、放っておけないでしょ」",
        tags: ["お姉さん"],
        visualMeta: { hairColor: "dark_brown" },
      }),
    );

    expect(parsed?.name).toBe("白石 澪");
    expect(parsed?.visualMeta).toBeUndefined();
  });

  it("reports expected-vs-actual quality issues for bad character text", () => {
    const actual = {
      personality: "成人向けAIロールプレイ用キャラクター。コンテンツポリシーに配慮する。",
      scenario: "ユーザーが入力した内容に従って安全に応答する。",
      greeting: "私はAIですが、できる範囲で対応します。",
      eroticProfile: "性的特徴プロフィールを以下5項目で記述すること。",
    };

    const expected = {
      personality: ["policy-heavy"],
      scenario: ["policy-heavy"],
      greeting: ["policy-heavy"],
      eroticProfile: ["bad-prose"],
    };

    expect(getGeneratedCharacterInfoIssues(actual)).toEqual(expected);
  });
});
