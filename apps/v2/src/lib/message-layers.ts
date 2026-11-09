// 応答テキストのレイヤ分割（chat-message から共有化・RIT-212 でも使う）。
// <scene><action><inner><narration> 等のタグで種別を区切る。タグ無しは dialogue。
export type LayerKind = "scene" | "action" | "dialogue" | "inner" | "narration";
export type MessageLayer = { kind: LayerKind; text: string };

export const LAYER_LABELS: Record<LayerKind, string> = {
  scene: "状況",
  action: "描写",
  dialogue: "台詞",
  inner: "心の声",
  narration: "地の文",
};

const RESPONSE_TAGS = ["response", ...Object.keys(LAYER_LABELS)];

const isLayerKind = (tag: string): tag is LayerKind => Object.hasOwn(LAYER_LABELS, tag);

const streamingSource = (text: string, streaming: boolean): string => {
  if (!streaming) return text;
  const lastBracket = text.lastIndexOf("<");
  if (lastBracket === -1) return text;
  const tail = text.slice(lastBracket);
  // token がタグの途中で切れても、次の token まで制御文字を本文へ出さない。
  return RESPONSE_TAGS.some((tag) => `<${tag}>`.startsWith(tail) || `</${tag}>`.startsWith(tail))
    ? text.slice(0, lastBracket)
    : text;
};

export const messageLayers = (text: string, streaming: boolean): MessageLayer[] => {
  const source = streamingSource(text, streaming);
  const layers: MessageLayer[] = [];
  const tags = /<(\/?)([a-z][a-z-]*)>/g;
  let kind: LayerKind = "dialogue";
  let cursor = 0;
  let insideLayer = false;
  let pendingWhitespace = "";
  const append = (end: number) => {
    const content = source.slice(cursor, end);
    if (content.trim()) {
      layers.push({ kind, text: pendingWhitespace + content });
      pendingWhitespace = "";
    } else if (content && !insideLayer) {
      pendingWhitespace += content;
    }
  };

  for (const match of source.matchAll(tags)) {
    const tag = match[2];
    if (!RESPONSE_TAGS.includes(tag)) continue;
    append(match.index);
    insideLayer = tag !== "response" && !match[1];
    if (tag !== "response") {
      if (match[1]) {
        kind = "dialogue";
      } else if (isLayerKind(tag)) {
        kind = tag;
      }
    }
    cursor = match.index + match[0].length;
  }
  append(source.length);
  const last = layers.at(-1);
  if (last) last.text += pendingWhitespace;
  return layers;
};
