// LLMのXML構造化出力をパースする
// プロンプトで<response><action>/<dialogue>/<inner>タグを強制し、
// 各セクションを独立して品質チェック・レンダリングできるようにする

export interface StructuredResponse {
  scene: string;
  action: string;
  dialogue: string;
  inner: string;
  narration: string;
  remember: string[];
  raw: string;
  // action/dialogueが交互に複数出た時、モデルが書いた出現順を画面でも保つための列。
  // action/dialogueはこの配列の要素として重複して現れうるが、他フィールドは従来通り
  // 種別ごとに結合した1本の文字列のまま（品質判定・可視文字数カウントの既存挙動を変えないため）。
  blocks: NarrativeBlock[];
}

// action/dialogueが交互に出た場合の1ブロック分。地の文→台詞→地の文…の順序をUIへ伝える単位。
export interface NarrativeBlock {
  type: "action" | "dialogue";
  text: string;
}

// <response>タグを含むかどうかの軽量判定
export const isXmlResponse = (text: string): boolean =>
  /<response\b[^>]*>/i.test(text) && /<\/response>/i.test(text);

const hasStructuredResponseTags = (text: string): boolean =>
  /<(?:scene|action|dialogue|inner|narration)\b[^>]*>/i.test(text);

// XMLタグの中身を抽出（静的パターンで security/detect-non-literal-regexp 回避）
const TAG_PATTERNS: Record<string, RegExp> = {
  scene: /<scene\b[^>]*>([\S\s]*?)<\/scene>/gi,
  action: /<action\b[^>]*>([\S\s]*?)<\/action>/gi,
  dialogue: /<dialogue\b[^>]*>([\S\s]*?)<\/dialogue>/gi,
  narration: /<narration\b[^>]*>([\S\s]*?)<\/narration>/gi,
};
// inner だけは2段階で抽出する: </inner> が実在するなら最優先でそこまでを取る
// （<remember> が inner 内部に混入していても、閉じタグ後の本文取りこぼしを防ぐ）。
// </inner> が無い場合のみ、次の兄弟タグ開始 or <remember> の直前で打ち切る
// （閉じタグを書き忘れたモデル出力が後続の <remember> ブロックを飲み込むのを防ぐ）。
const INNER_CLOSED_PATTERN = /<inner\b[^>]*>([\S\s]*?)<\/inner\b[^>]*>/gi;
const INNER_UNCLOSED_PATTERN =
  /<inner\b[^>]*>([\S\s]*?)(?=<\/(?:response|dialogue|action|narration)\b|<remember\b)/i;
const REMEMBER_PATTERN = /<remember>([\S\s]*?)<\/remember>/gi;
const OPEN_REMEMBER_TAIL_PATTERN = /<remember>[\S\s]*$/i;
// モデル内部推論タグ（thinking/analysis等）はコンテンツごと除去
const HIDDEN_BLOCK_PATTERN =
  /<(?:thinking|analysis|reasoning|internal|protocol|system)\b[^>]*>[\S\s]*?<\/(?:thinking|analysis|reasoning|internal|protocol|system)>/gi;
const OPEN_HIDDEN_BLOCK_TAIL_PATTERN =
  /<(?:thinking|analysis|reasoning|internal|protocol|system)\b[^>]*>[\S\s]*$/i;
// 許可リスト外の不明タグを除去（タグのみ・コンテンツは保持）
const UNKNOWN_XML_TAG_PATTERN = /<\/?[a-zA-Z][a-zA-Z0-9_-]*[^>]*>/g;
const OPEN_UNKNOWN_XML_TAG_TAIL_PATTERN = /<\/?[a-zA-Z][a-zA-Z0-9_-]*[^>\n]*$/;
// <3 や数式など英字以外で始まる記号を誤削除しないよう [a-zA-Z] を必須にする
const PARTIAL_XML_TAG_TAIL_PATTERN = /<\/?(?:[a-zA-Z][^>\n]*)?$/;
const PARTIAL_LAYER_PATTERNS = {
  scene:
    /<scene\b[^>]*>([\S\s]*?)(?:<\/scene\b[^>]*>|(?=<(?:scene|action|dialogue|inner|narration)\b|<\/response\b)|$)/i,
  action:
    /<action\b[^>]*>([\S\s]*?)(?:<\/action\b[^>]*>|(?=<(?:scene|action|dialogue|inner|narration)\b|<\/response\b)|$)/i,
  dialogue:
    /<dialogue\b[^>]*>([\S\s]*?)(?:<\/dialogue\b[^>]*>|(?=<(?:scene|action|dialogue|inner|narration)\b|<\/response\b)|$)/i,
  inner:
    /<inner\b[^>]*>([\S\s]*?)(?:<\/inner\b[^>]*>|(?=<(?:scene|action|dialogue|inner|narration)\b|<\/response\b)|$)/i,
} satisfies Record<"scene" | "action" | "dialogue" | "inner", RegExp>;

