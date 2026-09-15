import { normalizeText } from "./normalize-text";

// 名前訂正の誤爆防止: ユーザーがキャラを別の名前で呼んだ時だけ「訂正リマインダーを出すべきか」を
// 返す（doc/dogfood handoff 2026-09-06「名前訂正の誤爆」）。誤検出すると、AIが訂正テンプレを
// 不要に返してしまう。直す症状は誤爆の方なので、迷う形は全部黙る側へ倒す。
//
// これは生成済みの応答を判定する他の check と違い、ユーザーの直前発言を見る側の関数。
//
// 判定は2段。両方通った時だけリマインダーを出す。
//   段1 呼び名の形をしとるか — 敬称が付く（つかさちゃん／つかさクン）、呼び捨て＋感嘆符
//        （つかさ！）、または呼び手が渡した既知の名前がそのまま出とる
//   段2 名前やと分かる根拠があるか — 既知の名前に一致するか、キャラ名・ユーザー名の
//        1文字違い（呼び間違い・打ち間違い）
//
// 段2 が要る理由（refute-r2 2026-09-14 #3）: 段1 だけやと「おっちゃん」「わんちゃん」
// 「看護師さん」「店長さん」「お疲れさま」「ごちそうさま」のような役割名・決まり文句が
// 全部呼び名として通ってまう。除外する語を並べる表では追いつかん——日本語の語彙は有限やない。
// round 1 で「仮名2〜4文字＋除外表」が破られたのと同じ構図なので、今度は「名前やと
// 分かっとるものだけ」に絞る。
// 代償: キャラ名にも既知の名前にも似とらん他人の名前で呼ばれた時は黙る。誤爆より軽い。

const NAME_CHAR = "[一-龠々ぁ-んァ-ヶーA-Za-z]";

// 名前の直後に付く敬称・呼称。片仮名書き（クン／サン／チャン）は正規化で平仮名へ畳まれる。
const HONORIFIC_PATTERN = new RegExp(
  `(${NAME_CHAR}{2,8})(?:ちゃん|くん|君|さん|さま|様|たん|先輩|先生)`,
  "u",
);
const HONORIFIC_SUFFIX_PATTERN = /(?:ちゃん|くん|君|さん|さま|様|たん|先輩|先生)$/u;

// 発言を「呼びかけが立ち得る単位」へ割る。ここで区切るので、候補が語の途中から
// 始まることはない（旧実装の「ちからつ」のような切れ端が原理的に出ん）。
const SEGMENT_DELIMITER_PATTERN = /[、,。．.！!？?…‥\s\u3000「」『』（）()]+/u;

const MIN_NAME_CHARS = 2;
const MAX_BARE_NAME_CHARS = 6;

// 呼び捨て＋感嘆符。感嘆符は区切り文字なので、区切りの直前に付いとるかを見る。
const BARE_NAME_WITH_BANG_PATTERN = new RegExp(
  `(?:^|[、,\\s\\u3000「])(${NAME_CHAR}{${MIN_NAME_CHARS},${MAX_BARE_NAME_CHARS}})[！!]`,
  "u",
);

export type NameIdentityOptions = {
  userName?: string;
  // キャラ名の別表記・読み（「桜庭さくら」に対する「さくら」「サクラ」等）。
  characterAliases?: readonly string[];
  // 他キャラ名など、呼び手が「これは名前や」と分かっとる語。
  knownNames?: readonly string[];
};

export type NameIdentityResult = {
  // 訂正リマインダーを出すべきか。呼び名の形と、名前やと分かる根拠が揃った時だけ true。
  shouldRemind: boolean;
  wrongName?: string;
};

const fold = (text: string): string => normalizeText(text, { punctuation: "keep" }).trim();

const ownNamesOf = (characterName: string, options: NameIdentityOptions): string[] =>
  [characterName, ...(options.characterAliases ?? []), options.userName ?? ""]
    .map(fold)
    .filter((name) => name.length > 0);

const isOwnName = (candidate: string, ownNames: readonly string[]): boolean =>
  ownNames.some((name) => name.includes(candidate) || candidate.includes(name));

// 1文字の違い（入れ替え・抜け・足し）だけなら同じ名前の呼び間違い。完全一致は間違いやない。
const isOneEditApart = (left: string, right: string): boolean => {
  if (left === right || Math.abs(left.length - right.length) > 1) return false;
  let leftIndex = 0;
  let rightIndex = 0;
  let edits = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    if (left[leftIndex] === right[rightIndex]) {
      leftIndex += 1;
      rightIndex += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (left.length >= right.length) leftIndex += 1;
    if (left.length <= right.length) rightIndex += 1;
  }
  return edits + (left.length - leftIndex) + (right.length - rightIndex) <= 1;
};

const splitSegments = (text: string): string[] =>
  text
    .split(SEGMENT_DELIMITER_PATTERN)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

const stripHonorific = (text: string): string => text.replace(HONORIFIC_SUFFIX_PATTERN, "");

// 段1: 呼び名の形をした候補を集める。
const namingFormCandidates = (foldedText: string): string[] => {
  const candidates = splitSegments(foldedText)
    .map((segment) => segment.match(HONORIFIC_PATTERN)?.[1])
    .filter((candidate): candidate is string => candidate !== undefined)
    .map(stripHonorific);
  const bareWithBang = foldedText.match(BARE_NAME_WITH_BANG_PATTERN)?.[1];
  if (bareWithBang !== undefined) candidates.push(bareWithBang);
  return candidates.filter((candidate) => candidate.length >= MIN_NAME_CHARS);
};

export const nameIdentityCheck = (
  userText: string,
  characterName: string,
  options: NameIdentityOptions = {},
): NameIdentityResult => {
  if (!userText.trim() || !characterName.trim()) return { shouldRemind: false };
  const foldedText = fold(userText);
  const ownNames = ownNamesOf(characterName, options);
  const knownNames = (options.knownNames ?? [])
    .map(fold)
    .filter((name) => name.length > 0 && !isOwnName(name, ownNames));

  // 既知の名前は呼び方の形を問わず名前として扱う。
  const knownInText = knownNames.find((name) => foldedText.includes(name));
  if (knownInText !== undefined) return { shouldRemind: true, wrongName: knownInText };

  // 段2: 既知の名前か、キャラ名・ユーザー名の1文字違いだけを名前と認める。
  const wrongName = namingFormCandidates(foldedText).find(
    (candidate) =>
      !isOwnName(candidate, ownNames) &&
      (knownNames.includes(candidate) || ownNames.some((name) => isOneEditApart(candidate, name))),
  );

  return wrongName === undefined ? { shouldRemind: false } : { shouldRemind: true, wrongName };
};
