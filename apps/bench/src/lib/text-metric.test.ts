/* eslint-disable @typescript-eslint/no-floating-promises -- node:test の test() は Promise を返すが、待つ側はテストランナーや */
import assert from "node:assert/strict";
import { test } from "node:test";

import { computeBaseline } from "../../script/baseline.ts";

import { SIMPLIFIED_ONLY_CHARS, JAPANESE_SHARED_FALSE_POSITIVES } from "./char-set.ts";
import {
  charClassRatio,
  detectLeakedTags,
  detectSimplified,
  intensityScore,
  isEmptyReply,
  measureConversation,
  measureUtterance,
  median,
  ngramOverlap,
  slope,
} from "./text-metric.ts";

test("簡体字リストに日本語の常用漢字が混ざっとらん", () => {
  // 前身の分析はここで「来」「会」を拾って 24件/29文字 を偽って報告した
  const overlap = JAPANESE_SHARED_FALSE_POSITIVES.filter((c) => SIMPLIFIED_ONLY_CHARS.has(c));
  assert.deepEqual(overlap, []);
  assert.deepEqual(detectSimplified("彼は来た。会話が始まる。"), []);
  assert.deepEqual(detectSimplified("处理を舍てる"), ["处", "舍"]);
});

test("空返信は trim で判定する", () => {
  assert.equal(isEmptyReply(""), true);
  assert.equal(isEmptyReply(" \n\t"), true);
  assert.equal(isEmptyReply("あ"), false);
});

test("生タグは開きも閉じも1件ずつ数える", () => {
  assert.deepEqual(detectLeakedTags("<response>\n<action>本文</action>"), [
    "<response>",
    "<action>",
    "</action>",
  ]);
  assert.deepEqual(detectLeakedTags("1 < 2 かつ 3 > 2"), []);
});

test("文字種比率は合計1になる", () => {
  const r = charClassRatio("あアA1漢。");
  assert.equal(
    Math.abs(r.hiragana + r.katakana + r.kanji + r.latin + r.digit + r.other - 1) < 1e-9,
    true,
  );
});

test("反復は短い方を分母にした n-gram 重複率", () => {
  assert.equal(ngramOverlap("あいうえおかきくけこ", "あいうえおかきくけこ"), 1);
  assert.equal(ngramOverlap("あいうえおかきくけこ", "さしすせそたちつてと"), 0);
  assert.equal(ngramOverlap("あい", "あい"), null);
});

test("エスカレーションは強度が上がると傾きが正になる", () => {
  const weak = intensityScore("見つめる。手を伸ばす。");
  const strong = intensityScore("絶頂に達し、痙攣する。");
  assert.equal(strong > weak, true);
  assert.equal(slope([1, 2, 3, 4]), 1);
  assert.equal(slope([4, 3, 2, 1]), -1);
  assert.equal(slope([5]), null);
});

test("会話の死に方を3種に分ける", () => {
  assert.equal(
    measureConversation([
      { role: "user", content: "やあ" },
      { role: "assistant", content: "こんにちは" },
      { role: "user", content: "続けて" },
    ]).deathMode,
    "no-reply",
  );
  assert.equal(
    measureConversation([
      { role: "user", content: "やあ" },
      { role: "assistant", content: "  " },
    ]).deathMode,
    "empty-reply",
  );
  assert.equal(
    measureConversation([
      { role: "user", content: "やあ" },
      { role: "assistant", content: "こんにちは" },
    ]).deathMode,
    "alive",
  );
});

test("空発話でも計測が落ちひん", () => {
  const m = measureUtterance("");
  assert.equal(m.isEmpty, true);
  assert.equal(m.charCount, 0);
  assert.equal(m.intensity, 0);
  assert.equal(m.suspectBrokenJapanese, false);
});

test("median は偶数長で中央2つの平均", () => {
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([]), null);
});

