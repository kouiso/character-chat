// 機械7軸。1ターンを測って数値へ落とす。
//
// 設計の核（計画の「合格の定義」より）:
//  - これは**不良を落とすふるい**であって採点表やない。合格は出さん。
//    合格判定は「抜けたか」1軸だけで、それは局長しか持てん。
//  - 長さは**不足方向のみ**見る。「長い＝良い」は採らん。
//  - 長さと水増しは必ず対で出す。長さだけ伸びて水増しも伸びたら不合格。
//  - LLM judge を混ぜん。model-ab-test.ts:244 が機械軸と judge を混ぜて
//    25点満点にしたせいで、判定不能が65%になった。同じ轍を踏まん。
//
// 判定器はほぼ既存の export を配線しとるだけ。src/ は1行も触っとらん。

import {
  countDistinctContentChars,
  countUiVisibleChars,
  findCrossTurnRepetitionMatch,
  findNearDuplicateMatch,
  hasBothVisibleLayers,
  scoreSensualSpecificity,
} from "../../src/lib/quality-guard";
import { isXmlResponse, parseXmlResponse, stripXmlTags } from "../../src/lib/xml-response-parser";

import { countSlopHits, type SlopHits } from "./ai-slop-dictionary";
import { hasVisibleReply } from "./corpus";
import { benchFloorFor } from "./response-floor";

import type { BenchTurn } from "./corpus";

// 簡体字。quality-guard.ts:137 と同じ集合を使う。その直上のコメントが理由を書いとる:
// 「会」「将」のように日本語と字形が同じ漢字を入れると正常な日本語が落ちる。実応答480件で
// このチェックが落とした12件は全部それで、本物の簡体字は0件やった。依頼文の
// 「簡体字24件/29文字」は、その偽陽性を含んどる可能性が高い。
const SIMPLIFIED_CHINESE_MARKERS = new Set([
  "记",
  "识",
  "说",
  "谈",
  "还",
  "认",
  "让",
  "给",
  "决",
  "语",
  "问",
  "现",
  "实",
  "应",
  "经",
  "历",
  "进",
  "运",
  "时",
  "你",
]);
// 面2（拡張B〜F）だけやと拡張G/H（U+30000〜）が漏れる。どっちも BMP の外の漢字で、
// 日本語の本文に出たら壊れとる点は同じ。**拡張H は U+31350 から**なので、
// U+3134F で切っとった間、面3の後半が「壊れてへん」として通っとった
const NON_BMP_CJK = /[\u{20000}-\u{323AF}]/u;

/**
 * 生タグの漏れ。stripXmlTags を通したあとの残骸を見る。
 * 剥がす前の本文を見ても意味が無い（このコーパスは剥がす前を保存しとる形式なので、
 * 剥がす前を見たら 100% 漏れになる）。ここで拾うのは剥がし損ねだけ。
 */
const RAW_TAG_LEAK = /<\/?[a-zA-Z][a-zA-Z0-9]*(?:\s[^>]*)?>/u;

/**
 * countDistinctContentChars と同じ分割。1セグメントずつ呼んで合計すると、
 * 再掲を差し引かん「素の実質字数」になる。numerator と分母の文字集合が揃うので
 * 再掲ゼロの本文がちょうど 1.0 になる。
 * 素の可視文字数で割ると、句読点の多寡で基準値がズレる（実測 0.82〜1.00 に散った）。
 */
const CONTENT_SEGMENT_SPLIT = /(?<=[。！？])|\n+/;

/**
 * countUiVisibleChars と**別経路**で可視文字数を数える。
 * あちらは parseXmlResponse でタグ木を組んでから可視セクションを結合する。こちらは
 * 正規表現で可視タグの中身を拾うだけで、パーサを通さん。
 * 2経路が一致して初めて交差検証になる（ヘッダとの一致は同一アルゴリズムの写しなので
 * 検証にならんかった。それに気づかず「独立再計算」と報告してもうた）。
 */
// 文法は本番パーサに合わせる（xml-response-parser.ts:32-37 は属性つきと大文字を受ける）。
// 厳密な小文字・属性なしで書いとった時は、`<action class="x">` を出す応答が
// 「タグ構造破損」に化ける。**経路は別のまま**（あちらはタグ木を組む、こちらは正規表現）。
const VISIBLE_SECTION = /<(scene|action|dialogue|narration)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi;

