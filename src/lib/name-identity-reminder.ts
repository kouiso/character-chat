// 最後のユーザー発言から、現在のキャラ名ではない呼び名を検出し、
// 訂正を促す動的 system リマインダーを生成する。

export const NAME_IDENTITY_REMINDER = (wrongName: string, characterName: string): string =>
  `【名前訂正リマインダー】\nユーザーはあなたを「${wrongName}」と呼びました。` +
  `あなたの名前は「${characterName}」です。\n` +
  `<dialogue>でまず「……${wrongName}？ 私は${characterName}だけど。」` +
  `と訂正してから、ユーザーの要求に自然に応えてください。` +
  `訂正をスキップしないでください。`;

const KANA_NAME_PATTERN = "[ぁ-んー]{2,4}|[ァ-ヶー]{2,4}";
const KANJI_NAME_PATTERN = "[一-龠々]{1,4}";
const ENGLISH_NAME_PATTERN = "[A-Za-z][A-Za-z0-9_]*(?:\\s+[A-Za-z][A-Za-z0-9_]*)*";

const ANY_NAME_PATTERN = `(?:${ENGLISH_NAME_PATTERN}|${KANA_NAME_PATTERN}|${KANJI_NAME_PATTERN})`;

const COMMON_NON_NAME_WORDS = new Set([
  "今日",
  "明日",
  "昨日",
  "今",
  "ここ",
  "そこ",
  "あそこ",
  "これ",
  "それ",
  "あれ",
  "私",
  "わたし",
  "あたし",
  "僕",
  "ぼく",
  "ボク",
  "俺",
  "おれ",
  "オレ",
  "自分",
  "俺様",
  "お前",
  "おまえ",
  "オマエ",
  "あんた",
  "君",
  "きみ",
  "キミ",
  "彼",
  "彼女",
  "みんな",
  "皆",
  "誰か",
  "なんか",
  "何",
  "どう",
  "でも",
  "だけど",
  "だって",
  "だから",
  "なので",
  "です",
  "ます",
  "する",
  "ある",
  "いる",
  "なる",
  "いい",
  "だめ",
  "ダメ",
  "やだ",
  "いや",
  "嫌",
  "ほしい",
  "好き",
  "嫌い",
  "ありがと",
  "ありがとう",
  "こんにちは",
  "こんばんは",
  "おはよう",
  "さようなら",
  "また",
  "ね",
  "よ",
  "わ",
  "ぜ",
  "さ",
  "i",
  "you",
  "we",
  "he",
  "she",
  "it",
  "they",
  "my",
  "your",
  "his",
  "her",
  "our",
  "their",
  "this",
  "that",
  "these",
  "those",
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "so",
  "because",
  "if",
  "when",
  "where",
  "how",
  "what",
  "who",
  "why",
  "today",
  "tomorrow",
  "yesterday",
  "now",
  "here",
  "there",
  "yes",
  "no",
  "hi",
  "hello",
  "hey",
  "love",
  "like",
  "want",
  "please",
  "thanks",
  "sorry",
  "good",
  "bad",
  "ok",
  "okay",
  "あー",
  "えー",
  "うーん",
  "ううん",
  "はー",
  "はあ",
  "ふーん",
  "へー",
  "えっ",
  "あっ",
  "うっ",
  "おっ",
  "なんて",
  "なぁ",
  // 下のパターン 2 が呼びかけ語として列挙しとる語。そっちで「呼びかけ」と認めとるのに
  // こっちに無いと、パターン 1 が「ねえ、つかさ？」の「ねえ」自体を誤った名前として拾う。
  // 2 つの表は同じものを指しとるので揃える。
  "ねえ",
  "ねぇ",
  "なあ",
  "おい",
  "やあ",
  "ちょっと",
  // パターン 1 は「文頭の 2〜4 字＋読点」を全部名前として拾う。日本語で最も多い文頭の形は
  // 名前の呼びかけやのうて副詞・接続詞で、これは閉じた語類やから列挙で塞げる。
  // 実測 2026-08-18: 台本 t7「そのまま、上から」が出荷既定で誤った名前として発火しとった。
  "そのまま",
  "やっぱり",
  "やはり",
  "ちゃんと",
  "もちろん",
  "たしかに",
  "たしか",
  "きっと",
  "さすがに",
  "べつに",
  "ふつうに",
  "ほんとに",
  "ほんまに",
  "まじで",
  "そろそろ",
  "たぶん",
  "どうせ",
  "やっと",
  "ずっと",
  "もっと",
  "まったく",
  "ぜんぜん",
  "とにかく",
  "つまり",
  "だから",
  "でも",
  "しかし",
  "それで",
  "だけど",
  "もう",
  "まだ",
  "また",
  "いつも",
  "たまに",
  "すぐに",
  "あとで",
  "さっき",
  "いまさら",
  "なるほど",
  "とりあえず",
  "ようやく",
  "ますます",
  "どんどん",
  "ゆっくり",
  "そっと",
  "じっと",
  "ぼんやり",
  "しっかり",
  "はっきり",
  "そういえば",
  "ところで",
  "ちなみに",
  "まさか",
  "どうやら",
  "なんか",
  "なんとなく",
  "けっこう",
  "かなり",
  "すごく",
  "めっちゃ",
]);

const stripTrailingPunctuation = (text: string): string =>
  text.replace(new RegExp("[、,.。！？\\s]+$", "u"), "");

