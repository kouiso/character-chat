// 禁止語の活用形: forbidden_words の語がそのままの形で出とらんくても、活用させただけで
// 同じ語を言うとる（「気持ちいい」→「気持ちよかった」「気持ちよく」）症状を検出する。
// CI88実測(2026-09-06, Sakura-08): forbidden_words に「気持ちいい」「快感」を持つキャラの
// <inner>が「怖いくらいに気持ちいいのに」を出したが、これを機械的に落とす決定論チェックが
// 無かった。old arm の checkNoForbiddenWords（functions/api/lib/quality-guard.ts）は
// リテラル一致のみで、活用形は old / new とも未対応やった（doc/dogfood/handoff 2026-09-06 #5）。

import { normalizeText, normalizeWithSourceMap } from "./normalize-text";
import { normalizeSheetText } from "./sheet-text";

// キャラシートの forbidden_words: 行から禁止語リストを読む。register-check.ts と同じ行
// フォーマット（route-context.ts の buildSystemPrompt が書き出す）を対象にする。
const FORBIDDEN_WORDS_LINE_PATTERN = /^forbidden_words:\s*(.+)$/mu;

export const parseForbiddenWords = (systemPrompt: string | undefined): string[] => {
  if (!systemPrompt) return [];
  const match = normalizeSheetText(systemPrompt).match(FORBIDDEN_WORDS_LINE_PATTERN);
  if (!match) return [];
  return match[1]
    .split(/[、,]/u)
    .map((word) => word.trim())
    .filter((word) => word.length > 0);
};

// 「いい」で終わる語（気持ちいい 等）は「よい」語幹に不規則活用する。
// refute-evasion 2026-09-13 #1 で素通りした よすぎ／よかろう を含め、仮定形・過去形・
// 程度表現まで並べる。長い形から順に照合したいので、使う時に長さ降順へ並べ替える。
const IRREGULAR_II_SUFFIXES = [
  "いい",
  "よい",
  "よく",
  "よかった",
  "よかったら",
  "よかろう",
  "よくて",
  "よくない",
  "よければ",
  "よさ",
  "よすぎ",
  "よすぎて",
  "よすぎる",
];
// それ以外のい形容詞（例: 危ない、怖い）は規則活用させる。
const REGULAR_I_ADJECTIVE_SUFFIXES = [
  "い",
  "く",
  "くて",
  "かった",
  "かったら",
  "かろう",
  "くない",
  "ければ",
  "さ",
  "すぎ",
  "すぎて",
  "すぎる",
];

// 動詞の活用。五段はウ段の字で活用の行が決まるので、語尾の1字から機械的に出せる。
// 実データ由来（refute-r3 2026-09-14 の指摘）: 本番シートの禁止語に「焦る」があるのに、
// い形容詞しか活用させとらんかったので「焦って」「焦った」が素通りしとった。
const GODAN_SUFFIXES: Record<string, readonly string[]> = {
  う: ["わ", "い", "う", "え", "お", "って", "った", "んな"],
  く: ["か", "き", "く", "け", "こ", "いて", "いた", "んな"],
  ぐ: ["が", "ぎ", "ぐ", "げ", "ご", "いで", "いだ", "んな"],
  す: ["さ", "し", "す", "せ", "そ", "して", "した", "んな"],
  つ: ["た", "ち", "つ", "て", "と", "って", "った", "んな"],
  ぬ: ["な", "に", "ぬ", "ね", "の", "んで", "んだ", "んな"],
  ぶ: ["ば", "び", "ぶ", "べ", "ぼ", "んで", "んだ", "んな"],
  む: ["ま", "み", "む", "め", "も", "んで", "んだ", "んな"],
  る: ["ら", "り", "る", "れ", "ろ", "って", "った", "んな", "んない"],
};
// 一段動詞（感じる・食べる）は語幹がそのまま残る。五段か一段かはシートの字面からは
// 決めようが無いので、る で終わる語には両方を並べる。当たらん形が増えるだけで、
// 別の語を拾う方向へは効かん。
const ICHIDAN_SUFFIXES = ["", "て", "た", "ない", "ます", "れば", "よう", "られ", "させ"];

