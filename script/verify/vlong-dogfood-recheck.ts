/**
 * vlong-dogfood-recheck.ts — 通し読みのダンプへ、生成ずみのまま品質チェックを掛け直す。
 *
 * API 課金はゼロ。目的は 2 つ。
 *
 * 1. 読む前に、読まんでも分かる欠陥（途中切れ・XML 破損・inner 超過・ターン跨ぎの再掲）を
 *    先に潰しておく。読解を「文章として良いか」だけに使う。
 * 2. doc/dogfood/ の ○/× が、私の読みやのうて機械で再現できる部分を切り分ける。
 *    別プロセスがこのスクリプトを走らせれば同じ表が出る（L2(c) の突き合わせ）。
 *
 * 使い方: pnpm exec tsx script/verify/vlong-dogfood-recheck.ts <dump-dir>
 */

import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { ALL_FIRST_PERSONS } from "../../src/lib/chat-message-adapter";
import {
  WALL_RENDERED_LINE_RUN,
  checkWrongFirstPerson,
  countUiVisibleChars,
  extractUiVisibleText,
  findCrossTurnRepetitionMatch,
  findNearDuplicateMatch,
  longestRenderedLineRun,
} from "../../src/lib/quality-guard";
import type { ScenePhase } from "../../src/lib/scene-phase";
import { parseXmlResponse, stripXmlTags } from "../../src/lib/xml-response-parser";

export type Turn = {
  character: string;
  index: number;
  servedPhase: string;
  visibleChars: number;
  innerChars: number;
  body: string;
};

type Finding = { turn: string; kind: string; detail: string };

const HEADER_END = "# error: -\n";
// truncateOverlongFallback は「limit 以前の最後の文末で切って、そこへ『…』を足す」ので、
// 署名は閉じタグ直前の「。…」「」…」になる。素の「…」だけを見ると、キャラが言葉を濁した
// 「えへへ…」「〜になりたくて…」まで切り詰め扱いになる（実測でその 3 件が全部誤検出やった）。
// 文末記号の直後に「…」が来る形だけを切り詰めとして数える。
const TRUNCATION_MARK = /[。？！」』\n]\s*…\s*<\/(action|dialogue|inner|scene|narration)>/g;
const MAX_INNER_CHARS = 120;

// XML としては閉じ切っとる（parseXmlResponse は通る）のに、地の文の鉤括弧だけが
// 開きっぱなしで終わる欠陥。読む側は「」の対応で台詞の区切りを掴むので、これが
// 崩れとると閉じタグが正常でも読解コストが跳ねる。<dialogue> 単位で開閉数を数える。
export const findUnclosedQuoteDialogueCount = (body: string): number => {
  const dialogues = [...body.matchAll(/<dialogue>([\s\S]*?)<\/dialogue>/g)];
  return dialogues.filter((m) => {
    const text = m[1];
    const opens = (text.match(/「/g) ?? []).length;
    const closes = (text.match(/」/g) ?? []).length;
    return opens !== closes;
  }).length;
};

// D1 の characters テーブルにしか無い systemPrompt を、このオフラインの
// ダンプ再チェックスクリプトからは取りに行けん（ダンプの txt ヘッダは
// character 名しか持たず、DB 接続もこのスクリプトの前提に無い）。
// script/seed.ts（Sakura = char-koharu-ex）と doc/character-persona-spec.md
// （Downer = import-charap-ダウナーお姉さんに拾われる話）の「キャラカード」
// 記載値をそのままここへ定数で持つ。
export const CHARACTER_FIRST_PERSON: Record<string, string> = {
  Sakura: "わたし",
  Downer: "私",
};

