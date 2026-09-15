export type Voice = {
  firstPerson: string[];
  secondPerson: string[];
  endings: string[];
  // シートの口癖（verbal_tics / 口癖）。judge では使わず、prompt が出力契約に載せる。
  tics: string[];
};

const LIST_SEPARATOR = /[,/、，]/;

const stripQuotes = (value: string): string =>
  value
    .trim()
    .replace(/^["'「『]+/, "")
    .replace(/["'」』]+$/, "");

const splitListValue = (value: string): string[] =>
  value
    .split(LIST_SEPARATOR)
    .map(stripQuotes)
    .filter((item) => item.length > 0);

// "一人称: わたし" / "first_person: わたし" の形（コロン記法、ハイフン・アンダースコア両対応）。
const extractLabeledColon = (sheet: string, key: string): string[] => {
  const pattern = new RegExp(`${key}\\s*[:：]\\s*(.+)`, "i");
  const match = pattern.exec(sheet);
  return match ? splitListValue(match[1]) : [];
};

// 実シートの地の文はコロンを使わん: "一人称は「わたし」" / "一人称「わたし」" / 隣接する
// 複数の「」（"呼び方は「お前」「名前呼び」" 等）。は・が は無いこともあるので任意にする。
const extractLabeledQuotes = (sheet: string, key: string): string[] => {
  const pattern = new RegExp(`${key}(?:は|が)?((?:\\s*[「『][^」』]*[」』])+)`, "i");
  const match = pattern.exec(sheet);
  if (!match) return [];
  const quotes = [...match[1].matchAll(/[「『]([^」』]+)[」』]/g)].map((quote) => quote[1]);
  return quotes.flatMap(splitListValue);
};

// シートの表記ゆれ（コロン記法／地の文の「」記法、日本語ラベル・英語ラベルどちらでも）を拾う。
const extractListField = (sheet: string, keys: string[]): string[] => {
  for (const key of keys) {
    const colonValues = extractLabeledColon(sheet, key);
    if (colonValues.length > 0) return colonValues;
    const quoteValues = extractLabeledQuotes(sheet, key);
    if (quoteValues.length > 0) return quoteValues;
  }
  return [];
};

// ローカル D1 の char-koharu-ex 等は行区切りが実改行やのうて 2 文字の "\\n"（バックスラッシュ + n）で
// 入っとる。そのままやとコロン記法の値 "(.+)" がシートの残り全部を拾い、forbidden_words の
// 「僕」まで一人称に混ざって判定から除かれる（2026-09-04 v2 arm、Sakura t6 の 43,204 字が
// 「僕」視点なのに voice ok）。行区切りとして扱うために実改行へ戻す。
const ESCAPED_NEWLINE = /\\n/g;

export const extractVoice = (rawSheet: string): Voice => {
  const sheet = rawSheet.replace(ESCAPED_NEWLINE, "\n");
  // "first-person" と "first_person"（アンダースコア表記のキャラカード）両方拾う。
  const firstPerson = extractListField(sheet, ["first[-_]person", "一人称"]);
  const secondPerson = extractListField(sheet, ["address", "二人称", "呼び方"]);
  const endingsFromLabel = extractListField(sheet, ["speech_endings", "語尾"]);
  // ラベルが無いシートでは「」列挙を語尾の手がかりとして使う（judge_chunk はこれで warn 判定する側の想定）
  const endings =
    endingsFromLabel.length > 0
      ? endingsFromLabel
      : [...sheet.matchAll(/「([^」]+)」/g)].map((match) => match[1]);
  const tics = extractListField(sheet, ["verbal_tics", "口癖"]);
  return { firstPerson, secondPerson, endings, tics };
};

export type VoiceResult = {
  ok: boolean;
  forbiddenPronoun?: string;
  forbiddenAddress?: string;
  // ナレーション（<dialogue> 以外）が自分の名前を三人称の主語にしとる（「さくらは微笑んだ」）。
  thirdPersonSelf?: string;
  endingsMismatch?: boolean;
};

// 自分の名前が主語・所有として出る形。2026-09-05 v2 arm（CI 33938927486）の Sakura は全ターン
// 「さくらは…」「さくらの胸が…」の小説調で、視点が本人から外れた。名前だけの出現（相手が名前を
// 呼ぶ台詞の引用など）は拾わんよう、格助詞つきに限る。
const SELF_SUBJECT_PARTICLES = ["は", "が", "の", "を", "に"];

// 「桜庭 さくら」のような姓名は分けて、どちらの呼び方でも拾う。1 字の名（「鈴」）は「鈴の音」のような
// 普通名詞と区別がつかんので対象外にする。
const MIN_SELF_NAME_LENGTH = 2;

const findThirdPersonSelf = (
  narration: string,
  selfName: string | undefined,
): string | undefined => {
  if (!selfName) return undefined;
  const names = selfName.split(/\s+/).filter((part) => part.length >= MIN_SELF_NAME_LENGTH);
  for (const name of names) {
    for (const particle of SELF_SUBJECT_PARTICLES) {
      const form = `${name}${particle}`;
      if (narration.includes(form)) return form;
    }
  }
  return undefined;
};

// シートに無い一人称のバリエーション。シート側の一人称と重なるものは判定から除く。
const FIRST_PERSON_PRONOUNS = ["私", "わたし", "あたし", "俺", "僕", "うち", "自分", "余", "拙者"];

// シートに無い二人称のバリエーション。シート側の二人称と重なるものは判定から除く。
const SECOND_PERSON_PRONOUNS = ["あなた", "貴方", "貴女", "あんた", "きみ", "君", "お前", "そちら"];

const DIALOGUE_PATTERN = /<dialogue>([\S\s]*?)<\/dialogue>/g;

const stripDialogue = (text: string): string => text.replace(DIALOGUE_PATTERN, "");

const extractDialogue = (text: string): string =>
  [...text.matchAll(DIALOGUE_PATTERN)].map((match) => match[1]).join("\n");

// 語尾の「〜」を外して素の語尾だけにする（"〜だわ" → "だわ"）。dialogue 側は「〜」を付けん。
const bareEnding = (ending: string): string => ending.replace(/^[~〜]/, "").trim();

// endings は warning 用（judgeChunk では reasons に入れず、ok を落とさん）。判定材料が無い
// （dialogue 無し／シートに speech_endings 指定無し）時は undefined を返し、既存の
// `toEqual({ ok: true })` 形式のテスト（endings 未指定シート）を壊さんようにする。
const hasEndingsMismatch = (dialogue: string, endings: string[]): boolean | undefined => {
  if (dialogue.length === 0 || endings.length === 0) return undefined;
  return !endings.some((ending) => dialogue.includes(bareEnding(ending)));
};

// voice の判定対象:
// - 一人称: <inner> とタグ外のナレーション（<action> を含む）。<dialogue> は場面や相手によって
//   呼び方を変えることがあるため対象外。
// - 二人称: 逆に <dialogue> こそが相手を呼ぶ場面なので、そこだけ見る。
// - 語尾: <dialogue> の中身を、シートの speech_endings と突き合わせる（warning のみ）。
const findForbiddenPronoun = (narration: string, voice: Voice): string | undefined => {
  if (voice.firstPerson.length === 0) return undefined;
  return FIRST_PERSON_PRONOUNS.find(
    (pronoun) => !voice.firstPerson.includes(pronoun) && narration.includes(pronoun),
  );
};

const findForbiddenAddress = (dialogue: string, voice: Voice): string | undefined => {
  if (voice.secondPerson.length === 0) return undefined;
  return SECOND_PERSON_PRONOUNS.find(
    (pronoun) => !voice.secondPerson.includes(pronoun) && dialogue.includes(pronoun),
  );
};

export const voiceCheck = (text: string, voice: Voice, selfName?: string): VoiceResult => {
  const narration = stripDialogue(text);
  const dialogue = extractDialogue(text);
  const forbiddenPronoun = findForbiddenPronoun(narration, voice);
  const forbiddenAddress = findForbiddenAddress(dialogue, voice);
  const thirdPersonSelf = findThirdPersonSelf(narration, selfName);
  const endingsMismatch = hasEndingsMismatch(dialogue, voice.endings);

  return {
    ok: !forbiddenPronoun && !forbiddenAddress && !thirdPersonSelf,
    forbiddenPronoun,
    forbiddenAddress,
    thirdPersonSelf,
    endingsMismatch,
  };
};
