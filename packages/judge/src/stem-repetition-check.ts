import { normalizeText } from "./normalize-text";

// 同じ感覚語の語幹・小道具語をターン内で叩きすぎる連投を検出する。
// CI85実測: 「熱い/熱く」が地の文3回・台詞2回の計5回出たが、reaction-repetition-check は
// 部位×反応クラスの組で数えるため部位（子宮の奥／お腹の奥／目頭）が毎回違うと閾値に届かず
// 素通りした。部位を問わず、固定の感覚語彙そのものが地の文+台詞で閾値回数以上出たら不合格にする。
//
// 対象範囲の線引き（reaction-repetition-check.ts と対で読むこと）: こっちは <dialogue> を
// 含める。9/06 に観測した症状は地の文の反復やったが、同じ語幹を台詞で叩き続けるのも同じ病気で、
// 閾値5/4は台詞込みで数えても喘ぎの反復を落とさん広さがある。部位×反応クラスを3回で落とす
// 狭い判定の方だけが地の文に閉じとる。
//
// 閾値は 5/4 のまま動かさん。ここは「連投の検出」であって語の禁止やないという線引きが
// 閾値そのものなので（refute-filter 2026-09-13 carry-forward 2）、下げたら
// prompt/instructions/no-injected-ai-filter.md NEVER #2 の禁止語リストになってまう。
//
// 判定は normalizeText 後のテキストに対して行う。片仮名は平仮名化済みなので、パターンは
// 漢字書きと平仮名書きだけを並べる（refute-evasion 2026-09-13 #2: 仮名で書き直すと
// カウンタがリセットされとった）。

type StemPattern = {
  // 報告に出す語幹の代表表記。
  readonly stem: string;
  readonly pattern: RegExp;
};

const SENSATION_STEM_THRESHOLD = 5;
const SENSATION_STEMS: readonly StemPattern[] = [
  // 「熱」は熟語（情熱・熱心・加熱・熱中）になると感覚やのうて概念の語になる。前後どちらかが
  // 漢字の形は数えん（refute-r2 2026-09-14 #2 の誤検出。誤検出は見逃しより bench の計測を
  // 汚す）。「熱い」「熱く」「熱を帯び」「熱がこもる」は仮名が続くので残る。
  { stem: "熱", pattern: /(?<![一-龠々])熱(?![一-龠々])|あつ(?=い|く|か|さ|す)/gu },
  { stem: "濡れ", pattern: /濡れ|ぬれ/gu },
  { stem: "震え", pattern: /震え|ふるえ/gu },
  { stem: "痺れ", pattern: /痺れ|しびれ/gu },
  // 「締ま」に仮名の別表記は足さん。「しまう」「しまった」と衝突して、閉じる意味やない
  // 文まで数えてまう。
  { stem: "締ま", pattern: /締ま/gu },
  // 「うずくまる」は疼きやないので外す。
  { stem: "疼", pattern: /疼|うずく(?!ま)|うずき|うずい/gu },
  { stem: "痙攣", pattern: /痙攣|けいれん/gu },
  { stem: "溢れ", pattern: /溢れ|あふれ/gu },
  // 蕩け・溶け・とろけ は同じ語の書き分けなので、1つのカウンタへ合流させる
  // （refute-evasion 2026-09-13 #2: 別カウンタやと交互に書いて閾値を割れた）。
  { stem: "とろけ", pattern: /蕩け|溶け|とろけ/gu },
  { stem: "甘", pattern: /甘|あま(?=い|く|さ|え|っ)/gu },
  { stem: "痛", pattern: /痛|いた(?=い|く|み|さ|む)/gu },
];

// CI90-2実測(Sakura-10 afterglow): 「額に浮かんだ汗」「髪の毛が汗で張り付き」「背中がすっと
// 汗ばんでいる」「自分の汗とあなたの体温が」の4段落全てが汗を軸にしとるが、感覚語の閾値5には
// 届かん。小道具（背景を彩る語）は感覚語より狭い閾値4を別立てで持つ。
const PROP_STEM_THRESHOLD = 4;
const PROP_STEMS: readonly StemPattern[] = [
  // 「あせる（焦る）」「あせって（焦って）」を除くため、ら行と促音が続く形は数えん
  // （refute-r2 2026-09-14 #2: あせって が汗として数えられとった）。
  { stem: "汗", pattern: /汗|あせ(?![らりるれろっ])/gu },
  { stem: "髪飾り", pattern: /髪飾り|かみかざり/gu },
  { stem: "ピアス", pattern: /ぴあす/gu },
  { stem: "チョーカー", pattern: /ちょーかー/gu },
  { stem: "パーカー", pattern: /ぱーかー/gu },
];

const TAG_PATTERN = /<[^>]+>/gu;
const stripTags = (text: string): string => text.replace(TAG_PATTERN, "");

const countMatches = (text: string, pattern: RegExp): number => text.match(pattern)?.length ?? 0;

export type StemRepetitionResult = {
  ok: boolean;
  category?: "sensation" | "prop";
  // 閾値に達した語幹そのもの（例: "熱", "汗"）。
  stem?: string;
};

export const stemRepetitionCheck = (text: string): StemRepetitionResult => {
  // 記号は消さずに区切りへ置き換え、漢字の読みは当てん。消すと「手、熱い」が「手熱い」に
  // なって熟語のガードに引っかかり、読みを当てると「熱気」が「熱き」になってガードを
  // すり抜ける（refute-r3 2026-09-14 #2 の実測）。
  const plainText = normalizeText(stripTags(text), {
    punctuation: "separator",
    applyReadings: false,
  });
  for (const { stem, pattern } of SENSATION_STEMS) {
    if (countMatches(plainText, pattern) >= SENSATION_STEM_THRESHOLD) {
      return { ok: false, category: "sensation", stem };
    }
  }
  for (const { stem, pattern } of PROP_STEMS) {
    if (countMatches(plainText, pattern) >= PROP_STEM_THRESHOLD) {
      return { ok: false, category: "prop", stem };
    }
  }
  return { ok: true };
};
