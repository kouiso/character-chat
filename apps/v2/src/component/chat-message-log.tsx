import { useCallback, useLayoutEffect, useRef, type ReactNode } from "react";

import "./chat-message-log.css";

export type ChatMessageLogProps = {
  children: ReactNode;
  busy: boolean;
};

export const ChatMessageLog = ({ children, busy }: ChatMessageLogProps) => {
  const logRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const followLatestRef = useRef(true);
  const sizeRef = useRef({ clientHeight: 0, scrollHeight: 0 });

  const syncPosition = useCallback(() => {
    const log = logRef.current;
    if (!log) return;
    if (followLatestRef.current) log.scrollTop = log.scrollHeight - log.clientHeight;
    sizeRef.current = { clientHeight: log.clientHeight, scrollHeight: log.scrollHeight };
  }, []);

  useLayoutEffect(syncPosition, [children, syncPosition]);

  useLayoutEffect(() => {
    const log = logRef.current;
    if (!log || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(syncPosition);
    observer.observe(log);
    if (contentRef.current) observer.observe(contentRef.current);
    return () => observer.disconnect();
  }, [syncPosition]);

  const updateFollowLatest = () => {
    const log = logRef.current;
    if (!log) return;
    // 回転・文字拡大のscrollはresize通知より先に来るため、閲覧者の操作と区別する。
    if (
      sizeRef.current.clientHeight !== log.clientHeight ||
      sizeRef.current.scrollHeight !== log.scrollHeight
    ) {
      syncPosition();
      return;
    }
    followLatestRef.current = log.scrollHeight - log.clientHeight - log.scrollTop <= 16;
  };

  return (
    <div
      ref={logRef}
      className="v2-chat-log v2-message-log"
      role="log"
      aria-label="会話のメッセージ"
      aria-busy={busy}
      tabIndex={0}
      onScroll={updateFollowLatest}
    >
      <div ref={contentRef} className="v2-message-log-content">
        {children}
      </div>
    </div>
  );
};