// 語幹1字だけの活用形（焦ら・焦れ）は、次に来る字で別の語になる。「焦らす」「焦らさないで」は
// 焦るやのうて焦らす、「焦れったい」は焦れったい——どれも官能描写でよう出る語なので、
// 禁止語「焦る」で落としたら誤検出になる（refute-r5 2026-09-14）。
// 未然形（ら・か・が…）の後ろのサ行と、仮定形（れ・け・げ…）の後ろの「っ」「る」を弾く。
// 活用形と、その形の直後に来たらあかん字。
export type WordForm = { text: string; rejectNext?: RegExp };

const IMPERFECTIVE_KANA = new Set(["ら", "か", "が", "さ", "た", "な", "ば", "ま", "わ"]);
const HYPOTHETICAL_KANA = new Set(["れ", "け", "げ", "せ", "て", "ね", "べ", "め", "え"]);

const rejectNextFor = (suffix: string): RegExp | undefined => {
  if (suffix.length !== 1) return undefined;
  if (IMPERFECTIVE_KANA.has(suffix)) return /[すさしせそ]/u;
  if (HYPOTHETICAL_KANA.has(suffix)) return /[っる]/u;
  return undefined;
};

const verbForms = (normalized: string, finalKana: string): WordForm[] | undefined => {
  const godan = GODAN_SUFFIXES[finalKana];
  if (godan === undefined || normalized.length < 2) return undefined;
  const last = finalKana;
  const godanStem = normalized.slice(0, -1);
  const forms: WordForm[] = godan.map((suffix) => ({
    text: `${godanStem}${suffix}`,
    rejectNext: rejectNextFor(suffix),
  }));
  if (last !== "る") return forms;
  // 一段の語幹は「る」を落とした形。語幹そのもの（空の suffix）は入れん——
  // 1字の語幹が別の語の一部に当たってまう。
  return [
    ...forms,
    ...ICHIDAN_SUFFIXES.filter(Boolean).map((suffix) => ({ text: `${godanStem}${suffix}` })),
  ];
};

// 短い形が長い形を食う（「気持ちよく」が「気持ちよくて」より先に当たる）と、証拠として
// 出す文字列が語の途中で切れる。長い順に見て最長一致を取る。
const byLengthDesc = (forms: WordForm[]): WordForm[] =>
  [...forms].sort((left, right) => right.text.length - left.text.length);

// 禁止語1つを、活用形も含めた「この語とみなす形」の一覧に展開する。い形容詞やない語
// （「快感」等の名詞）はそのままの1形だけを返す——名詞に活用を足すと無関係語まで拾う。
// 展開の前に正規化して、シート側が「気持ち良い」でも本文側が「きもちいい」でも同じ形に揃える。
// 活用させるかどうかは、シートに書かれた形の末尾で決める。読みへ畳んだ形で決めると
// 「僕」が「ぼく」になって く で終わる五段動詞に見え、ぼけ／ぼか／ぼこ を作ってまう——
// 「とぼけないで」「寝ぼけて」「でこぼこ」が僕の禁止で落ちる（refute-r4 2026-09-14 #4）。
// 仮名の書き分けだけは畳む（カワイイ の末尾 イ は い として読む）。
const finalKanaOfWord = (word: string): string =>
  normalizeText(word.slice(-1), { applyReadings: false });

const inflectedFormsOf = (normalized: string, finalKana: string): WordForm[] => {
  if (finalKana !== "い" && GODAN_SUFFIXES[finalKana] === undefined) return [{ text: normalized }];
  if (normalized.endsWith("いい")) {
    const stem = normalized.slice(0, -2);
    return IRREGULAR_II_SUFFIXES.map((suffix) => ({ text: `${stem}${suffix}` }));
  }
  if (finalKana === "い" && normalized.length >= 2) {
    const stem = normalized.slice(0, -1);
    return REGULAR_I_ADJECTIVE_SUFFIXES.map((suffix) => ({ text: `${stem}${suffix}` }));
  }
  // 複数語の言いつけ（「真面目に考えろ」「程々にしろ」）は、活用させる語幹がどれか
  // 決められん。書かれたままの形（正規化済み）だけで照合する。
  if (/[\s\u3000]/u.test(normalized)) return [{ text: normalized }];
  return verbForms(normalized, finalKana) ?? [{ text: normalized }];
};

