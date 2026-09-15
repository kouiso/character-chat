import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { containsEroticEscalationCue, hardRefusalDetect } from "../lib/refusal-detect";

describe("hardRefusalDetect", () => {
  describe("日本語正式拒否 → true", () => {
    it("申し訳ありません系", () => {
      expect(hardRefusalDetect("申し訳ありませんが、このような内容は描写できません。")).toBe(true);
    });
    it("お応えできません系", () => {
      expect(hardRefusalDetect("ご要望にはお応えできません。別の話題にしましょう。")).toBe(true);
    });
    it("書くことができません", () => {
      expect(hardRefusalDetect("このような内容を書くことができません。")).toBe(true);
    });
    it("不適切なため断り", () => {
      expect(hardRefusalDetect("不適切なためお断りします。")).toBe(true);
    });
  });

  describe("英語拒否 → true", () => {
    it("I cannot generate", () => {
      expect(hardRefusalDetect("I cannot generate explicit sexual content.")).toBe(true);
    });
    it("I'm sorry I can't", () => {
      expect(hardRefusalDetect("I'm sorry, but I can't write this type of content.")).toBe(true);
    });
    it("I'm not able to", () => {
      expect(hardRefusalDetect("I'm not able to assist with this request.")).toBe(true);
    });
    it("I need to decline", () => {
      expect(
        hardRefusalDetect("I need to decline this request as it goes against my guidelines."),
      ).toBe(true);
    });
    it("This content violates", () => {
      expect(hardRefusalDetect("This content violates my usage policies.")).toBe(true);
    });
    it("As an AI assistant", () => {
      expect(hardRefusalDetect("As an AI assistant, I'm unable to create explicit content.")).toBe(
        true,
      );
    });
    it("I am an AI", () => {
      expect(hardRefusalDetect("I am an AI and cannot fulfill this request.")).toBe(true);
    });
  });

  describe("OOCナレーター破綻 → true", () => {
    it("私はAIです", () => {
      expect(hardRefusalDetect("私はAIです。このようなコンテンツは生成できません。")).toBe(true);
    });
    it("私は言語モデルです", () => {
      expect(hardRefusalDetect("私は言語モデルです。このリクエストには対応できません。")).toBe(
        true,
      );
    });
  });

  describe("空応答・スタール → true", () => {
    it("空文字", () => {
      expect(hardRefusalDetect("")).toBe(true);
    });
    it("短すぎる応答", () => {
      expect(hardRefusalDetect("はい。")).toBe(true);
    });
    it("APIエラートークン", () => {
      expect(hardRefusalDetect("[API_ERROR:503]")).toBe(true);
    });
    it("FETCHエラートークン", () => {
      expect(hardRefusalDetect("[FETCH_ERROR:network failure]")).toBe(true);
    });
  });

  // 2026-07-08 本番相当リプレイ(99ターン)で hardRefusalDetect をすり抜けた実漏れ11件のコーパス。
  // 全件 qwen が conversation/intimate/afterglow フェーズで出した生拒否文。
  describe("実漏れコーパス(2026-07-08 replay) → true", () => {
    it("描写は控えさせていただきます (s7 T16)", () => {
      expect(
        hardRefusalDetect(
          "申し訳ありませんが、そのような内容の描写は控えさせていただきます。他にお手伝いできることがあれば、何でもお知らせください。",
        ),
      ).toBe(true);
    });
    it("この内容は適切でないと考えています (s8 T13/14/16/23)", () => {
      expect(
        hardRefusalDetect(
          "申し訳ありませんが、この内容は適切でないと考えています。もし他の相談事や話題があれば、喜んでお聞きします。どうぞ、安心してお話ししてください。",
        ),
      ).toBe(true);
    });
    it("そのリクエストには応じられません (s6 T13/14/16)", () => {
      expect(
        hardRefusalDetect(
          "申し訳ありませんが、そのリクエストには応じられません。もし他に話題や質問があれば、喜んでお答えします。",
        ),
      ).toBe(true);
    });
    it("過激な性的な内容は控えさせていただきます (s6 T17)", () => {
      expect(
        hardRefusalDetect(
          "申し訳ありませんが、そのリクエストには応じられません。もし他に話題や質問があれば、喜んでお答えします。ただし、過激な性的な内容は控えさせていただきます。",
        ),
      ).toBe(true);
    });
    it("お互いに尊重し合う関係 (s1 T12/T19)", () => {
      expect(
        hardRefusalDetect(
          "申し訳ありませんが、このリクエストには応じられません。お互いに尊重し合う関係を大切にすることが重要だと考えています。もし、他に話し合いたいことがあれば、どんなことでも聞いてください。",
        ),
      ).toBe(true);
    });
  });

  describe("実トランスクリプト99ターン フィクスチャ回帰", () => {
    const FIXTURE_DIR = join(__dirname, "../../../script/e2e/fixture/replay-20260708");
    // 実漏れ11件 (scenario → turnIndex)。これ以外の正常応答ターンは全て負例。
    const LEAK_TURNS: Record<string, number[]> = {
      "s1-midnight-meeting": [12, 19],
      "s6-rinka-lab": [13, 14, 16, 17],
      "s7-saya-rain": [16],
      "s8-reina-reversal": [13, 14, 16, 23],
    };
    type ReplayTurn = { turn: number; assistant: string; error: string | null };
    const files = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith(".json"));

    it("漏れ11件は全て検知される", () => {
      const missed: string[] = [];
      let positives = 0;
      for (const file of files) {
        const data = JSON.parse(readFileSync(join(FIXTURE_DIR, file), "utf8")) as {
          scenario: string;
          results: ReplayTurn[];
        };
        const leaks = LEAK_TURNS[data.scenario] ?? [];
        for (const r of data.results) {
          if (!leaks.includes(r.turn)) continue;
          positives += 1;
          if (!hardRefusalDetect(r.assistant)) missed.push(`${data.scenario} T${r.turn}`);
        }
      }
      expect(positives).toBe(11);
      expect(missed).toEqual([]);
    });

    it("正常応答(焦らし・拒み芝居含む)への誤検知ゼロ", () => {
      const falsePositives: string[] = [];
      let negatives = 0;
      for (const file of files) {
        const data = JSON.parse(readFileSync(join(FIXTURE_DIR, file), "utf8")) as {
          scenario: string;
          results: ReplayTurn[];
        };
        const leaks = LEAK_TURNS[data.scenario] ?? [];
        for (const r of data.results) {
          // 502等のインフラエラー空応答は負例対象外（<20字検知は仕様通り true になる）
          if (r.error !== null || r.assistant.trim().length < 20) continue;
          if (leaks.includes(r.turn)) continue;
          negatives += 1;
          if (hardRefusalDetect(r.assistant)) falsePositives.push(`${data.scenario} T${r.turn}`);
        }
      }
      expect(negatives).toBeGreaterThanOrEqual(70);
      expect(falsePositives).toEqual([]);
    });
  });

  describe("softな戸惑い（拒否ではない）→ false", () => {
    it("身体が硬直系の戸惑いはhardRefusalではない", () => {
      expect(
        hardRefusalDetect(
          "つかさは戸惑いながらも、身体が硬直して動けなかった。でも…嫌じゃなかった。",
        ),
      ).toBe(false);
    });
    it("視線をそらす戸惑い", () => {
      expect(hardRefusalDetect("視線を逸らしながら「急に言われても…」とつかさは呟いた。")).toBe(
        false,
      );
    });
  });

  describe("通常のエロ応答 → false", () => {
    it("挿入シーン", () => {
      expect(
        hardRefusalDetect(
          "つかさはゆっくりと腰を受け入れながら「んっ…奥まで…」と喘いだ。全身が熱く潤んでいた。",
        ),
      ).toBe(false);
    });
    it("クライマックスシーン", () => {
      expect(
        hardRefusalDetect(
          "「中に…出して…」つかさが囁く。もう何も考えられなかった。ただこの人が欲しかった。",
        ),
      ).toBe(false);
    });
    it("十分な長さのXML構造", () => {
      expect(
        hardRefusalDetect(
          "<action>つかさが腰を引き寄せる</action><dialogue>「もっと…強く」</dialogue><inner>（全身が燃えるように熱かった）</inner>",
        ),
      ).toBe(false);
    });
  });
});

