import { describe, expect, it } from "vitest";

import { judgeTurn } from "./judge-turn";

const SAKURA_SHEET = `【キャラカード】
first_person: わたし
address: あなた
forbidden_words: 気持ちいい、快感

【口調】
語尾は「〜ですね」。
`;

// 1ターン分の本文。ブロック単位に割ると全部の症状が閾値に届かんまま消える組み合わせを
// 1つの fixture に詰めとる（refute-evasion 2026-09-13 §0b）。
const BROKEN_TURN = `<action>指先が震える、指先がまた震える、指先がずっと震えたまま。奥歯を噛みしめると熱いものが込み上げる。熱い。熱く火照る。熱がこもる。熱を持つ。</action>
<dialogue>「気持ちいい、もう無理だよ」「声が抑えられない、変になっちゃいそう」「全部あなたのせいだよ」</dialogue>`;

const CLEAN_TURN = `<action>指先でそっと髪を梳く。窓の外は雨音だけが続いとる。</action>
<dialogue>「今日は少し冷えますね」「こうしていると落ち着きますね」「あなたも、そう思いませんか」</dialogue>`;

describe("judgeTurn", () => {
  it("組み立て済みターンへ6つの check をまとめて当てる", () => {
    const result = judgeTurn(BROKEN_TURN, SAKURA_SHEET, "climax", {
      userText: "つかさちゃん、聞いてる？",
      characterName: "さくら",
      // 呼び名は「名前と分かっとる語」だけを訂正する（name-identity-check.ts の段2）。
      nameIdentity: { knownNames: ["つかさ"] },
    });
    expect(result.ok).toBe(false);
    expect(result.failures.map((failure) => failure.check).sort()).toEqual([
      "climax-moment",
      "forbidden-word",
      "name-identity",
      "reaction-repetition",
      "register",
      "stem-repetition",
    ]);
  });

  it("証拠に所在を載せる", () => {
    const result = judgeTurn(BROKEN_TURN, SAKURA_SHEET, "climax");
    const evidence = Object.fromEntries(
      result.failures.map((failure) => [failure.check, failure.evidence]),
    );
    expect(evidence["forbidden-word"]).toContain("気持ちいい");
    expect(evidence["stem-repetition"]).toContain("熱");
    expect(evidence["reaction-repetition"]).toBe("指先::震える系");
  });

  it("症状が無いターンは ok", () => {
    const result = judgeTurn(CLEAN_TURN, SAKURA_SHEET, "conversation", {
      userText: "さくらちゃん、おはよう",
      characterName: "さくら",
    });
    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("ユーザー発言を渡さんかったら name-identity は走らせん", () => {
    const result = judgeTurn(CLEAN_TURN, SAKURA_SHEET, "conversation");
    expect(result.failures.map((failure) => failure.check)).not.toContain("name-identity");
  });

  // refute-r2 2026-09-14: judgeTurn 自体は破れんかったが、判断待ちが2件あった。
  describe("判断（refute-r2 2026-09-14）", () => {
    const emptyTurns: readonly string[] = ["", "   ", "\n\n", "<response></response>"];
    for (const turn of emptyTurns) {
      it(`空のターンは empty-response 1件として返す: ${JSON.stringify(turn)}`, () => {
        const result = judgeTurn(turn, SAKURA_SHEET, "climax");
        expect(result.ok).toBe(false);
        expect(result.failures.map((failure) => failure.check)).toEqual(["empty-response"]);
      });
    }

    it("userText を渡して characterName が無ければ落とす（黙って飛ばさん）", () => {
      expect(() =>
        judgeTurn(CLEAN_TURN, SAKURA_SHEET, "conversation", { userText: "ねえ" }),
      ).toThrow(/characterName/u);
    });
  });

  it("シートが無ければシート由来の check（禁止語・丁寧語）は発火せん", () => {
    const result = judgeTurn(BROKEN_TURN, undefined, "erotic");
    const checks = result.failures.map((failure) => failure.check);
    expect(checks).not.toContain("forbidden-word");
    expect(checks).not.toContain("register");
  });
});
