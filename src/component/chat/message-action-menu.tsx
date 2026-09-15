import { type JSX, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";

import { MoreHorizontal, ThumbsDown, ThumbsUp } from "lucide-react";

import { cn } from "@/lib/utils";

type MessageFeedbackRating = "good" | "bad";

interface MessageActionMenuProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onCopy: () => void;
  onPromoteMemory?: () => void;
  onFeedback?: (rating: MessageFeedbackRating, reason?: string) => void;
  feedbackRating?: MessageFeedbackRating;
  onDelete?: () => void;
  className?: string;
  /** Additional menu items rendered at the top of the dropdown (bookmark, branch, etc.) */
  extraItems?: ReactNode;
}

interface DropdownContentProps {
  onCopy: () => void;
  onPromoteMemory?: () => void;
  onFeedback?: (rating: MessageFeedbackRating, reason?: string) => void;
  feedbackRating?: MessageFeedbackRating;
  onDelete?: () => void;
  extraItems?: ReactNode;
  onClose: () => void;
  flipUp?: boolean;
}

const DropdownContent = ({
  onCopy,
  onPromoteMemory,
  onFeedback,
  feedbackRating,
  onDelete,
  extraItems,
  onClose,
  flipUp = false,
}: DropdownContentProps): JSX.Element => {
  const [badReasonText, setBadReasonText] = useState("");
  const [showReasonForm, setShowReasonForm] = useState(false);

  const run = (fn: () => void) => {
    fn();
    onClose();
  };

  const submitBad = (reason?: string) => {
    run(() => onFeedback?.("bad", reason || undefined));
  };

  return (
    <div
      className={cn(
        "absolute right-0 z-20 min-w-48 rounded-md border bg-popover p-1 text-sm shadow-md",
        flipUp ? "bottom-11" : "top-11",
      )}
    >
      {!showReasonForm && (
        <>
          {extraItems}
          <button
            type="button"
            className="w-full rounded px-2 py-1.5 text-left hover:bg-accent"
            onClick={() => run(onCopy)}
          >
            コピー
          </button>
          {onPromoteMemory && (
            <button
              type="button"
              className="w-full rounded px-2 py-1.5 text-left hover:bg-accent"
              onClick={() => run(onPromoteMemory)}
            >
              強化記憶
            </button>
          )}
          {onFeedback && (
            <>
              <button
                type="button"
                className={cn(
                  "flex w-full items-center rounded px-2 py-1.5 text-left hover:bg-accent",
                  feedbackRating === "good" && "text-primary",
                )}
                aria-pressed={feedbackRating === "good"}
                onClick={() => run(() => onFeedback("good"))}
              >
                <ThumbsUp className="mr-2 h-4 w-4" />
                Good
              </button>
              <button
                type="button"
                className={cn(
                  "flex w-full items-center rounded px-2 py-1.5 text-left hover:bg-accent",
                  feedbackRating === "bad" && "text-destructive",
                )}
                aria-pressed={feedbackRating === "bad"}
                onClick={() => setShowReasonForm(true)}
              >
                <ThumbsDown className="mr-2 h-4 w-4" />
                Bad
              </button>
            </>
          )}
          {onDelete && (
            <button
              type="button"
              className="w-full rounded px-2 py-1.5 text-left text-destructive hover:bg-accent"
              onClick={() => run(onDelete)}
            >
              削除
            </button>
          )}
        </>
      )}
      {showReasonForm && (
        <div className="flex flex-col gap-1.5 p-1">
          <p className="text-xs text-muted-foreground">何がダメでしたか？（任意）</p>
          <textarea
            className="w-full resize-none rounded border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            rows={3}
            placeholder="例: AI臭い、キャラが崩れた…"
            value={badReasonText}
            onChange={(e) => setBadReasonText(e.target.value)}
            autoFocus
          />
          <div className="flex gap-1">
            <button
              type="button"
              className="flex-1 rounded bg-destructive px-2 py-1 text-xs text-destructive-foreground hover:bg-destructive/90"
              onClick={() => submitBad(badReasonText)}
            >
              送信
            </button>
            <button
              type="button"
              className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
              onClick={() => submitBad()}
            >
              スキップ
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

/** viewport 下端までの余白が足りなければ上方向に展開する */
const DROPDOWN_MIN_SPACE_PX = 200;

export const MessageActionMenu = ({
  open = false,
  onOpenChange,
  onCopy,
  onPromoteMemory,
  onFeedback,
  feedbackRating,
  onDelete,
  className,
  extraItems,
}: MessageActionMenuProps): JSX.Element => {
  const rootRef = useRef<HTMLDivElement>(null);
  const [flipUp, setFlipUp] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) onOpenChange?.(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, onOpenChange]);

  useLayoutEffect(() => {
    if (!open || !rootRef.current) return;
    const rect = rootRef.current.getBoundingClientRect();
    setFlipUp(window.innerHeight - rect.bottom < DROPDOWN_MIN_SPACE_PX);
  }, [open]);

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        className={cn(
          "inline-flex h-11 w-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
          className,
        )}
        aria-label="メッセージメニュー"
        onClick={() => onOpenChange?.(!open)}
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && (
        <DropdownContent
          onCopy={onCopy}
          onPromoteMemory={onPromoteMemory}
          onFeedback={onFeedback}
          feedbackRating={feedbackRating}
          onDelete={onDelete}
          extraItems={extraItems}
          onClose={() => onOpenChange?.(false)}
          flipUp={flipUp}
        />
      )}
    </div>
  );
};
