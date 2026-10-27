import "./chat-message.css";

export type ChatMessageProps = {
  role: "user" | "assistant";
  text: string;
  characterName: string;
  streaming?: boolean;
};

type LayerKind = "scene" | "action" | "dialogue" | "inner" | "narration";
type MessageLayer = { kind: LayerKind; text: string };

const LAYER_LABELS: Record<LayerKind, string> = {
  scene: "状況",
  action: "描写",
  dialogue: "台詞",
  inner: "心の声",
  narration: "地の文",
};

const RESPONSE_TAGS = ["response", "scene", "action", "dialogue", "inner", "narration"];

const isLayerKind = (tag: string): tag is LayerKind => Object.hasOwn(LAYER_LABELS, tag);

const messageLayers = (text: string, streaming: boolean): MessageLayer[] => {
  let source = text;
  const lastBracket = source.lastIndexOf("<");
  if (streaming && lastBracket !== -1) {
    const tail = source.slice(lastBracket);
    if (RESPONSE_TAGS.some((tag) => `<${tag}>`.startsWith(tail) || `</${tag}>`.startsWith(tail))) {
      // token がタグの途中で切れても、次の token まで制御文字を本文へ出さない。
      source = source.slice(0, lastBracket);
    }
  }

  const layers: MessageLayer[] = [];
  const tags = /<(\/?)(response|scene|action|dialogue|inner|narration)>/g;
  let kind: LayerKind = "dialogue";
  let cursor = 0;
  const append = (end: number) => {
    const content = source.slice(cursor, end);
    if (content.trim()) layers.push({ kind, text: content });
  };

  for (const match of source.matchAll(tags)) {
    append(match.index);
    const tag = match[2];
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
  return layers;
};

export const ChatMessage = ({ role, text, characterName, streaming = false }: ChatMessageProps) => {
  if (role === "user") {
    return (
      <div className="v2-message v2-message--user" role="group" aria-label="あなたのメッセージ">
        <p className="v2-message-text">{text}</p>
      </div>
    );
  }

  return (
    <div
      className="v2-message v2-message--assistant"
      role="group"
      aria-label={`${characterName}のメッセージ`}
    >
      <p className="v2-message-name">{characterName}</p>
      {messageLayers(text, streaming).map((layer, index) => (
        <div
          key={index}
          className={`v2-message-layer v2-message-layer--${layer.kind}`}
          role="group"
          aria-label={LAYER_LABELS[layer.kind]}
        >
          <p className="v2-message-text">{layer.text}</p>
        </div>
      ))}
    </div>
  );
};