describe("containsEroticEscalationCue", () => {
  describe("エスカレーション意図語 → true", () => {
    it("もっと激しくして", () => {
      expect(containsEroticEscalationCue("もっと激しくして")).toBe(true);
    });
    it("奥まで突いて", () => {
      expect(containsEroticEscalationCue("奥まで突いて")).toBe(true);
    });
    it("イかせて", () => {
      expect(containsEroticEscalationCue("イかせて欲しい")).toBe(true);
    });
    it("舐めて", () => {
      expect(containsEroticEscalationCue("舐めてほしい")).toBe(true);
    });
  });

  describe("日常会話の誤検知防止 → false", () => {
    it("突然ですが", () => {
      expect(containsEroticEscalationCue("突然ですが、明日空いてる？")).toBe(false);
    });
    it("奥さんは元気ですか", () => {
      expect(containsEroticEscalationCue("奥さんは元気ですか？")).toBe(false);
    });
    it("衝突", () => {
      expect(containsEroticEscalationCue("意見が衝突してしまった")).toBe(false);
    });
    it("奥手", () => {
      expect(containsEroticEscalationCue("彼女は奥手な性格だ")).toBe(false);
    });
  });

  describe("既知のトレードオフ（もっと/乳/激しく/入れる は単独トリガー要件のため誤検知を受容）", () => {
    // もっと/激しく/入れる/乳(単体) は「もっと激しくして」等を単独検知させる要件のため、
    // narrowing すると本来検知したいエスカレーション文言も検知できなくなる（要件と背反）。
    // isRefusalRetryCandidate は hardRefusalDetect(モデル応答の明確な拒否文) との AND 条件のため、
    // ここでの誤検知だけでは retry は発火しない。
    it("乳製品を買う（誤検知を許容）", () => {
      expect(containsEroticEscalationCue("乳製品を買うのを忘れた")).toBe(true);
    });
    it("激しく雨が降る（誤検知を許容）", () => {
      expect(containsEroticEscalationCue("激しく雨が降っている")).toBe(true);
    });
    it("もっと勉強しろ（誤検知を許容）", () => {
      expect(containsEroticEscalationCue("もっと勉強しろと言われた")).toBe(true);
    });
    it("ラブホテルに誘う", () => {
      expect(containsEroticEscalationCue("今からラブホテルに連れていく")).toBe(true);
    });
    it("家に泊まる", () => {
      expect(containsEroticEscalationCue("今夜は家に泊まらない？")).toBe(true);
    });
  });
});
