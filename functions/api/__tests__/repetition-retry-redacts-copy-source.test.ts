import { describe, expect, it } from "vitest";

import { findCrossTurnRepetitionMatch } from "../../../src/lib/quality-guard";
import {
  buildQualityAttemptMessages,
  redactRepeatedPhrasesFromHistory,
  type ChatMessage,
} from "../lib/route-context";

import type { QualityRetryContext } from "../../../src/lib/quality-retry-hints";

// issue #1495: 反復で撮り直しても直らん理由。撮り直しの指示は「繰り返すな」を
// 足すだけで、写された元の文章は履歴に残ったままモデルへ渡っとった。
// 実測（phase62〜66・同一キャラの連続ターン 90 組）で 15 字以上の逐語コピーが 28 組、
// 撮り直し後の配信本文でも 20/90 が再掲のまま。足す側は Gate 0 で負けとるので、
// コピー元をその 1 回のリクエストから外す方へ寄せる。

const REPEATED = "こんなに濡れてるなんて";

const buildContext = (phrases: string[]): QualityRetryContext =>
  ({
    characterName: "霜月 鈴",
    firstPersonPronoun: "私",
    phase: "erotic",
    repeatedTokens: [],
    englishTokens: [],
    crossTurnRepeatedPhrases: phrases,
    isRepeatSensualScene: true,
    previousAssistantSamples: [],
  }) as unknown as QualityRetryContext;

describe("#1495 反復の撮り直しでコピー元を履歴から外す", () => {
  const history: ChatMessage[] = [
    { role: "system", content: `あなたは霜月 鈴。${REPEATED}という癖がある。` },
    {
      role: "assistant",
      content: `<response><dialogue>…でも、ほんと、バカじゃないの。${REPEATED}。</dialogue></response>`,
    },
    { role: "user", content: `${REPEATED}って言うなよ` },
  ];

  it("assistant の発言からは再掲された句が消える", () => {
    const messages = buildQualityAttemptMessages(
      history,
      1,
      `<response><dialogue>${REPEATED}。</dialogue></response>`,
      "cross-turn-repetition",
      "repetition",
      buildContext([REPEATED]),
    );

    const assistant = messages.filter((message) => message.role === "assistant");
    expect(assistant).toHaveLength(1);
    expect(assistant[0].content).not.toContain(REPEATED);
    // 文が消えるだけで、ターン自体は残る。丸ごと落とすと会話が飛ぶ。
    expect(assistant[0].content).toContain("バカじゃないの");
  });

  it("user と system の発言は書き換えん", () => {
    const messages = buildQualityAttemptMessages(
      history,
      1,
      `<response><dialogue>${REPEATED}。</dialogue></response>`,
      "cross-turn-repetition",
      "repetition",
      buildContext([REPEATED]),
    );

    expect(messages.find((message) => message.role === "user")?.content).toContain(REPEATED);
    expect(messages.find((message) => message.role === "system")?.content).toContain(REPEATED);
  });

  it("反復やない撮り直しでは履歴を触らん", () => {
    const messages = buildQualityAttemptMessages(
      history,
      1,
      "<response><dialogue>I feel good.</dialogue></response>",
      "english-mixed",
      "english_leak",
      buildContext([REPEATED]),
    );

    expect(messages.find((message) => message.role === "assistant")?.content).toContain(REPEATED);
  });
});

// 検出器が返す句が、履歴の本文へ「そのまま」入っとることに依存しとる。
// 句が正規化された形（句読点や空白を落とした形）で返ってきたら、伏せ字は本番で
// 一度も当たらんまま単体テストだけ緑になる。検出器の出力をそのまま食わせて確かめる。
describe("#1495 検出器の出した句がそのまま伏せられる", () => {
  it("findCrossTurnRepetitionMatch の repeatedPhrases で元の本文が消える", () => {
    const previous =
      "<response><dialogue>…でも、ほんと、バカじゃないの。こんなに濡れてるなんて。</dialogue>" +
      "<action>タオルを押しつけて、視線だけ逸らす。</action></response>";
    // 二句とも貼り直す。以前は「こんなに濡れてるなんて」の一句だけで発火しとったが、
    // それは <inner> が無いせいで同じ比較が二度走っただけで、閾値の「別々の句を二つ」を
    // 満たしとらんかった。ここで見たいのは伏せ字が逐語で当たることなので、土台は
    // 本物の二句にする。
    const current =
      "<response><dialogue>…きみ、ほんと、バカじゃないの。こんなに濡れてるなんて。</dialogue>" +
      "<action>タオルを押しつけて、髪を拭く手が止まる。</action></response>";

    const match = findCrossTurnRepetitionMatch(current, previous, [previous]);
    expect(match.isDuplicate).toBe(true);

    const redacted = redactRepeatedPhrasesFromHistory(
      [{ role: "assistant", content: previous }],
      match.repeatedPhrases ?? [],
    );

    for (const phrase of match.repeatedPhrases ?? []) {
      expect(redacted[0].content).not.toContain(phrase);
    }
    expect(redacted[0].content).not.toBe(previous);
  });
});

describe("#1495 伏せ字の物差し", () => {
  it("検出の下限（8 字）に満たん句は伏せん", () => {
    const messages: ChatMessage[] = [{ role: "assistant", content: "きみは、ほんとにばかだ。" }];

    expect(redactRepeatedPhrasesFromHistory(messages, ["ほんとに"])[0].content).toBe(
      "きみは、ほんとにばかだ。",
    );
  });

  it("長い句を先に伏せるので、短い句の残骸が残らん", () => {
    const messages: ChatMessage[] = [
      { role: "assistant", content: "こんなに濡れてるなんて、知らなかった。" },
    ];

    const redacted = redactRepeatedPhrasesFromHistory(messages, [
      "こんなに濡れてる",
      "こんなに濡れてるなんて、知らなかった",
    ]);

    expect(redacted[0].content).toBe("…。");
  });
});