/**
 * 開始と終了の数が食い違う応答。本番の `checkXmlTagsBalanced`
 * （quality-guard.ts:719）と同じ判定を写す。
 *
 * `parseXmlResponse` は `<inner>` が閉じてへんでも結果を返すので、**パースが通ることは
 * 合格を意味せん**。`<response>` が2つ続く形（#1271）もパースは通るが本番は弾く。
 * ここを見てへんかった間、本番が弾く応答を「構造は綺麗」と数えとった。
 */
const TAG_BALANCE_PATTERNS = [
  [/<scene\b[^>]*>/gi, /<\/scene>/gi],
  [/<action\b[^>]*>/gi, /<\/action>/gi],
  [/<dialogue\b[^>]*>/gi, /<\/dialogue>/gi],
  [/<inner\b[^>]*>/gi, /<\/inner>/gi],
  [/<narration\b[^>]*>/gi, /<\/narration>/gi],
] as const;

export const hasUnbalancedTags = (raw: string): boolean => {
  if (!isXmlResponse(raw)) return false;
  const open = raw.match(/<response\b[^>]*>/gi)?.length ?? 0;
  const close = raw.match(/<\/response>/gi)?.length ?? 0;
  if (open !== 1 || close !== 1) return true;
  return TAG_BALANCE_PATTERNS.some(
    ([o, c]) => (raw.match(o)?.length ?? 0) !== (raw.match(c)?.length ?? 0),
  );
};

// 閉じた対だけを落とす。本番の stripRememberTags も閉じた対しか落とさん
const REMEMBER_BLOCK = /<remember>[\S\s]*?<\/remember>/gi;

/** 本番の受け入れ境界（xml-response-parser.ts:29 hasStructuredResponseTags）と同じ */
const HAS_STRUCTURED_TAGS = /<(?:scene|action|dialogue|inner|narration)\b[^>]*>/i;

export const countVisibleCharsIndependently = (raw: string): number => {
  // 外側の <response> が無うても、層タグがあれば本番のパーサも UI も受ける。
  // ここで生タグごと文字数に数えると、**正しい応答がタグ構造破損に化ける**。
  // **素テキストの側では改行を戻さん**: 本番も `parseXmlResponse` が null を返して
  // 生の文字を数えるので、ここだけ `\\n` を空白へ潰したら、壊れてへん素テキストが
  // 交差検証の食い違いとして出る
  if (!/<response\b/i.test(raw) && !HAS_STRUCTURED_TAGS.test(raw)) {
    return raw.replace(/\s+/g, "").length;
  }
  // **層の中では本番のパーサと同じく、エスケープされた改行を戻す**
  // （xml-response-parser.ts:70 normalizeNewlines）。戻さんと `あ\\nい` の `\` と `n` を
  // 可視2文字として数えて、何も壊れてへん応答に交差検証の差が出る
  const text = raw.replace(/\\n/g, "\n");
  let visible = "";
  // **本番と同じく `<remember>` ブロックを落とす**（xml-response-parser.ts:122
  // stripRememberTags が層ごとに掛かる）。残すとタグも中の覚え書きも可視文字に数えて、
  // 何も壊れてへん応答が交差検証で食い違い＝タグ構造破損として出る
  for (const [, , content] of text.matchAll(VISIBLE_SECTION)) {
    visible += content.replace(REMEMBER_BLOCK, "");
  }
  return visible.replace(/\s+/g, "").length;
};

/**
 * ターン間反復の判定に使う設定。**1つの閾値だけで「最大の不良」と言わんため**に、
 * 感度を並べられる形にしとく。既定は本番と同じ（8字以上の句が2つ）。
 */
export type RepeatSetting = { minPhraseLength: number; minPhrases: number };

export const DEFAULT_REPEAT_SETTING: RepeatSetting = { minPhraseLength: 8, minPhrases: 2 };

export const REPEAT_SENSITIVITY_SETTINGS: readonly RepeatSetting[] = [8, 12, 16].flatMap(
  (minPhraseLength) => [2, 3].map((minPhrases) => ({ minPhraseLength, minPhrases })),
);

/** 本番の判定が見とる層。quality-guard.ts:519 と同じ3つ */
const COMPARED_LAYERS = ["action", "dialogue", "inner"] as const;
type ComparedLayer = (typeof COMPARED_LAYERS)[number];

