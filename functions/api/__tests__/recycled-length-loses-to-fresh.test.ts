// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  countFreshContentChars,
  countUiVisibleChars,
  extractUiVisibleText,
} from "../../../src/lib/quality-guard";
import { preferNextAttemptForFloor } from "../lib/route-context";

// 実測 2026-08-19: 選別をフロア優先へ寄せた phase47 は、erotic/climax の可視文字の
// 57.7% が前ターンからの逐語やった（同じ台本の phase43 は 1.3%）。長さは戻ったが
// 中身が戻っとらん状態で、読み手に届くのは「同じ話を二回された」だけになる。
// ターン内の重複を差し引く countDistinctContentChars では跨ぎの貼り直しが素通りする。

const buildResponse = (actions: readonly string[], dialogues: readonly string[]): string =>
  [
    "<response>",
    ...actions.flatMap((action, index) => [
      `<action>${action}</action>`,
      dialogues[index] ? `<dialogue>${dialogues[index]}</dialogue>` : "",
    ]),
    "<inner>頭の芯がぼんやりして、うまく言葉が出てこなかった。</inner>",
    "</response>",
  ]
    .filter((line) => line.length > 0)
    .join("\n");

const PRIOR_ACTIONS = [
  "きみの手がわたしの腰を引き寄せ、指先が背中の窪みをゆっくりとなぞっていった。",
  "きみの息がわたしの首筋にかかり、産毛が立つほどの熱がそこに残された。",
  "きみの体温がわたしの肌を温め、触れた場所から溶けていくような感覚が広がった。",
  "雨音が窓ガラスを軽く打ち、部屋の空気がいっそう濃くなったように思えた。",
] as const;

const PRIOR_DIALOGUES = [
  "「……もう、逃げられないよ」",
  "「その顔、もっと見せて」",
  "「わたしのこと、ちゃんと見て」",
  "「息、上がってる」",
] as const;

const previousTurn = buildResponse(PRIOR_ACTIONS, PRIOR_DIALOGUES);

// 前ターンの節をそのまま並べ直しただけの長い試行。可視文字だけ見ると最長になる。
const recycledAttempt = buildResponse(
  [...PRIOR_ACTIONS, ...PRIOR_ACTIONS],
  [...PRIOR_DIALOGUES, ...PRIOR_DIALOGUES],
);

// 前ターンと重ならん本文。可視文字では recycled に負ける。
const freshAttempt = buildResponse(
  [
    "指が腿の内側を辿り、震えが膝から腰へ駆け上がってわたしの呼吸を乱していった。",
    "奥を押し広げられるたび、粘つく音が耳のすぐ横で鳴って頭の芯が白く濁った。",
    "汗ばんだ髪が頬に貼りつき、噛みしめた唇から抑えきれない声が漏れ落ちた。",
  ],
  ["「そこ、だめ……」", "「変になっちゃう、から」", "「……もっと、ください」"],
);

describe("countFreshContentChars", () => {
  it("前ターンで配った節は新しい中身に数えん", () => {
    const recycledVisible = extractUiVisibleText(recycledAttempt);
    const previousVisible = [extractUiVisibleText(previousTurn)];
    expect(countFreshContentChars(recycledVisible, previousVisible)).toBeLessThan(
      countFreshContentChars(recycledVisible) / 2,
    );
  });

  it("前ターンと重ならん本文は目減りせん", () => {
    const freshVisible = extractUiVisibleText(freshAttempt);
    const previousVisible = [extractUiVisibleText(previousTurn)];
    expect(countFreshContentChars(freshVisible, previousVisible)).toBe(
      countFreshContentChars(freshVisible),
    );
  });
});

describe("preferNextAttemptForFloor は貼り直しで長いだけの試行を勝たせん", () => {
  const previousVisible = [extractUiVisibleText(previousTurn)];
  // 実フロア(erotic 820)より小さいのは、この検証が本文の量やのうて選別の分岐を見とるから。
  const minChars = 300;

  it("可視文字では貼り直しの方が長い（前提の確認）", () => {
    expect(countUiVisibleChars(recycledAttempt)).toBeGreaterThan(countUiVisibleChars(freshAttempt));
    expect(countUiVisibleChars(recycledAttempt)).toBeGreaterThanOrEqual(minChars);
  });

  it("貼り直しの試行から、短いが新しい試行へ乗り換える", () => {
    const shouldPreferFresh = preferNextAttemptForFloor({
      nextDistinct: countFreshContentChars(extractUiVisibleText(freshAttempt), previousVisible),
      currentDistinct: countFreshContentChars(
        extractUiVisibleText(recycledAttempt),
        previousVisible,
      ),
      nextVisible: countUiVisibleChars(freshAttempt),
      currentVisible: countUiVisibleChars(recycledAttempt),
      minChars,
      nextReadable: true,
      currentReadable: true,
    });
    expect(shouldPreferFresh).toBe(true);
  });

  it("前ターンが無い1ターン目では長い方が勝つ（過剰な降格を起こさん）", () => {
    const shouldPreferFresh = preferNextAttemptForFloor({
      nextDistinct: countFreshContentChars(extractUiVisibleText(freshAttempt)),
      currentDistinct: countFreshContentChars(extractUiVisibleText(recycledAttempt)),
      nextVisible: countUiVisibleChars(freshAttempt),
      currentVisible: countUiVisibleChars(recycledAttempt),
      minChars,
      nextReadable: true,
      currentReadable: true,
    });
    expect(shouldPreferFresh).toBe(false);
  });
});
