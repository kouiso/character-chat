// RIT-204: メッセージ単位のアクション行（コピー・共有・ブックマーク・いいね）。
import { useState, type ReactNode } from "react";

import type { MessageMark } from "../lib/marks";
import { TalkIcon } from "./talk-icon";
import { TalkSheet } from "./talk-sheet";

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
  children?: ReactNode;
  messageId: string;
  role: "user" | "assistant";
  text: string;
  marks: MessageMark[];
  onToggle: (kind: "bookmark" | "feedback", value?: 1 | -1) => void;
};

export const MessageActions = ({
  messageId,
  role,
  text,
  marks,
  onToggle,
  children,
}: MessageActionsProps) => {
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);
  const feedback = marks.find((mark) => mark.messageId === messageId && mark.kind === "feedback");
  const bookmarked = marks.some((mark) => mark.messageId === messageId && mark.kind === "bookmark");
  const flashCopied = () => {
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div className="v2-message-actions">
      <button type="button" aria-label="発言の操作" onClick={() => setOpen(true)}>
        <TalkIcon name="more" />
      </button>
      <TalkSheet
        open={open}
        title={role === "assistant" ? "この返事" : "この発言"}
        onClose={() => setOpen(false)}
      >
        <div className="v2-talk-action-list">
          {children}
          <button
            type="button"
            aria-label="メッセージをコピー"
            onClick={() => {
              void copyText(text).then(flashCopied);
            }}
          >
            {copied ? "コピーしました" : "コピー"}
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
            <TalkIcon name="bookmark" />
            {bookmarked ? "しおり済み" : "しおりを付ける"}
          </button>
          {role === "assistant" && (
            <>
              <button
                type="button"
                aria-label="いいね"
                aria-pressed={feedback?.value === 1}
                onClick={() => onToggle("feedback", 1)}
              >
                <TalkIcon name="thumb" />
                この返事は良い
              </button>
              <button
                type="button"
                aria-label="良くない"
                aria-pressed={feedback?.value === -1}
                onClick={() => onToggle("feedback", -1)}
              >
                良くない
              </button>
            </>
          )}
        </div>
      </TalkSheet>
    </div>
  );
};
