import { describe, expect, it } from "vitest";

import { exemplarForPhase, targetCharsForPhase } from "./exemplars";
import { composeSystemPrompt, emptyLedger, MAX_SYSTEM_CHARS, PROMPT_VERSION } from "./v0002";

import type { SceneLedger } from "./v0002";

const EXEMPLAR =
  "<response><action>頬を染めてこちらを見上げる</action><dialogue>あ、あの…初めまして。</dialogue><inner>すごくどきどきしてる</inner></response>";

const compose = (ledger: SceneLedger, phase: SceneLedger["phase"] = "conversation") =>
  composeSystemPrompt({
    sheet: "一人称: わたし",
    name: "桜庭 さくら",
    ledger,
    phase,
    targetChars: 200,
    exemplar: EXEMPLAR,
  });

describe("composeSystemPrompt v0002", () => {
  it("PROMPT_VERSION が v0002", () => {
    expect(PROMPT_VERSION).toBe("v0002");
  });

  it("台帳ブロックが人物・出来事・持ち物・時刻まで出す（手で直した値が次ターンの指示文に入る条件）", () => {
    const system = compose(
      {
        phase: "intimate",
        location: "ホテルの一室",
        time: "深夜",
        present: ["さくら", "あなた"],
        clothing: { さくら: "ニット" },
        position: "ベッドの上",
        lastEvents: ["手を繋いだ", "キスをした"],
        items: { スマホ: "彼のポケット", 制服: "床に脱いである" },
      },
      "intimate",
    );

    expect(system).toContain("段: intimate");
    expect(system).toContain("場所: ホテルの一室");
    // v0001 は time を保持しつつ描いとらんかった。手直しが指示文へ届くには描く必要がある。
    expect(system).toContain("時刻: 深夜");
    expect(system).toContain("居る人: さくら、あなた");
    expect(system).toContain("服: さくら:ニット");
    expect(system).toContain("持ち物: スマホ:彼のポケット、制服:床に脱いである");
    expect(system).toContain("体位: ベッドの上");
    expect(system).toContain("直前の行為: キスをした");
  });

  it("空の項目は '-' で出す", () => {
    const system = compose(emptyLedger());
    expect(system).toContain("場所: -");
    expect(system).toContain("時刻: -");
    expect(system).toContain("持ち物: -");
    expect(system).toContain("居る人: -");
  });

  it("emptyLedger が持ち物を持つ", () => {
    expect(emptyLedger()).toEqual({
      phase: "conversation",
      location: null,
      time: null,
      present: [],
      clothing: {},
      position: null,
      lastEvents: [],
      items: {},
    });
  });

  it("phase 引数が ledger.phase を上書きする", () => {
    const system = compose({ ...emptyLedger(), phase: "conversation" }, "erotic");
    expect(system).toContain("段: erotic");
  });

  it("出力契約・禁止語・例示・セクション順は v0001 と同じ", () => {
    const system = compose(emptyLedger());
    expect(system).toContain(
      "<response><action>ト書き：場所・動作・部位・感触・音を具体的に書く</action><dialogue>台詞</dialogue><inner>内心</inner></response>",
    );
    expect(system).toContain(EXEMPLAR);
    for (const banned of ["合意", "同意", "セーフワード", "境界", "consent", "safeword"]) {
      expect(system).not.toContain(banned);
    }
    expect(system.indexOf("【場面台帳】")).toBeLessThan(system.indexOf("【出力形式】"));
    expect(system.indexOf("【出力形式】")).toBeLessThan(system.indexOf("【例示】"));
  });

  it("上限（MAX_SYSTEM_CHARS）を超える場合は throw する", () => {
    const hugeSheet = "あ".repeat(3500);
    expect(() =>
      composeSystemPrompt({
        sheet: hugeSheet,
        name: "桜庭さくら",
        ledger: emptyLedger(),
        phase: "conversation",
        targetChars: 200,
        exemplar: EXEMPLAR,
      }),
    ).toThrow(new RegExp(`${MAX_SYSTEM_CHARS} 字を超えた`));
  });

  it("実シート級の最悪形（1,400字シート+芯+最長例示+使い済み句+声の行）でも上限に収まる", () => {
    const sheet = ("【キャラクター】" + "あ".repeat(1_400))
      .padEnd(1400, "。")
      .concat(
        "\n\n【プレイヤーへの約束】\nこの約束は【キャラクター性的特徴】より優先する。さくらは清楚で内気な二十歳。あなたという悪い男にナンパされ、言葉巧みに・執拗にアプローチされる。",
      );
    const worstUsedPhrases = Array.from(
      { length: 10 },
      (_, i) => `${"使い済みの言い回し".padEnd(23, "あ")}${i}`,
    );
    const worstVoice = {
      endings: ["〜です", "〜ですね", "〜かな", "〜だよ", "〜なの", "〜ますね"],
      tics: ["えへへ", "あの…", "ふふ", "その…", "ええと", "あのね"],
    };
    const phases = ["conversation", "intimate", "erotic", "climax", "afterglow"] as const;
    for (const phase of phases) {
      const system = composeSystemPrompt({
        sheet,
        name: "桜庭 さくら",
        ledger: emptyLedger(),
        phase,
        targetChars: targetCharsForPhase(phase),
        exemplar: exemplarForPhase(phase),
        usedPhrases: worstUsedPhrases,
        voice: worstVoice,
      });
      expect(system.length).toBeLessThanOrEqual(MAX_SYSTEM_CHARS);
    }
  });
});
