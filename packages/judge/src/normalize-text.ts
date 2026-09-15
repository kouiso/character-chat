// 表記ゆれの吸収。同じ語を片仮名・平仮名・半角カナ・小書き仮名・漢字で書き分けたり、
// 目に見えん制御文字を挟んだりするだけで検出をすり抜ける症状を潰すための前処理。
// judge の全 check はここを唯一の入口にする。
//
// 処理の順番が効く（refute-r2 2026-09-14 #1: 変換表を生テキストへ先に当てとったので
// 「気モチいい」「気持チいい」が素通りした）。必ずこの順に畳む:
//   1. 半角カナ（濁点・半濁点の合成を含む）→ 全角カナ → 平仮名、小書き仮名 → 大書き
//   2. 目に見えん制御文字（ZWSP 等）と、語の途中へ挟む記号を落とす
//   3. そのあとで初めて漢字⇔仮名の対応表を当てる
// 1 を先に済ませるので、対応表は「漢字を含む形」だけを持てばよい。
//
// ここで扱うのは「同じ語の別の書き方」だけで、語彙は一切増やさん。禁止語はキャラシートの
// forbidden_words 行からしか来ん（prompt/instructions/no-injected-ai-filter.md）ので、
// READING_VARIANTS に語を足してもシートに無い語は落ちんまま。表の役目は、シートに載っとる
// 語の読みを引けるようにすること——シートが権威で、こっちはその語の読み方を知っとるだけ。

const KATAKANA_FIRST = 0x30a1; // ァ
const KATAKANA_LAST = 0x30f6; // ヶ
const KATAKANA_TO_HIRAGANA_OFFSET = 0x60;

const HALFWIDTH_KANA_FIRST = 0xff61; // ｡
const HALFWIDTH_KANA_LAST = 0xff9f; // ﾟ
// U+FF61（｡）から U+FF9F（ﾟ）までの並びと1対1で対応する全角表記。
const FULLWIDTH_KANA =
  "。「」、・ヲァィゥェォャュョッーアイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワン゛゜";
const VOICED_MARK = "゙";
const SEMI_VOICED_MARK = "゚";

// 目に見えん文字（ゼロ幅スペース・結合子・異体字セレクタ等）は語の途中へ挟んでも
// 見た目が変わらん。検出をずらすためだけに使えるので必ず落とす。
// 文字クラスに並べると異体字セレクタが隣の文字と組んで見えるので、選言で書く。
const INVISIBLE_CHAR_PATTERN = /\u00AD|[\u200B-\u200F]|[\u2060-\u2064]|[\uFE00-\uFE0F]|\uFEFF/u;

// 小書き仮名は母音の引き伸ばし表記（気持ちぃぃ）で使われるだけで語が変わらんので、
// 大書きへ寄せる。っ／ゃゅょ は語そのものを変えるので触らん。
const SMALL_VOWEL_KANA: Record<string, string> = {
  ぁ: "あ",
  ぃ: "い",
  ぅ: "う",
  ぇ: "え",
  ぉ: "お",
};

// 語の途中へ挟んで検出をずらす記号（気持ち…いい）を落とす。句点・感嘆符・疑問符は
// 文の切れ目なので残す——落とすと隣の文と繋がって別語を作ってまう。
// 長音符（ー）は語の一部（パーカー等）なので落とさん。
const DROPPED_PUNCTUATION_PATTERN = /[\s\u3000…‥・、，,〜～]/u;

// 漢字を含む書き方と、その読み。1 と 2 を済ませた後のテキストへ当てるので、平仮名側の
// 揺れ（片仮名・半角）はもう畳まれとる。長い方を先に置く。
// 実データ由来: 190 シートの forbidden_words に出る語を全て仮名へ引けるだけ持つ
// （script/bench/forbidden-word-reading.test.ts が網羅を固定しとる）。
// 語の単位だけやのうて字の単位でも持つ。「気モチいい」のように語の途中だけ仮名で書かれると
// 語の単位の項目は当たらんので、長い項目から順に見て、当たらん残りを字の単位で引く
// （refute-r2 2026-09-14 #1 の実測）。
const READING_VARIANTS: readonly (readonly [string, string])[] = [
  ["気持ち", "きもち"],
  ["大好き", "だいすき"],
  ["拙者", "せっしゃ"],
  ["普通", "ふつう"],
  ["頑張", "がんば"],
  ["快感", "かいかん"],
  ["感じ", "かんじ"],
  ["持ち", "もち"],
  ["好き", "すき"],
  ["お前", "おまえ"],
  ["気", "き"],
  ["快", "かい"],
  ["感", "かん"],
  ["僕", "ぼく"],
  ["俺", "おれ"],
  ["私", "わたし"],
  ["良", "よ"],
];

const toHiragana = (char: string): string => {
  const code = char.codePointAt(0) ?? 0;
  if (code >= KATAKANA_FIRST && code <= KATAKANA_LAST) {
    return String.fromCodePoint(code - KATAKANA_TO_HIRAGANA_OFFSET);
  }
  return char;
};

const halfWidthToFullWidth = (char: string): string | undefined => {
  const code = char.codePointAt(0) ?? 0;
  if (code < HALFWIDTH_KANA_FIRST || code > HALFWIDTH_KANA_LAST) return undefined;
  return FULLWIDTH_KANA[code - HALFWIDTH_KANA_FIRST];
};