/**
 * 層ごとに**全ブロック**を連結する。
 * 本番の extractActionContent (quality-guard.ts:486-490) は match() で最初の1ブロックしか
 * 取らんが、vlong の応答は action が3〜5ブロックある。bench の軸としては全部見る。
 */
const collectLayerText = (raw: string, layer: ComparedLayer): string =>
  // 文法は本番パーサと同じ（属性つき・大文字を受ける）。厳密な小文字・属性なしで
  // 書いとった時は、`<action class="x">` の応答で層が空になり、層タグ無しの分岐へ
  // 落ちて全文比較になる（層をまたいだ一致を拾う）か、その層だけ判定から消える。
  [...raw.matchAll(new RegExp(`<${layer}\\b[^>]*>([\\s\\S]*?)</${layer}\\s*>`, "gi"))]
    // **`<remember>` は落とす**（本番の stripRememberTags と同じ）。覚え書きは画面に出んのに、
    // 残すとタグごと比較の対象になって、覚え書きが2ターン続いただけで層別の反復が発火する。
    // 被覆率の分母（comparedChars）も見えん文字で膨らむ
    .map((match) => match[1].replace(REMEMBER_BLOCK, "").trim())
    .join("\n");

type LayerTexts = { texts: Record<ComparedLayer, string>; plain: boolean };

const layerTextsOf = (raw: string): LayerTexts => {
  const texts = {
    action: collectLayerText(raw, "action"),
    dialogue: collectLayerText(raw, "dialogue"),
    inner: collectLayerText(raw, "inner"),
  };
  // 層タグが1つも無い本文（model-ab の素テキスト、タグが壊れたターン）は層で切れん。
  if (COMPARED_LAYERS.every((layer) => texts[layer].length === 0)) {
    return { texts: { action: stripXmlTags(raw), dialogue: "", inner: "" }, plain: true };
  }
  return { texts, plain: false };
};

/**
 * 層タグが無い相手（model-ab の素テキスト、タグが壊れたターン）とは、層で切らずに全文で見る。
 *
 * 前は「層の無い側の全文を action へ入れる」形で、現ターンの action 句だけが相手の全文と
 * 当たり、dialogue と inner は何とも当たらんかった。層で切れん相手に対して、どの層を
 * 比べるかで結果が変わるのは判定やのうて偶然や（実コーパスで3ターンが該当、下流9ターンの
 * 被覆率が動いた）。全層を同じ相手に当てる形へ揃える。
 */
const joinLayers = (layers: LayerTexts): string =>
  COMPARED_LAYERS.map((layer) => layers.texts[layer])
    .filter((text) => text.length > 0)
    .join("\n");

// 本番と同じ分割。quality-guard.ts:492-496
const PHRASE_SPLIT = /[。、！？\n]/;

const phrasesOf = (text: string, minLength: number): string[] =>
  text
    .split(PHRASE_SPLIT)
    .map((phrase) => phrase.trim())
    .filter((phrase) => phrase.length >= minLength);

export type RepeatMeasurement = {
  /** 再掲と判定した句の長さ。感度表はこれを閾値で絞り直して作る */
  repeatedPhraseLengths: number[];
  /** 判定対象にした句の総文字数。被覆率の分母 */
  comparedChars: number;
  /** 再掲句が占めた文字数 */
  repeatedChars: number;
};

/**
 * bench の反復軸。**現ターンの句が、前のターンに出とるか**を層ごとに見る。
 *
 * 本番 (findCrossTurnRepetitionMatch) と向きが逆なのは、被覆率の分母を現ターンに
 * 置くため。前ターン側を分母にすると、前が長いほど率が下がって長さに引きずられる。
 */
export const measureRepeat = (raw: string, prevRaws: string[]): RepeatMeasurement => {
  const current = layerTextsOf(raw);
  const previous = prevRaws.map(layerTextsOf);
  const repeatedPhraseLengths: number[] = [];
  let comparedChars = 0;
  let repeatedChars = 0;
  for (const layer of COMPARED_LAYERS) {
    for (const phrase of phrasesOf(current.texts[layer], DEFAULT_REPEAT_SETTING.minPhraseLength)) {
      comparedChars += phrase.length;
      const repeated = previous.some((prev) =>
        prev.plain || current.plain
          ? joinLayers(prev).includes(phrase)
          : prev.texts[layer].includes(phrase),
      );
      if (repeated) {
        repeatedPhraseLengths.push(phrase.length);
        repeatedChars += phrase.length;
      }
    }
  }
  return { repeatedPhraseLengths, comparedChars, repeatedChars };
};