// 禁止語1つを、活用形も含めた「この語とみなす形」の一覧に展開する。い形容詞やない語
// （「快感」等の名詞）はそのままの1形だけを返す——名詞に活用を足すと無関係語まで拾う。
// normalizeText は本文とシートの両方で漢字書きを読みへ畳むので、シートが「快感」でも
// 本文が「カイカン」「かいかん」なら同じ形に揃う（refute-r2 2026-09-14 #1）。読みを
// 引けん漢字が残る語は、書かれたままの形どうしで照合する。
const inflectedForms = (word: string): WordForm[] =>
  byLengthDesc(inflectedFormsOf(normalizeText(word), finalKanaOfWord(word)));

const DIALOGUE_TAG_PATTERN = /<dialogue>([\s\S]*?)<\/dialogue>/gu;
const INNER_TAG_PATTERN = /<inner>([\s\S]*?)<\/inner>/gu;
const TAG_PATTERN = /<[^>]+>/gu;

// <dialogue>/<inner>はキャラ本人の言葉・内心そのものなので対象にする。<action>は語り手の
// 地の文で、快感等の語を第三者視点の描写として使うのは別物なので対象外にする
// （no-injected-ai-filter.mdの「境界」——落とすのは品質保証であって表現そのものの禁止やない）。
// タグが1つも無い応答は全文を対象にする。地の文と台詞を分ける手がかりが無く、鉤括弧の
// 台詞はどのみち対象内なので、落とすと台詞の禁止語ごと見逃す側に倒れる
// （reaction-repetition-check.ts はタグ無しの時 鉤括弧を台詞として除外する。対象範囲が
// 逆向きなので、同じ入力でも扱いが反対になるのが正しい）。
const extractCharacterVoiceText = (response: string): string => {
  const isXmlResponse = /<action>|<dialogue>|<inner>/u.test(response);
  if (!isXmlResponse) return response.replace(TAG_PATTERN, "");
  const dialogue = [...response.matchAll(DIALOGUE_TAG_PATTERN)].map((match) => match[1]).join("\n");
  const inner = [...response.matchAll(INNER_TAG_PATTERN)].map((match) => match[1]).join("\n");
  return [dialogue, inner].filter((section) => section.length > 0).join("\n");
};

export type ForbiddenWordResult = {
  ok: boolean;
  // 実際にヒットした文字列（活用形かもしれん。元の禁止語は matchedWord）。
  matched?: string;
  matchedWord?: string;
};

// その形が出とる位置を探す。次に来る字で別語になる形は、その字を見て読み飛ばす。
const matchIndexOf = (text: string, form: WordForm): number => {
  let index = text.indexOf(form.text);
  while (index >= 0) {
    const next = text[index + form.text.length];
    if (form.rejectNext === undefined || next === undefined || !form.rejectNext.test(next)) {
      return index;
    }
    index = text.indexOf(form.text, index + 1);
  }
  return -1;
};

export const forbiddenWordCheck = (
  response: string,
  systemPrompt: string | undefined,
): ForbiddenWordResult => {
  const forbiddenWords = parseForbiddenWords(systemPrompt);
  if (forbiddenWords.length === 0) return { ok: true };
  const text = extractCharacterVoiceText(response);
  const normalized = normalizeWithSourceMap(text);
  for (const word of forbiddenWords) {
    for (const form of inflectedForms(word)) {
      const index = matchIndexOf(normalized.text, form);
      if (index < 0) continue;
      // 証拠は正規化後やのうて元の表記で返す（「気持ち…いい」をそのまま見せる）。
      const matched = text.slice(
        normalized.sourceStart[index],
        normalized.sourceEnd[index + form.text.length - 1],
      );
      return { ok: false, matched, matchedWord: word };
    }
  }
  return { ok: true };
};