// LLMがリテラル `\n` を出力するケースを実改行に正規化
const normalizeNewlines = (text: string): string => text.replace(/\\n/g, "\n");

export interface InlineEmphasisSegment {
  text: string;
  emphasis: boolean;
}

// *...* で囲まれた区間を抽出し、地の文/斜体レイヤーとして描画できるようセグメント分割する。
// <inner>タグを使わずモデルが本文中に直接 *asterisk* を書くケース（キャラ未設定の会話等）向け。
// 閉じ * が届いていない末尾（ストリーミング中の未完了区間）はプレーンテキストのまま残す。
const INLINE_EMPHASIS_PATTERN = /\*([^*\n]+)\*/g;

export const splitInlineEmphasis = (text: string): InlineEmphasisSegment[] => {
  if (!text) return [];
  const segments: InlineEmphasisSegment[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(INLINE_EMPHASIS_PATTERN)) {
    const start = match.index ?? 0;
    if (start > lastIndex) {
      segments.push({ text: text.slice(lastIndex, start), emphasis: false });
    }
    segments.push({ text: match[1], emphasis: true });
    lastIndex = start + match[0].length;
  }
  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex), emphasis: false });
  }
  return segments;
};

const extractTag = (text: string, tag: string): string => {
  const pattern = TAG_PATTERNS[tag];
  if (!pattern) return "";
  const matches = [...text.matchAll(pattern)];
  if (matches.length === 0) return "";
  return matches.map((match) => normalizeNewlines(match[1].trim())).join("\n\n");
};

const extractInner = (text: string): string => {
  const closed = [...text.matchAll(INNER_CLOSED_PATTERN)];
  if (closed.length > 0) {
    return closed.map((match) => normalizeNewlines(match[1].trim())).join("\n\n");
  }
  const unclosed = text.match(INNER_UNCLOSED_PATTERN);
  return unclosed ? normalizeNewlines(unclosed[1].trim()) : "";
};

const extractRememberTags = (text: string): string[] =>
  [...text.matchAll(REMEMBER_PATTERN)]
    .map((match) => match[1]?.trim() ?? "")
    .filter((note) => note.length > 0);

export const stripRememberTags = (text: string): string =>
  text.replace(REMEMBER_PATTERN, "").trim();

// action/dialogueの出現順ブロック抽出。action→dialogue→action→dialogue…と交互に
// 書かれた本文の時系列をそのまま拾う。
//
// 閉じタグは種別が合っとらんでも、そこでブロックを終える。\1 で同種だけに一致させとると、
// モデルが <dialogue> を </action> で閉じた瞬間、次の本物の </dialogue> までを 1 ブロックとして
// 呑み込む——間にある <action> の地の文が、まるごと台詞として画面へ出る。
// 実測(2026-08-17 phase15 霜月鈴 t7): この呑み込みが「地の文が 17 行続く壁」の実体やった。
// phase6 t6 でも同じ形が出とる。次の開始タグでも終える（閉じタグごと落とした場合）。
const ORDERED_BLOCK_PATTERN =
  /<(action|dialogue)\b[^>]*>([\S\s]*?)(?:<\/(?:action|dialogue|inner)\s*>|(?=<(?:action|dialogue|inner)\b)|$)/gi;

const extractOrderedBlocks = (text: string): NarrativeBlock[] =>
  [...text.matchAll(ORDERED_BLOCK_PATTERN)]
    .map((match) => ({
      type: match[1].toLowerCase() as "action" | "dialogue",
      // 呑み込みを塞いだ分、中身に別種のタグが残る場合がある（閉じタグ欠落の連鎖）。
      // 生タグの文字列が本文として画面へ出るのを防ぐため、ここで落とす。
      text: stripRememberTags(
        normalizeNewlines(match[2].replace(/<\/?(?:action|dialogue|inner)\b[^>]*>/gi, "").trim()),
      ),
    }))
    .filter((block) => block.text.length > 0);

const removeStreamingMarkup = (text: string): string =>
  text
    .replace(REMEMBER_PATTERN, "")
    .replace(OPEN_REMEMBER_TAIL_PATTERN, "")
    .replace(HIDDEN_BLOCK_PATTERN, "")
    .replace(OPEN_HIDDEN_BLOCK_TAIL_PATTERN, "")
    .replace(/<\/?(?:response|scene|action|dialogue|inner|narration|remember)[^>]*>?/gi, "")
    .replace(PARTIAL_XML_TAG_TAIL_PATTERN, "")
    .replace(UNKNOWN_XML_TAG_PATTERN, "")
    .replace(OPEN_UNKNOWN_XML_TAG_TAIL_PATTERN, "");