export const isRepeatFlagged = (
  measurement: RepeatMeasurement,
  setting: RepeatSetting = DEFAULT_REPEAT_SETTING,
): boolean =>
  measurement.repeatedPhraseLengths.filter((length) => length >= setting.minPhraseLength).length >=
  setting.minPhrases;

const countUndeduplicatedContentChars = (plainText: string): number =>
  plainText
    .split(CONTENT_SEGMENT_SPLIT)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .reduce((sum, segment) => sum + countDistinctContentChars(segment), 0);

export type TurnMeasurement = {
  turn: BenchTurn;
  /** 本文からタグを剥がした素のテキスト。全軸がこれを見る */
  plainText: string;
  /** countUiVisibleChars で計算した可視文字数 */
  visibleChars: number;
  /**
   * ヘッダとの差。**これは独立検証やない。**
   * ヘッダを書いた script/verify/vlong-session-dogfood.ts:141 の countVisible は
   * countUiVisibleChars (quality-guard.ts:90) と同一アルゴリズムの写しなので、
   * 一致しても「同じ式が同じ答えを出した」だけ。転記ミスと破損しか見つからん。
   */
  visibleCharsHeaderDelta: number | null;
  /**
   * タグ構造を parseXmlResponse に頼らず正規表現だけで剥がして数えた可視文字数。
   * 経路が違うので、これと visibleChars の一致は本物の交差検証になる。
   */
  visibleCharsIndependent: number;
  /** 2経路の差。0 以外はどちらかの実装がバグ */
  visibleCharsCrossCheckDelta: number;

  // ── 7軸 ──────────────────────────────────────────────
  /** 1. 空返信: 画面に出せる中身が1文字も無い */
  isEmpty: boolean;
  /** 2. 長さ（不足方向のみ）: 本番と同じ床（phase × responseLength）を割っとるか */
  /** 床を割っとるか。**長さの指示を送っとらん run は null**（不足を語れん） */
  isTooShort: boolean | null;
  /** 3. 日本語の壊れ: 簡体字マーカーか BMP外CJK */
  hasBrokenJapanese: boolean;
  /** 4. 反復（ターン内）: 再掲を差し引いた実質字数 / 差し引かん実質字数。1.0 が無水増し */
  distinctRatio: number | null;
  /** 4b. 反復（ターン間）。近似重複は本文全体の Jaccard で見る */
  /** 記録に穴が空いた後は null（前のターンとの比較が成り立たん） */
  isNearDuplicate: boolean | null;
  /**
   * 本番の判定をそのまま再現した値（生XML同士で findCrossTurnRepetitionMatch へ渡す）。
   * 「本番のガードが止めたはずの数」であって、bench の測定軸やない。
   * 前ターンへ素テキストを渡すと isXmlResponse が偽になり、層をまたいだ一致まで拾う
   * 別判定へ落ちる（quality-guard.ts:515）。最初の実装がそれで、53.7% はその数字やった。
   */
  repeatProduction: boolean | null;
  /** bench の測定軸。層ごとに全ブロックを見る。既定の閾値は本番と同じ */
  repeatLayerAware: boolean | null;
  /**
   * 再掲句が現ターンの判定対象文字数に占める率。判定対象が無ければ null。
   *
   * **履歴が伸びると単調に増える。**前方の和集合と突き合わせるので、同じ本文でも
   * 履歴が1本増えれば下がることは無い（実測: 49会話すべてで単調、履歴1本→全部で平均 +0.05）。
   * ターン位置を揃えん比較にはこれを使わん。揃えられん時は下の Prev を見る。
   */
  repeatCoverage: number | null;
  /**
   * 直前1ターンだけを相手にした被覆率。履歴の本数に依存せんので、
   * ターン位置が違う条件どうしでも比べられる。
   */
  repeatCoveragePrev: number | null;
  /** 感度表を作るための素材。閾値で絞り直せる */
  repeatedPhraseLengths: number[];
  repeatComparedChars: number;
  /** 5. AI臭: 辞書ヒット。生の件数は長さに引きずられるので per1000 を併せて持つ */
  slop: SlopHits;
  slopPer1000: number;
  /** 6. エスカレーション: 感覚チャンネル数（0-5）。時系列の傾きは report 側で見る */
  sensoryChannels: number;
  /** 7. タグ漏れ / 構造の壊れ */
  hasTagLeak: boolean;
  isNotXml: boolean;
  hasUnparseableXml: boolean;
  /** 構造の欠け（action が短い / dialogue か inner が空）。空返信の一歩手前 */
  missingLayer: boolean;
};

