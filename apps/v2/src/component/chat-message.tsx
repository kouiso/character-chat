import { Fragment, useMemo, type ReactNode } from "react";

import { LAYER_LABELS, messageLayers } from "../lib/message-layers";

import "./chat-message.css";

export type ChatMessageProps = {
  role: "user" | "assistant";
  text: string;
  characterName: string;
  streaming?: boolean;
};

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