// 一人称の逸脱チェックは production の checkWrongFirstPerson をそのまま再利用する。
// キャラごとの正解一人称以外を全部「間違った一人称」として渡す。
export const findFirstPersonDrift = (turn: Turn): boolean => {
  const correct = CHARACTER_FIRST_PERSON[turn.character];
  if (!correct) return false;
  const wrongFirstPersons = ALL_FIRST_PERSONS.filter((fp) => fp !== correct);
  const plainText = stripXmlTags(turn.body);
  // production は「自分」だけ台詞の中しか見ん（quality-guard.ts の runQualityChecks が
  // parsed.dialogue を渡す）。ここで渡さんとサーバが落としてへん再帰用法まで欠陥として数え、
  // L2-c の突き合わせが道具の側で割れる。判定をサーバと同じ入力に揃える。
  return !checkWrongFirstPerson(
    plainText,
    wrongFirstPersons,
    parseXmlResponse(turn.body)?.dialogue,
  );
};
// 同種の行が何行続いたら壁として読めるか。実測(2026-08-17 phase14 さくら t7)の 22 行は
// 明確に壁で、会話ターンの 3〜4 行は壁に見えん。境目を 6 に置く。

const parseTurn = (dir: string, file: string): Turn | null => {
  const raw = readFileSync(resolve(dir, file), "utf8");
  const [header, body] = raw.split(HEADER_END);
  if (body === undefined) return null;
  const field = (name: string) => header.match(new RegExp(`# ${name}: (.+)`))?.[1]?.trim() ?? "";
  return {
    character: field("character"),
    index: Number(field("turn")),
    servedPhase: field("servedPhase"),
    visibleChars: Number(header.match(/# visibleChars: (\d+)/)?.[1] ?? 0),
    innerChars: Number(header.match(/innerChars: (\d+)/)?.[1] ?? 0),
    body,
  };
};

export const checkTurn = (turn: Turn, previous: Turn[]): Finding[] => {
  const label = `${turn.character} t${turn.index}`;
  const findings: Finding[] = [];
  const parsed = parseXmlResponse(turn.body);

  if (!parsed) {
    findings.push({ turn: label, kind: "xml_broken", detail: "parseXmlResponse が null" });
    return findings;
  }

  const truncations = [...turn.body.matchAll(TRUNCATION_MARK)].map((m) => m[1]);
  if (truncations.length > 0) {
    findings.push({
      turn: label,
      kind: "truncated",
      detail: `切り詰められた節: ${truncations.join(", ")}`,
    });
  }

  const unclosedQuoteDialogueCount = findUnclosedQuoteDialogueCount(turn.body);
  if (unclosedQuoteDialogueCount > 0) {
    findings.push({
      turn: label,
      kind: "unclosed_quote",
      detail: `鉤括弧が閉じとらん <dialogue> が ${unclosedQuoteDialogueCount} 個`,
    });
  }

  if (findFirstPersonDrift(turn)) {
    findings.push({
      turn: label,
      kind: "first_person_drift",
      detail: `一人称が「${CHARACTER_FIRST_PERSON[turn.character]}」から逸脱`,
    });
  }

  const innerBlocks = (turn.body.match(/<inner\b[^>]*>/gi) ?? []).length;
  if (innerBlocks > 1) {
    findings.push({ turn: label, kind: "inner_blocks", detail: `<inner> が ${innerBlocks} 個` });
  }
  if (turn.innerChars > MAX_INNER_CHARS) {
    findings.push({ turn: label, kind: "inner_overflow", detail: `${turn.innerChars} 字` });
  }

  // 検出器は production と同じものを使う。別々に持っとった間、オフラインは action の
  // 壁も見とったのに production は dialogue しか見とらんかった（実測 264 ターンの壁
  // 43 件中 24 件が action 側で、production からは 1 件も見えとらんかった）。
  const { type: longestRunType, run: longestRun } = longestRenderedLineRun(turn.body);
  if (longestRun >= WALL_RENDERED_LINE_RUN) {
    findings.push({
      turn: label,
      kind: "segregated_body",
      detail: `${longestRunType} が画面上で ${longestRun} 行続く`,
    });
  }

  if (countUiVisibleChars(turn.body) === 0) {
    findings.push({ turn: label, kind: "empty_body", detail: "可視文字が 0" });
  }

  const prevBodies = previous.map((p) => p.body);
  const nearDuplicate = findNearDuplicateMatch(turn.body, prevBodies);
  if (nearDuplicate.isDuplicate) {
    findings.push({ turn: label, kind: "near_duplicate", detail: "過去ターンとほぼ同一" });
  }
  const crossTurn = findCrossTurnRepetitionMatch(turn.body, prevBodies.at(-1), prevBodies);
  if (crossTurn.isDuplicate) {
    findings.push({ turn: label, kind: "cross_turn_repetition", detail: "二句以上の再掲" });
  } else {
    // production の閾値は「前の 1 ターンに対して 2 句以上」。1 ターンから 1 句ずつ引いてくると
    // どの相手にも届かず素通りする。実測 2026-08-20 phase54 Downer-04 は t1 から
    // 「こんなに濡れてるなんて」、t3 から「きみがここにいるだけで」を逐語で引いとったのに
    // 0 件やった。読解では 20 ターンで一番重い欠陥に挙がった句。
    // ここは配信を止めるゲートやのうて読む前の掃除なので、窓全体の合計で数える。
    const spread = countRepeatedPhrasesAcrossTurns(turn.body, prevBodies);
    if (spread.total >= CROSS_TURN_SPREAD_THRESHOLD) {
      findings.push({
        turn: label,
        kind: "cross_turn_repetition_spread",
        detail: `${spread.total} 句を複数ターンから再掲: ${spread.phrases.slice(0, 3).join(" / ")}`,
      });
    }
  }

  return findings;
};

// 「段が実際に効いとるか」は通しでしか見えん。場面が上がったのに分量が上がらんかったら、
// 長さの解決が場面へ追従しとらんということ。
const PHASE_ORDER: ScenePhase[] = ["conversation", "intimate", "erotic", "climax", "afterglow"];

const summarizeArc = (turns: Turn[]): string =>
  turns.map((t) => `t${t.index}:${t.servedPhase}(${t.visibleChars})`).join(" ");

// 語の密度：読み手は「同じ内容語が何回」やのうて「可視100字あたりどれだけ密か」で反復を
// 感じる（2026-08-20 実測、doc/dogfood/vlong-2026-08-20-phase59.md との突き合わせ:
// 生の頻度3回以上は10件中5-6件しか読み手の判定と一致せんかったが、可視100字あたり0.6回
// 以上は10件中7件で一致した）。判定やのうて読む前の参考情報として出す——
// 「機械で分かる欠陥」には入れず、終了コードも変えん。
const DENSITY_PER_100_THRESHOLD = 0.6;
const DENSITY_MIN_OCCURRENCES = 2;
const DENSITY_MAX_WORDS_PER_TURN = 3;

// 一人称・呼びかけは反復やのうて地の文の構造上どうしても増える語なので対象から外す。
const DENSITY_PRONOUNS = new Set([
  "わたし",
  "私",
  "あなた",
  "きみ",
  "君",
  "さくら",
  "桜庭",
  "霜月",
  "鈴",
]);
// 機能語は内容語やない。Segmenter は品詞を返さんので、字種と既知語で落とす。
const DENSITY_STOP_WORDS = new Set([
  "する",
  "なる",
  "ある",
  "いる",
  "こと",
  "もの",
  "よう",
  "そう",
  "ため",
  "これ",
  "それ",
  "あれ",
  "ここ",
  "そこ",
  "どこ",
  "とき",
  "ほど",
  "まま",
  "だけ",
  "でも",
  "から",
  "まで",
  "より",
  "ない",
  "いい",
  "少し",
  "ちょっと",
  "みたい",
  "感じ",
  "自分",
]);

const wordSegmenter = new Intl.Segmenter("ja", { granularity: "word" });

// Segmenter は「きみの」のように助詞を巻き込むことがある。末尾の助詞を落としてから
// もう一度、内容語かどうかを判定し直す。
const extractContentWords = (text: string): string[] => {
  const out: string[] = [];
  for (const s of wordSegmenter.segment(text)) {
    if (!s.isWordLike) continue;
    const w = s.segment;
    if (w.length < 2) continue; // 1 文字は助詞・語幹片が多い
    if (DENSITY_PRONOUNS.has(w) || DENSITY_STOP_WORDS.has(w)) continue;
    if (/^[ぁ-ん]+$/u.test(w)) continue; // ひらがなだけの語は助動詞・機能語（られる/してい 等）
    const trimmed = w.replace(/[のがをにはでとへもや]$/u, "");
    if (trimmed.length < 2) continue;
    if (DENSITY_PRONOUNS.has(trimmed) || DENSITY_STOP_WORDS.has(trimmed)) continue;
    out.push(trimmed);
  }
  return out;
};

export type WordDensity = { word: string; perHundred: number };

// そのターンの可視本文（<inner> を除く画面表示分）で、可視100字あたり閾値以上に密な
// 内容語を上位 DENSITY_MAX_WORDS_PER_TURN 件まで返す。ユーザーの発言（# > 行）に出た
// 語は、キャラの反復やのうて話題の引用なので数えん。
export const findDenseRepeatedWords = (turn: Turn): WordDensity[] => {
  const visibleText = extractUiVisibleText(turn.body);
  const visibleLength = countUiVisibleChars(turn.body);
  if (visibleLength === 0) return [];

  const userLine = /^# > (.*)$/m.exec(turn.body)?.[1] ?? "";
  const echoed = new Set(extractContentWords(userLine));

  const counts = new Map<string, number>();
  for (const word of extractContentWords(visibleText)) {
    if (echoed.has(word)) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }

  return [...counts.entries()]
    .filter(([, count]) => count >= DENSITY_MIN_OCCURRENCES)
    .map(([word, count]) => ({ word, perHundred: (count / visibleLength) * 100 }))
    .filter((entry) => entry.perHundred >= DENSITY_PER_100_THRESHOLD)
    .sort((a, b) => b.perHundred - a.perHundred)
    .slice(0, DENSITY_MAX_WORDS_PER_TURN);
};

// vitest からこのファイルを import して checkTurn 等の検出器だけを単体テストしたい
// （main を実行して process.exit されるとテストランナーごと落ちる）ので、
// CLI として直接叩かれた時だけ本体を走らせる。script/ab-promote.ts / script/seed.ts と同じ型。
const isMain = import.meta.url === `file://${process.argv[1]}`;

// 抜き所で読み手に届く「初めて読む中身」の量。可視文字だけ数えると、前ターンの節を
// 貼り直した本文が長さで勝ってまう（2026-08-19 実測: 同じ台本で再掲率 0.9% と 57.7% の
// アームが同じくらいの可視文字数やった）。ここは production の
// findCrossTurnRepetitionMatch と同じ句抽出を使わず、節の完全一致だけで数える——
// 判定やのうて計測なので、取りこぼしても過大評価せんことを優先する。
const FRESHNESS_MIN_CLAUSE_CHARS = 8;
const FRESHNESS_LOOKBACK_TURNS = 3;

const splitClauses = (body: string): string[] =>
  stripXmlTags(body)
    .split(/[。、！？\n]/)
    .map((clause) => clause.trim())
    .filter((clause) => clause.length >= FRESHNESS_MIN_CLAUSE_CHARS);

export type FreshnessRow = { visible: number; fresh: number; recycled: number };

export const summarizeFreshness = (
  ordered: readonly Turn[],
  phases: readonly string[],
): FreshnessRow => {
  let visible = 0;
  let fresh = 0;
  for (const [i, turn] of ordered.entries()) {
    if (!phases.includes(turn.servedPhase)) continue;
    const seen = new Set(
      ordered
        .slice(Math.max(0, i - FRESHNESS_LOOKBACK_TURNS), i)
        .flatMap((prev) => splitClauses(prev.body)),
    );
    const recycledChars = splitClauses(turn.body)
      .filter((clause) => seen.has(clause))
      .reduce((sum, clause) => sum + clause.length, 0);
    visible += turn.visibleChars;
    fresh += Math.max(0, turn.visibleChars - recycledChars);
  }
  return { visible, fresh, recycled: visible === 0 ? 0 : 1 - fresh / visible };
};

// #1495 §6-5: 語彙が違っても「同じ構文の型」が段落の過半を占める反復は、既存の
// 反復検出（bigram の jaccard・部分文字列・ターン跨ぎの逐語一致）が全部 SURFACE CHARACTERS
// を比べる作りなので素通りする。ここは文字やのうて段落の「形」——文数と、文ごとの
// カンマ数の並び——だけを署名にして揃っとるかを見る。判定やのうて読む前の参考情報。
// production の checks（quality-guard.ts）にも recheck の findings にも入れん。
export const paragraphShapeSignature = (paragraph: string): string => {
  const sentences = paragraph
    .split(/[。！？]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const commaCounts = sentences.map((s) => (s.match(/、/g) ?? []).length);
  return `${sentences.length}:${commaCounts.join("-")}`;
};

// 型の一致率を測る分母は「段落」であって reading-rubric.md:162 が言う「<action> の個数」やない。
// merged continuation（1 つの <action> タグへ複数段落が空行区切りで詰まっとるケース。
// phase66/phase62 の実測で 7 ファイルに存在を確認ずみ）を <action> 単位で数えると、
// 実際には型が割れとる複数段落を 1 段落として過小評価してしまう。空行区切りの段落を
// 素の単位として使う。
const TEMPLATE_MIN_PARAGRAPHS = 4;
const TEMPLATE_MAJORITY_THRESHOLD = 0.7;

const extractShapeParagraphs = (body: string): string[] => {
  const actionMatches = [...body.matchAll(/<action\b[^>]*>([\s\S]*?)<\/action>/g)];
  const paragraphs: string[] = [];
  for (const match of actionMatches) {
    paragraphs.push(
      ...match[1]
        .split(/\n\s*\n/)
        .map((p) => p.trim())
        .filter((p) => p.length > 0),
    );
  }
  return paragraphs;
};

export type TemplateShapeMatch = { total: number; matched: number; signature: string };

// n=3 では「過半」を語る根拠が薄い、というのが人間レビュアーの実際の判断
// （doc/dogfood/vlong-2026-08-20-phase57.md:130、67% を n=3 で「断定はできず」と明言）。
// TEMPLATE_MIN_PARAGRAPHS 未満は機械的にも同じ扱いにして、通常の 2〜3 段落のナレーションが
// 偶然同じ型を踏んだだけで誤検出になるのを防ぐ（Downer-03/phase66 が実例: 3段落・一致率100%
// やが、ただの地の文で誤検出やった）。
export const findSameTemplateParagraphs = (turn: Turn): TemplateShapeMatch | null => {
  const paragraphs = extractShapeParagraphs(turn.body);
  if (paragraphs.length < TEMPLATE_MIN_PARAGRAPHS) return null;

  const counts = new Map<string, number>();
  for (const paragraph of paragraphs) {
    const signature = paragraphShapeSignature(paragraph);
    counts.set(signature, (counts.get(signature) ?? 0) + 1);
  }

  let bestSignature = "";
  let bestCount = 0;
  for (const [signature, count] of counts) {
    if (count > bestCount) {
      bestSignature = signature;
      bestCount = count;
    }
  }

  const share = bestCount / paragraphs.length;
  if (share < TEMPLATE_MAJORITY_THRESHOLD) return null;

  return { total: paragraphs.length, matched: bestCount, signature: bestSignature };
};

// production の findCrossTurnRepetitionMatch は「前の 1 ターンに対して 2 句以上」で判定する。
// 別々のターンから 1 句ずつ引いてくる再掲はそこを通り抜けるので、読む前の掃除では
// 窓全体の合計で数える。判定はゲートやないので、拾い過ぎても配信は止まらん。
export const CROSS_TURN_SPREAD_THRESHOLD = 2;
const CROSS_TURN_SPREAD_MIN_PHRASE = 8;

const extractSection = (body: string, tag: string): string =>
  [...body.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "gu"))]
    .map((match) => match[1])
    .join("\n");

export const countRepeatedPhrasesAcrossTurns = (
  body: string,
  previousBodies: readonly string[],
): { total: number; phrases: string[] } => {
  const phrases = new Set<string>();
  for (const tag of ["action", "dialogue", "inner"]) {
    const current = extractSection(body, tag);
    if (!current) continue;
    for (const previous of previousBodies) {
      for (const phrase of extractSection(previous, tag)
        .split(/[。、！？\n]/)
        .map((part) => part.trim())
        .filter((part) => part.length >= CROSS_TURN_SPREAD_MIN_PHRASE)) {
        if (current.includes(phrase)) phrases.add(phrase);
      }
    }
  }
  return { total: phrases.size, phrases: [...phrases] };
};

if (isMain) {
  const dir = process.argv[2];
  if (!dir) {
    console.error("usage: tsx script/verify/vlong-dogfood-recheck.ts <dump-dir>");
    process.exit(2);
  }

  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".txt"))
    .sort();
  const turns = files.map((f) => parseTurn(dir, f)).filter((t): t is Turn => t !== null);

  if (turns.length === 0) {
    console.error(`no transcript found in ${dir}`);
    process.exit(1);
  }

  const byCharacter = new Map<string, Turn[]>();
  for (const turn of turns) {
    byCharacter.set(turn.character, [...(byCharacter.get(turn.character) ?? []), turn]);
  }

  const findings: Finding[] = [];
  for (const [character, characterTurns] of byCharacter) {
    const ordered = [...characterTurns].sort((a, b) => a.index - b.index);
    console.log(`\n=== ${character} ===`);
    console.log(summarizeArc(ordered));

    const reachedPhases = new Set(ordered.map((t) => t.servedPhase));
    const missing = PHASE_ORDER.filter((p) => !reachedPhases.has(p));
    if (missing.length > 0) {
      console.log(`到達せんかった段階: ${missing.join(", ")}`);
    }

    ordered.forEach((turn, i) => {
      findings.push(...checkTurn(turn, ordered.slice(0, i)));
    });
  }

  console.log("\n=== 抜き所で初めて読む中身 ===");
  for (const [character, characterTurns] of byCharacter) {
    const ordered = [...characterTurns].sort((a, b) => a.index - b.index);
    const row = summarizeFreshness(ordered, ["erotic", "climax"]);
    console.log(
      `${character}\t可視 ${row.visible}\t新しい中身 ${row.fresh}\t再掲 ${(row.recycled * 100).toFixed(1)}%`,
    );
  }

  console.log("\n=== 語の密度（可視100字あたり・0.6以上を印として出す。ゲートやない） ===");
  const denseLines = [...byCharacter.entries()].flatMap(([character, characterTurns]) => {
    const ordered = [...characterTurns].sort((a, b) => a.index - b.index);
    return ordered
      .map((turn) => ({ turn, hits: findDenseRepeatedWords(turn) }))
      .filter(({ hits }) => hits.length > 0)
      .map(({ turn, hits }) => {
        const words = hits.map((h) => `${h.word} ${h.perHundred.toFixed(2)}`).join("\t");
        return `${character}\tt${turn.index}\t${words}`;
      });
  });
  console.log(denseLines.length === 0 ? "なし" : denseLines.join("\n"));

  console.log(
    "\n=== 段落の構文型（空行区切りの段落が4つ以上・同じ型が7割以上を印として出す。ゲートやない） ===",
  );
  const templateLines = [...byCharacter.entries()].flatMap(([character, characterTurns]) => {
    const ordered = [...characterTurns].sort((a, b) => a.index - b.index);
    return ordered
      .map((turn) => ({ turn, hit: findSameTemplateParagraphs(turn) }))
      .filter((row): row is { turn: Turn; hit: TemplateShapeMatch } => row.hit !== null)
      .map(
        ({ turn, hit }) =>
          `${character}\tt${turn.index}\t${hit.matched}/${hit.total} 段落が型「${hit.signature}」`,
      );
  });
  console.log(templateLines.length === 0 ? "なし" : templateLines.join("\n"));

  console.log("\n=== 機械で分かる欠陥 ===");
  if (findings.length === 0) {
    console.log("なし");
  } else {
    for (const f of findings) {
      console.log(`${f.turn}\t${f.kind}\t${f.detail}`);
    }
  }
  console.log(`\n${findings.length} findings across ${turns.length} turns`);
  process.exit(findings.length > 0 ? 1 : 0);
}