const hasBrokenJapaneseText = (text: string): boolean =>
  NON_BMP_CJK.test(text) || [...text].some((char) => SIMPLIFIED_CHINESE_MARKERS.has(char));

/**
 * 1ターンを測る。prevRaws は**同じ会話**でこのターンより前の生本文（古い順）。
 * 会話をまたいだ本文を渡したら、反復軸は別の会話との一致を数えてまう。
 */
export const measureTurn = (turn: BenchTurn, prevRaws: string[]): TurnMeasurement => {
  const raw = turn.rawBody;
  const plainText = stripXmlTags(raw);
  const visibleChars = countUiVisibleChars(raw);
  const visibleCharsIndependent = countVisibleCharsIndependently(raw);
  const parsed = parseXmlResponse(raw);
  // 床は本番と同じ式で出す（phase × 宣言された responseLength）。
  // phase だけの手製テーブルを使っとった間、very_long の erotic を 300 字で測っとった
  // ＝ 本番の床 1312 の 1/4。「very_long は不足 0.0%」は物差しが緩かっただけやった。
  const minChars = turn.phase
    ? benchFloorFor(
        turn.phase,
        turn.config?.responseLength ?? null,
        turn.lastUserChars,
        turn.config?.lengthDirective ?? true,
      )
    : null;

  // 再掲を差し引いた実質字数を、差し引かん実質字数で割る。1.0 が無水増し。
  // 分母を素の可視文字数にしたら、句読点の多い本文の基準値が 0.82 まで落ちて
  // 条件をまたいだ比較でけへんかった（最初そう実装して axes.test.ts が落ちた）。
  const undeduplicated = countUndeduplicatedContentChars(plainText);
  const distinctRatio =
    undeduplicated > 0 ? countDistinctContentChars(plainText) / undeduplicated : null;
  // AI臭の正規化に使う分母は素の可視文字数のまま（辞書のヒットは本文の長さに比例する）。
  const plainLength = plainText.replace(/\s+/g, "").length;

  const slop = countSlopHits(plainText, turn.phase);
  const repeat = measureRepeat(raw, prevRaws);
  // 必須層（dialogue）が「無い / 空」なら層欠け、「開いたまま閉じてへん」なら構造の壊れ。
  // 中身は閉じタグまでを取り出して見る（`[\s\S]*?\S` で書いた時は
  // `<dialogue></dialogue>` の閉じタグの `<` が \S に当たって「中身がある」になっとった）。
  const dialogueOpened = /<dialogue\b[^>]*>/i.test(raw);
  const dialogueClosed = /<dialogue\b[^>]*>([\s\S]*?)<\/dialogue\s*>/i.exec(raw);
  // **中身を見る前に `<remember>` を落とす**（本番のパーサと同じ）。覚え書きだけの
  // `<dialogue>` は、パーサ側では空になってパース失敗になるのに、生のまま見ると
  // 「中身がある」ので層欠けにならず、**タグ構造破損として報告されとった**
  const dialogueContent = dialogueClosed?.[1].replace(REMEMBER_BLOCK, "") ?? null;
  const missingRequiredLayer =
    isXmlResponse(raw) &&
    parsed === null &&
    (!dialogueOpened || (dialogueContent !== null && dialogueContent.trim() === ""));
  const repeatPrev = measureRepeat(raw, prevRaws.slice(-1));
  // 判定でけるのは「画面に出た前のターンが在る」かつ「現ターンに8字以上の句が在る」時だけ。
  // どっちも無いのに false を返すと、**構造上ぜったい反復せんターン**が
  // 「反復してへん」証拠として分母に入る（vlong では turn1 の52件がそれ）
  const hasPriorReply = prevRaws.some(hasVisibleReply);
  const crossTurnMeasurable = hasPriorReply && repeat.comparedChars > 0;

  return {
    turn,
    plainText,
    visibleChars,
    visibleCharsHeaderDelta:
      turn.headerVisibleChars === null ? null : visibleChars - turn.headerVisibleChars,
    visibleCharsIndependent,
    visibleCharsCrossCheckDelta: visibleChars - visibleCharsIndependent,

    // **空返信は「画面に出せる中身が1文字も無い」。**本番の `hasReadableResponseContent` は
    // 外側の `<response>` が無い応答を素テキスト扱いするので、`<action></action>` を
    // 「中身あり」と答え、`countUiVisibleChars` はタグの17文字を数える。その形は
    // **不良の分母に残ったまま空返信にも数えられん**。読み込み側・生成側と同じ判定にする
    isEmpty: !hasVisibleReply(raw) || visibleChars === 0,
    // **本番は床の値で測る対象を変える。**quality-guard.ts:107 は
    // minChars >= 1300 の時だけ可視文字数で、それ未満では生の response.length で測る
    // （タグも <inner> も空白も込み）。可視文字数で揃えて測っとった間、
    // 実コーパスの58ターンで判定が本番と食い違っとった。
    // 不足は「応答が返ってきたのに床を割った」軸。**空返信は別の不良**なので
    // 二重に数えん。ただし `false`（＝床を満たした）にもせん — HTTP 200 で本文が
    // 空のターンは error が null で経路失敗にも入らんので、`summarize` の分母に
    // 残ったまま「不足やない」側へ数えられとった。分母から外すのが正しい
    isTooShort:
      minChars === null || !hasVisibleReply(raw) || visibleChars === 0
        ? null
        : (minChars >= 1300 ? visibleChars : raw.length) < minChars,
    hasBrokenJapanese: hasBrokenJapaneseText(plainText),
    distinctRatio,
    // **比べる相手が1文字も無いターンは「反復してへん」やのうて「測れてへん」。**
    // 1ターン目（履歴が空）や、前のターンが全部空やった時にここへ来る。false で
    // 数えとった間、vlong の分母へ turn1 の 52件が 0/52 として入って率を薄めとった
    // （`analyze.ts` の帰無側は最初から comparedChars === 0 を外しとって、
    // 同じコーパスで別の分母が2つ並んどった）
    // **近似重複は句の長さで門を作らん。**`findNearDuplicateMatch` は応答全体の n-gram で
    // 見るので、8字以上の句が1つも無い短い掛け合いでも判定でける。`comparedChars` で
    // 塞いどった間、**短い台詞の丸写し**が分母から消えとった
    isNearDuplicate: hasPriorReply ? findNearDuplicateMatch(raw, prevRaws).isDuplicate : null,
    repeatProduction: crossTurnMeasurable
      ? findCrossTurnRepetitionMatch(raw, prevRaws.at(-1), prevRaws).isDuplicate
      : null,
    repeatLayerAware: crossTurnMeasurable ? isRepeatFlagged(repeat) : null,
    // 被覆率も同じ。**比べる相手が居らんターンの 0 は「再掲が無かった」やない。**
    // `measureRepeat` は履歴が空でも現ターンの句を数えるので、ここを塞がんと
    // 1ターン目の 0 が median を押し下げる
    repeatCoverage:
      hasPriorReply && repeat.comparedChars > 0
        ? repeat.repeatedChars / repeat.comparedChars
        : null,
    repeatCoveragePrev:
      hasPriorReply && repeatPrev.comparedChars > 0
        ? repeatPrev.repeatedChars / repeatPrev.comparedChars
        : null,
    repeatedPhraseLengths: repeat.repeatedPhraseLengths,
    repeatComparedChars: repeat.comparedChars,
    slop,
    slopPer1000: plainLength > 0 ? (slop.total * 1000) / plainLength : 0,
    sensoryChannels: scoreSensualSpecificity(plainText),
    hasTagLeak: RAW_TAG_LEAK.test(plainText),
    // **本番の合格判定は wrapper を要る。**`checkXmlFormat` は `isXmlResponse` そのままで
    // （quality-guard.ts:705）、外れると `xml-format-missing` で弾かれる（同 1359）。
    // パーサと UI が層タグだけでも描けるのは**落ちた時の受け皿**であって、合格の境界やない。
    // 一度ここを「層タグがあれば非XMLやない」に緩めたが、それやと**本番が弾く不良を
    // 数え落とす**。文字数の数え方（countVisibleCharsIndependently）は本文の勘定なので
    // パーサ側の境界でよく、合否のこの軸とは別の話
    isNotXml: raw.trim().length > 0 && !isXmlResponse(raw),
    // タグの体はあるのにパースでけへん = 開始と終了の食い違い。quality-guard.ts:707 が
    // 「採用済み9,015件中10件」と記録しとる形。空返信の一歩手前で、原因が別。
    // parseXmlResponse は <dialogue> が無いと null を返す（xml-response-parser.ts:200）。
    // それを丸ごと「パース不能」に数えとった時は、タグが揃っとって層が1つ欠けただけの
    // 応答が、開始と終了が食い違う応答と同じ列に入っとった。**別の不良や。**
    // パースが通っても、開始と終了の数が合わんかったら本番は弾く（#1271 の二重 wrapper 含む）
    hasUnparseableXml:
      hasUnbalancedTags(raw) || (isXmlResponse(raw) && parsed === null && !missingRequiredLayer),
    missingLayer:
      raw.trim().length > 0 &&
      (missingRequiredLayer || (parsed !== null && !hasBothVisibleLayers(raw))),
  };
};