// ストリーミング中の不完全XMLを部分パース
export function parsePartialXmlResponse(partial: string): Partial<StructuredResponse> {
  const result: Partial<StructuredResponse> = {};
  const layers = ["scene", "action", "dialogue", "inner"] as const;
  for (const layer of layers) {
    const match = partial.match(PARTIAL_LAYER_PATTERNS[layer]);
    if (!match) continue;
    result[layer] = normalizeNewlines(removeStreamingMarkup(match[1]));
  }
  // PARTIAL_LAYER_PATTERNS は /g を持たんので種別ごとに最初の 1 個しか取れん。
  // erotic/climax は <action>/<dialogue> を交互に並べるので、そのままやと
  // 生成中は本文の大半が画面に出ず、ストリーム終了の瞬間に DOM が組み替わって
  // 高さが跳ね、読んどる位置が飛ぶ(D14)。
  // ただし出す条件は絞る——同じ種別が 2 回以上出た時だけ。1 回ずつなら
  // 上のフォールバックで全部表示できとるのに、blocks を出すと her-message.tsx の
  // blocks 分岐へ落ちて usePacedReveal のタイプライタ表示が全返信で死ぬ。
  const blocks = extractOrderedBlocks(partial);
  const repeatsAType = blocks.some(
    (block, index) => blocks.findIndex((other) => other.type === block.type) !== index,
  );
  if (repeatsAType) result.blocks = blocks;
  return result;
}

// ストリーミング表示用: 完全タグと未完了の開始タグを除去して生XML露出を防ぐ
// 許可リスト外の不明タグ（thinking等）も除去してストリーミング中のリークを防ぐ
export const stripXmlTagsStreaming = (text: string): string => removeStreamingMarkup(text).trim();

// シーンフェーズ用: action + dialogue + inner の完全XML
export const parseXmlResponse = (text: string): StructuredResponse | null => {
  if (!isXmlResponse(text) && !hasStructuredResponseTags(text)) return null;

  const action = stripRememberTags(extractTag(text, "action"));
  const dialogue = stripRememberTags(extractTag(text, "dialogue"));
  const inner = stripRememberTags(extractInner(text));
  const scene = stripRememberTags(extractTag(text, "scene"));
  const narration = stripRememberTags(extractTag(text, "narration"));
  const remember = extractRememberTags(text);
  const blocks = extractOrderedBlocks(text);

  // dialogueは必須（会話フェーズでもdialogueだけは必要）
  if (!dialogue) return null;

  return { scene, action, dialogue, inner, narration, remember, raw: text, blocks };
};

// XMLタグを除去してプレーンテキストに変換（品質チェック・TTS用）
// >? で閉じ > を任意化し、ストリーミング切り詰めで > が届かなかったタグも除去する
// 許可リスト外の不明タグも catch-all で除去（fallback 表示でのリーク防止）
// 圏点を描くのは her-message.tsx の splitInlineEmphasis だけ。平文を要る側——読み上げ、
// コピー、aria-live、一覧のプレビュー、共有ページ——はここを通るので、記号だけ落として
// 語は残す。落とさんと読み上げが「アスタリスク」と喋り、一覧の先頭 50 字に * が並ぶ
// （敵対レビュー 2026-08-17。強調を頼む位置が段落の頭やから、プレビューに一番出る）。
export const stripInlineEmphasisMarkers = (text: string): string =>
  text.replace(INLINE_EMPHASIS_PATTERN, "$1");

export const stripXmlTags = (text: string): string =>
  stripInlineEmphasisMarkers(text)
    .replace(REMEMBER_PATTERN, "")
    .replace(OPEN_REMEMBER_TAIL_PATTERN, "")
    .replace(HIDDEN_BLOCK_PATTERN, "")
    .replace(OPEN_HIDDEN_BLOCK_TAIL_PATTERN, "")
    .replace(/<\/?(?:response|scene|action|dialogue|inner|narration|remember)\b(?:[^>]*>|$)/gi, "")
    .replace(PARTIAL_XML_TAG_TAIL_PATTERN, "")
    .replace(UNKNOWN_XML_TAG_PATTERN, "")
    .replace(/\n{2,}/g, "\n")
    .trim();

// モデルがXMLラッパーを省略したプレーン応答を<response><dialogue>でラップする
// 会話フェーズ限定の救済策。シーンフェーズは<action>/<inner>必須のため適用しない
// 理由: 会話フェーズの「平文対話」は意味的にdialogue相当であり、
// XMLラッパーは構造オーバーヘッドにすぎない。救済せずリトライ枯渇で送信エラー
// にするのはUXとして致命的
export const wrapConversationPlainAsXml = (text: string): string => {
  if (isXmlResponse(text)) return text;
  const trimmed = text.trim();
  if (trimmed.length === 0) return text;
  // 裸の<dialogue>タグだけ出力された場合も救済
  const dialogueOnly = trimmed.match(/^<dialogue\b[^>]*>([\S\s]*?)<\/dialogue>$/i);
  if (dialogueOnly) {
    return `<response><dialogue>${dialogueOnly[1].trim()}</dialogue></response>`;
  }
  return `<response><dialogue>${trimmed}</dialogue></response>`;
};