// 候補そのもの、または空白区切りのいずれかのトークンが非名詞なら名前として扱わない。
const hasCommonWord = (text: string): boolean => {
  const trimmed = text.trim().toLowerCase();
  if (COMMON_NON_NAME_WORDS.has(trimmed)) return true;
  if (/\s/u.test(trimmed)) {
    return trimmed.split(/\s+/u).some((token) => COMMON_NON_NAME_WORDS.has(token));
  }
  return false;
};

const matchesCharacterOrUserName = (
  candidate: string,
  characterName: string,
  userName?: string,
): boolean => {
  const normalizedCandidate = candidate.trim().toLowerCase();
  const normalizedCharacter = characterName.trim().toLowerCase();
  if (
    normalizedCandidate === normalizedCharacter ||
    normalizedCharacter.includes(normalizedCandidate) ||
    normalizedCandidate.includes(normalizedCharacter)
  ) {
    return true;
  }
  if (userName) {
    const normalizedUser = userName.trim().toLowerCase();
    if (
      normalizedCandidate === normalizedUser ||
      normalizedUser.includes(normalizedCandidate) ||
      normalizedCandidate.includes(normalizedUser)
    ) {
      return true;
    }
  }
  return false;
};

export function extractWrongNameFromUserText(
  userText: string,
  characterName: string,
  userName?: string,
): string | null {
  if (!userText.trim() || !characterName.trim()) return null;

  const normalizedText = userText
    .replace(/[０-９Ａ-Ｚａ-ｚ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[，．]/g, ",.")
    .trim();

  const patterns = [
    new RegExp(`^(${ANY_NAME_PATTERN})[、,.\\s]+`, "u"),
    // 呼びかけ語のあとは空白とは限らん。「ねえ、つかさ？」のように読点で区切る方が普通。
    new RegExp(
      `^(?:Hello|Hi|Hey|Yo|こんにちは|こんばんは|おはよう|やあ|おい|ねえ|なあ|ちょっと)[、,\\s]+(${ANY_NAME_PATTERN})`,
      "iu",
    ),
    // 末尾の ？ は取らん。「読点＋語＋？」は日本語の疑問文の大半の形で、
    // 末尾の語はたいてい副詞・形容詞・名詞であって呼びかけやない。
    // 実測(2026-08-18 phase24 霜月鈴 t4): ユーザーが「……その距離、わざと？」と打っただけで
    // 「わざと」が誤った名前として拾われ、地の文が
    // 「……わざと？私は霜月鈴だけど。」＝ CHAT_BASE_RULES の訂正テンプレで始まった。
    // ガードは手書きの deny-list やったので、語を足す限り同じ形で何度でも起きる。
    // 既存の真陽性（I love you, Tsukasa ／ I love you, つかさ）はどれも ？ で終わっとらんので
    // 落ちん。？ で終わる呼びかけは上のパターン 2 が受ける。
    new RegExp(`[、,\\s]+(${ANY_NAME_PATTERN})[。！\\s]*$`, "u"),
  ];

  for (const pattern of patterns) {
    const match = normalizedText.match(pattern);
    if (match) {
      const candidate = stripTrailingPunctuation(match[1]);
      if (
        candidate.length >= 2 &&
        !hasCommonWord(candidate) &&
        !matchesCharacterOrUserName(candidate, characterName, userName)
      ) {
        return candidate;
      }
    }
  }

  return null;
}

export function buildNameIdentityReminder(
  userText: string,
  characterName: string,
  userName?: string,
): string | null {
  const wrongName = extractWrongNameFromUserText(userText, characterName, userName);
  if (!wrongName) return null;
  return NAME_IDENTITY_REMINDER(wrongName, characterName);
}

interface ChatMessageLike {
  role: string;
  content: string;
}

export function extractCharacterNameFromMessages(messages: ChatMessageLike[]): string | undefined {
  const system = messages.find((m) => m.role === "system")?.content;
  if (!system) return undefined;
  const match = system.match(new RegExp("^名前:\\s*(.+)$", "m"));
  const name = match?.[1]?.trim();
  return name && name.length <= 80 ? name : undefined;
}

export function extractUserNameFromMessages(messages: ChatMessageLike[]): string | undefined {
  for (const message of messages) {
    if (message.role !== "system") continue;
    const match = message.content.match(new RegExp("ユーザー名:\\s*(.+)"));
    // buildUserInfoMessageFromPersona（route-context.ts）は値を「」で囲んで埋め込む
    // （敵対レビュー #1236 指摘: 引用無しの生埋め込み対策）。この引用符ごと名前として
    // 抽出すると、checkNoEnglishのuserName除外判定が実際の応答本文（引用符なし）と
    // 一致せず無効化されるため、抽出時に外側の「」だけを剥がす。
    const rawName = match?.[1]?.trim();
    const name = rawName?.replace(/^「(.*)」$/, "$1").trim();
    if (name && name.length <= 80 && !name.includes("登録されていない")) return name;
  }
  return undefined;
}

export function buildNameIdentityReminderFromMessages(messages: ChatMessageLike[]): string | null {
  const characterName = extractCharacterNameFromMessages(messages);
  if (!characterName) return null;
  const userName = extractUserNameFromMessages(messages);
  const lastUserMessage = [...messages].reverse().find((m) => m.role === "user");
  if (!lastUserMessage) return null;
  return buildNameIdentityReminder(lastUserMessage.content, characterName, userName);
}