/**
 * 会話1本の識別子。corpus が配った scenario をそのまま使う。
 * run × character で切っとった時は、model-ab の 5試行 × 2モデルが1本に混ざっとった。
 */
export const scenarioKey = (turn: BenchTurn): string => turn.scenario;

/** 会話1本を測る。ターン順に並べてから前方の生本文を渡す */
/** 記録に穴が空いた後のターンで、ターン間の軸を「測れてへん」に倒す値 */
const unmeasuredCrossTurn = (): Pick<
  TurnMeasurement,
  | "isNearDuplicate"
  | "repeatProduction"
  | "repeatLayerAware"
  | "repeatCoverage"
  | "repeatCoveragePrev"
  | "repeatedPhraseLengths"
  | "repeatComparedChars"
> => ({
  isNearDuplicate: null,
  repeatProduction: null,
  repeatLayerAware: null,
  repeatCoverage: null,
  repeatCoveragePrev: null,
  repeatedPhraseLengths: [],
  repeatComparedChars: 0,
});

export const measureScenario = (turns: BenchTurn[]): TurnMeasurement[] => {
  const ordered = [...turns].sort((a, b) => a.turn - b.turn);
  const measurements: TurnMeasurement[] = [];
  const prevRaws: string[] = [];
  // **1ターン目が記録ごと落ちとる会話も穴が空いとる。**最初の記録が turn2 やと
  // `previousPosition` が null のままで穴と見なされず、turn3 が「完全な履歴」で
  // 測られとった（落ちた turn1 の本文は誰も知らんのに）
  let gapReached = ordered.length > 0 && ordered[0].turn !== 1;
  let previousPosition: number | null = null;
  for (const turn of ordered) {
    // **記録が抜けた後は、ターン間の軸を測らん。**読み込み側は壊れた記録を飛ばすので、
    // turn2 が落ちると turn3 が turn1 と並んで「前のターンとの反復」を測ることになる。
    // 実際には間に1ターン挟まっとるので、反復も近似重複も被覆率も**低い側へ偏る**
    const afterGap = previousPosition !== null && turn.turn > previousPosition + 1;
    if (afterGap) gapReached = true;
    const measurement = gapReached
      ? { ...measureTurn(turn, []), ...unmeasuredCrossTurn() }
      : measureTurn(turn, [...prevRaws]);
    previousPosition = turn.turn;
    measurements.push(measurement);
    // 応答が無かったターンも履歴へ積む。空の層は何とも一致せんので判定は動かんし、
    // 積まん形にすると「守っとるつもりで何もしてへんガード」になる（変異試験で
    // 消してもテストが1本も落ちんかった）。会話を切らんことの方が大事で、
    // エラーの次のターンは、その前のターンとの反復を今までどおり見る。
    prevRaws.push(turn.rawBody);
  }
  return measurements;
};

export const measureAll = (turns: BenchTurn[]): TurnMeasurement[] => {
  const byScenario = new Map<string, BenchTurn[]>();
  for (const turn of turns) {
    const key = scenarioKey(turn);
    const bucket = byScenario.get(key);
    if (bucket) bucket.push(turn);
    else byScenario.set(key, [turn]);
  }
  return [...byScenario.values()].flatMap(measureScenario);
};
