import { Fragment, useMemo, type ReactNode } from "react";

import "./chat-message.css";

export type ChatMessageProps = {
  role: "user" | "assistant";
  text: string;
  characterName: string;
  streaming?: boolean;
};

type LayerKind = "scene" | "action" | "dialogue" | "inner" | "narration";
type MessageLayer = { kind: LayerKind; text: string };

const MAX_UNBROKEN_EMOJI_CODE_POINTS = 16;

export type ChatMessageTextProps = { text: string };

export const ChatMessageText = ({ text }: ChatMessageTextProps) =>
  useMemo(() => {
    if (text.length <= MAX_UNBROKEN_EMOJI_CODE_POINTS) return text;
    const segments = new Intl.Segmenter("ja", { granularity: "grapheme" }).segment(text);
    const result: ReactNode[] = [];
    let plain = "";
    for (const { segment, index } of segments) {
      const points = [...segment];
      if (points.length <= MAX_UNBROKEN_EMOJI_CODE_POINTS) {
        plain += segment;
        continue;
      }
      if (plain) {
        result.push(plain);
        plain = "";
      }
      // 単一graphemeはCSSで折れないため、過長な結合列だけ本文を変えずに改行機会を置く。
      result.push(
        ...points.map((part, partIndex, parts) => (
          <Fragment key={`${index}-${partIndex}`}>
            {part}
            {partIndex < parts.length - 1 ? <wbr /> : null}
          </Fragment>
        )),
      );
    }
    if (result.length === 0) return text;
    if (plain) result.push(plain);
    return result;
  }, [text]);

const LAYER_LABELS: Record<LayerKind, string> = {
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

const messageLayers = (text: string, streaming: boolean): MessageLayer[] => {
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

export const ChatMessage = ({ role, text, characterName, streaming = false }: ChatMessageProps) => {
  if (role === "user") {
    return (
      <div className="v2-message v2-message--user" role="group" aria-label="あなたのメッセージ">
        <p className="v2-message-text">
          <ChatMessageText text={text} />
        </p>
      </div>
    );
  }

  return (
    <div
      className="v2-message v2-message--assistant"
      role="group"
      aria-label={`${characterName}のメッセージ`}
    >
      <p className="v2-message-name">
        <ChatMessageText text={characterName} />
      </p>
      {messageLayers(text, streaming).map((layer, index) => (
        <div
          key={index}
          className={`v2-message-layer v2-message-layer--${layer.kind}`}
          role="group"
          aria-label={LAYER_LABELS[layer.kind]}
        >
          <p className="v2-message-text">
            <ChatMessageText text={layer.text} />
          </p>
        </div>
      ))}
    </div>
  );
};
