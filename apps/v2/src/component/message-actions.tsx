// RIT-204: メッセージ単位のアクション行（コピー・共有・ブックマーク・いいね）。
import { useState } from "react";

import type { MessageMark } from "../lib/marks";

const copyText = async (text: string): Promise<void> => {
  await navigator.clipboard.writeText(text);
};

const shareText = async (text: string): Promise<void> => {
  // Web Share API が使える端末では共有シート、無い環境はコピー保存で代用する
  // （Linear の「共有（コピー保存）」の括弧書きどおり）。
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ text });
      return;
    } catch {
      // キャンセルもコピーへ倒す（コピーされてさえいれば目的は果たせる）。
    }
  }
  await copyText(text);
};

type MessageActionsProps = {
  messageId: string;
  role: "user" | "assistant";
  text: string;
  marks: MessageMark[];
  onToggle: (kind: "bookmark" | "feedback", value?: 1 | -1) => void;
};

export const MessageActions = ({ messageId, role, text, marks, onToggle }: MessageActionsProps) => {
  const [copied, setCopied] = useState(false);
  const feedback = marks.find((mark) => mark.messageId === messageId && mark.kind === "feedback");
  const bookmarked = marks.some((mark) => mark.messageId === messageId && mark.kind === "bookmark");
  const flashCopied = () => {
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div className="v2-message-actions">
      <button
        type="button"
        aria-label="メッセージをコピー"
        onClick={() => {
          void copyText(text).then(flashCopied);
        }}
      >
        {copied ? "コピー済み" : "コピー"}
      </button>
      <button type="button" aria-label="メッセージを共有" onClick={() => void shareText(text)}>
        共有
      </button>
      <button
        type="button"
        aria-label="ブックマーク"
        aria-pressed={bookmarked}
        onClick={() => onToggle("bookmark")}
      >
        {bookmarked ? "🔖" : "ブックマーク"}
      </button>
      {role === "assistant" && (
        <>
          <button
            type="button"
            aria-label="いいね"
            aria-pressed={feedback?.value === 1}
            className={feedback?.value === 1 ? "active" : ""}
            onClick={() => onToggle("feedback", 1)}
          >
            👍
          </button>
          <button
            type="button"
            aria-label="良くない"
            aria-pressed={feedback?.value === -1}
            className={feedback?.value === -1 ? "active" : ""}
            onClick={() => onToggle("feedback", -1)}
          >
            👎
          </button>
        </>
      )}
    </div>
  );
};