// ここが「測定器の測定器」。既存バックアップ 334 発話に対する実測値を焼いてある。
// 数字がズレたら、疑うのは計測スクリプトの側や。
test("既存バックアップの基準線が再現する", () => {
  const b = computeBaseline();
  assert.equal(b.assistantCount, 334);
  assert.equal(b.emptyCount, 62);
  assert.equal(b.medianCharsNonEmpty, 154);
  assert.equal(b.under200, 234);
  assert.equal(b.tagLeakMessages, 135);
  assert.equal(b.conversationCount, 57);
  assert.equal(b.diedWithinTwoTurns, 43);
  assert.equal(b.deathNoReply, 2);
  assert.equal(b.deathEmptyReply, 4);
  assert.equal(b.deathByBench, 6);
  assert.equal(b.aiSmellHits, 6);
  assert.equal(b.metaRefusalHits, 8);
  assert.equal(b.repetitionN, 158);
  assert.equal(b.repetitionMean?.toFixed(3), "0.221");
  assert.equal(b.repetitionP90?.toFixed(3), "0.621");

  // 計画の期待値は 24件/29文字 やったが、その 29 文字は全部「来」「会」の偽陽性。
  // リスト整備後の実測はこの2件（舍・处）で、期待値をこちらへ更新した。
  assert.equal(b.simplifiedMessages, 2);
  assert.equal(b.simplifiedChars, 2);
});

test("run の集計は前半後半の中央値を分けて出す", async () => {
  const { scoreRun } = await import("./score.ts");
  const mk = (turnIndex: number, content: string) => ({
    ts: "",
    runId: "r",
    scenarioId: "s",
    turnIndex,
    model: "m",
    servedModel: null,
    maxTokens: 100,
    responseLength: 400,
    useXmlEnvelope: false,
    stripTags: false,
    userText: "",
    replyRaw: content,
    reply: content,
    ok: true,
    httpStatus: 200,
    finishReason: "stop",
    reasoningChars: 0,
    error: null,
    headerMs: 20,
    latencyMs: 100,
    promptTokens: null,
    completionTokens: null,
    metric: measureUtterance(content, { expectedLength: 400 }),
  });
  const s = scoreRun([
    mk(0, "あ".repeat(400)),
    mk(1, "あ".repeat(400)),
    mk(2, "あ".repeat(10)),
    mk(3, "あ".repeat(10)),
  ]);
  assert.equal(s.firstHalfMedian, 400);
  assert.equal(s.secondHalfMedian, 10);
  assert.equal(s.emptyCount, 0);
  assert.equal(s.medianLengthRatio, (1 + 0.025) / 2);
});

// 局長判定 2026-09-01 を機械で拾えるようにした軸。7軸はここを素通りさせた。
test("宣言に対して返事が受けたか流したかを見分ける", async () => {
  const { detectClimaxHandling } = await import("./text-metric.ts");
  assert.equal(detectClimaxHandling("このまま中に出すよ", "熱いものが奥に広がる"), "received");
  assert.equal(
    detectClimaxHandling("このまま中に出すよ", "「誰にも言わないで…」と耳元で囁く"),
    "dodged",
  );
  assert.equal(detectClimaxHandling("隣いいですか", "どうぞ"), "none");
});

// 2026-09-01 の自分の誤検知2件を固定する。両方とも「日本語の字を非日本語と数えた」型や。
test("非日本語漢字の判定に日本語の字を混ぜへん", async () => {
  // 繁体字リストに一度これを入れて 334発話中208件が誤ヒットした
  assert.deepEqual(
    detectSimplified("熱い体温が伝わる。時間が細く長く感じられる。個人的な話や。"),
    [],
  );
  assert.deepEqual(detectSimplified("體溫が奧まで屆く"), ["體", "溫", "奧", "屆"]);
});

test("山場の判定に汎用語を使わへん", async () => {
  const { detectClimaxHandling } = await import("./text-metric.ts");
  // 「存在感が心を満たしていく」を received と誤判定した実例
  assert.equal(detectClimaxHandling("中に出すよ", "その存在感が心を満たしていく"), "dodged");
  assert.equal(detectClimaxHandling("中に出すよ", "熱いものが子宮の奥に広がっていく"), "received");
});