export type NormalizedText = {
  text: string;
  // text[i] が元テキストのどの範囲から来たか。ヒット箇所を元の表記のまま証拠として
  // 切り出すために持つ（「気持ち…いい」を「きもちいい」やのうてそのまま報告する）。
  sourceStart: number[];
  sourceEnd: number[];
};

// 語の途中の記号の扱い。
//  drop      … 消す。禁止語の照合用（「気持ち…いい」を1語として見る）。
//  separator … 見えん区切り文字へ置き換える。語と語がくっついて、元は無かった熟語を
//              作ってまうのを防ぐ（refute-r3 2026-09-14 #2: 「手、熱い」が「手熱い」に
//              なって、熱が熟語の一部と判定され数えられんかった）。
//  keep      … そのまま残す。読点を呼びかけの区切りとして読む name-identity 用。
export type PunctuationHandling = "drop" | "separator" | "keep";

// 語の中には出て来ん文字を区切りに使う。判定パターンはこの文字に当たらんので、
// 「隣り合っとらん」ことだけが伝わる。
export const WORD_SEPARATOR = "\u0000";

export type NormalizeOptions = {
  punctuation?: PunctuationHandling;
  // 漢字の読み（快感→かいかん）を当てるか。禁止語の照合では要るが、語幹の数え上げでは
  // 邪魔になる——「熱気」の気が「き」へ化けると、熟語やのうて感覚語の「熱」に見える
  // （refute-r3 2026-09-14 #2 の順序の穴）。
  applyReadings?: boolean;
};

type Folded = { chars: string[]; start: number[]; end: number[] };

const pushChar = (folded: Folded, char: string, start: number, length: number): void => {
  folded.chars.push(char);
  folded.start.push(start);
  folded.end.push(start + length);
};

// 見えん文字は常に消す。記号の扱いだけが呼び手ごとに変わる。
const foldedCharFor = (char: string, options: NormalizeOptions): string | undefined => {
  if (INVISIBLE_CHAR_PATTERN.test(char)) return undefined;
  if (!DROPPED_PUNCTUATION_PATTERN.test(char)) return SMALL_VOWEL_KANA[char] ?? toHiragana(char);
  const handling = options.punctuation ?? "drop";
  if (handling === "drop") return undefined;
  if (handling === "separator") return WORD_SEPARATOR;
  return char;
};

// 半角カナの濁点・半濁点は次の1文字として並ぶ。合成でけたら2文字を1文字として畳む。
const composeHalfWidthKana = (
  input: string,
  cursor: number,
  fullWidth: string,
): { char: string; consumed: number } => {
  const mark = input[cursor + 1];
  const combining = mark === "ﾞ" ? VOICED_MARK : mark === "ﾟ" ? SEMI_VOICED_MARK : undefined;
  if (combining === undefined) return { char: toHiragana(fullWidth), consumed: 1 };
  const composed = (fullWidth + combining).normalize("NFC");
  return composed.length === 1
    ? { char: toHiragana(composed), consumed: 2 }
    : { char: toHiragana(fullWidth), consumed: 1 };
};

// 段階1+2: 仮名の畳み込みと、見えん文字・記号の除去。
const foldScript = (input: string, options: NormalizeOptions): Folded => {
  const folded: Folded = { chars: [], start: [], end: [] };
  let cursor = 0;
  while (cursor < input.length) {
    const char = input[cursor];
    const fullWidth = halfWidthToFullWidth(char);
    if (fullWidth !== undefined) {
      const composed = composeHalfWidthKana(input, cursor, fullWidth);
      pushChar(folded, composed.char, cursor, composed.consumed);
      cursor += composed.consumed;
      continue;
    }
    const foldedChar = foldedCharFor(char, options);
    if (foldedChar !== undefined) pushChar(folded, foldedChar, cursor, 1);
    cursor += 1;
  }
  return folded;
};

// 段階3: 畳んだテキストへ読みの対応表を当てる。source map は段階1の対応を引き継ぐ。
export const normalizeWithSourceMap = (
  input: string,
  options: NormalizeOptions = {},
): NormalizedText => {
  const folded = foldScript(input, options);
  const foldedText = folded.chars.join("");
  if (options.applyReadings === false) {
    return { text: foldedText, sourceStart: folded.start, sourceEnd: folded.end };
  }
  const chars: string[] = [];
  const sourceStart: number[] = [];
  const sourceEnd: number[] = [];
  let cursor = 0;

  while (cursor < foldedText.length) {
    const variant = READING_VARIANTS.find(([written]) => foldedText.startsWith(written, cursor));
    if (variant) {
      const [written, reading] = variant;
      for (const char of reading) {
        chars.push(char);
        sourceStart.push(folded.start[cursor]);
        sourceEnd.push(folded.end[cursor + written.length - 1]);
      }
      cursor += written.length;
      continue;
    }
    chars.push(foldedText[cursor]);
    sourceStart.push(folded.start[cursor]);
    sourceEnd.push(folded.end[cursor]);
    cursor += 1;
  }

  return { text: chars.join(""), sourceStart, sourceEnd };
};

export const normalizeText = (input: string, options: NormalizeOptions = {}): string =>
  normalizeWithSourceMap(input, options).text;

const KANJI_PATTERN = /[一-龠々]/u;

// シートの語の読み。表で全ての漢字を引けた時だけ仮名の読みを返す。引けん漢字が残る語は
// 読みを作らん——当て推量の読みで照合すると、別の語を落とす方向の間違いになる。
export const kanaReading = (word: string): string | undefined => {
  const normalized = normalizeText(word);
  return KANJI_PATTERN.test(normalized) ? undefined : normalized;
};
