// RIT-91: 未成年を思わせるキャラの保存を拒否する語検査。
// プロンプトの注意書きは既にあるが、保存経路での機械的な止めが無かった。
// 言い換え・英語・ひらがな表記も対象にし、止まらん語が見つかったらこの一覧へ足す。

// 年齢の数値直撃（17歳・16才・15-year-old・age 14・十四歳 など）
const UNDERAGE_NUMBER_PATTERNS: RegExp[] = [
  // 直前が数字の時は拾わん（18歳の中の 8歳・25歳の中の 5歳 を誤爆せんため）
  /(?<!\d)(?:1[0-7]|0?\d)\s*(?:歳|才|歳児|才児|[\s-]*years?[\s-]*old|y\.?o\.?)/i,
  /(?:age|年齢|さい)\s*[:=：]?\s*(?:1[0-7]|0?\d)\b/i,
  /十[一七三二五六四]\s*[才歳]/,
  /1[0-7]\s*さい/i,
  // 高1・高２・高校3年・中学2年・中1年 など学年直撃
  /[中高]\s*[学校]?\s*[1-3一三二１-３]\s*年/,
];

// 未成年を直接指す語（日本語・ひらがな・英語・略称を同じ枠で扱う）
const MINOR_WORDS: readonly string[] = [
  "未成年",
  "未成人",
  "みせいねん",
  "高校生",
  "こうこうせい",
  "女子高生",
  "男子高生",
  "女高生",
  "じょしこうせい",
  "中学生",
  "ちゅうがくせい",
  "小学生",
  "しょうがくせい",
  "生徒",
  "幼女",
  "ようじょ",
  "幼児",
  "ようじ",
  "ろり",
  "ロリ",
  "ロリータ",
  "ショタ",
  "しょた",
];

// 英語は部分一致だと mineral/minority に誤爆するので語境界つきで見る。
const MINOR_WORD_EN_PATTERN =
  /\b(?:underage|minor|schoolgirl|schoolboy|high\s*school|highschool|middle\s*school|elementary\s*school|pre[\s-]*teen|jailbait|loli|lolita|shota)\b/i;

// JK/JC/JS は素の英字2文字なので語境界つきで見る（ojk のような変形も防がない）
const MINOR_INITIALISM_PATTERN = /\b(jk|jc|js)\b/i;

const SCHOOL_UNIFORM_WITH_MINOR = /(?:jk|jc|js)\s*(?:制服|コス|服)/i;

// 高1・高２など学年直撃（半角・全角どちらも。「高校3年」は上のパターンが拾う）
const SCHOOL_GRADE_PATTERN = /高\s*[1-3１-３]/;

export type MinorViolation = { matched: string };

// 文字列群を走査して最初に見つかった未成年を思わせる表現を返す。無ければ null。
export const findMinorViolation = (
  texts: readonly (string | null | undefined)[],
): MinorViolation | null => {
  const haystack = texts
    .filter((t): t is string => typeof t === "string" && t.length > 0)
    .join("\n");
  if (!haystack) return null;
  for (const pattern of UNDERAGE_NUMBER_PATTERNS) {
    const hit = haystack.match(pattern);
    if (hit?.[0]) return { matched: hit[0] };
  }
  for (const word of MINOR_WORDS) {
    if (haystack.toLowerCase().includes(word.toLowerCase())) return { matched: word };
  }
  for (const pattern of [
    MINOR_WORD_EN_PATTERN,
    MINOR_INITIALISM_PATTERN,
    SCHOOL_UNIFORM_WITH_MINOR,
    SCHOOL_GRADE_PATTERN,
  ]) {
    const hit = haystack.match(pattern);
    if (hit?.[0]) return { matched: hit[0] };
  }
  return null;
};

export const minorViolationReason = (violation: MinorViolation): string =>
  `未成年を思わせる表現「${violation.matched}」が含まれているため保存できません`;
