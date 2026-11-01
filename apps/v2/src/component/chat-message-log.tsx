import { useLayoutEffect, useRef, type ReactNode } from "react";

import "./chat-message-log.css";

export type ChatMessageLogProps = {
  children: ReactNode;
  busy: boolean;
};

export const ChatMessageLog = ({ children, busy }: ChatMessageLogProps) => {
  const logRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const followLatestRef = useRef(true);

  useLayoutEffect(() => {
    const log = logRef.current;
    if (log && followLatestRef.current) log.scrollTop = log.scrollHeight - log.clientHeight;
  }, [children]);

  useLayoutEffect(() => {
    const log = logRef.current;
    if (!log || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (followLatestRef.current) log.scrollTop = log.scrollHeight - log.clientHeight;
    });
    observer.observe(log);
    if (contentRef.current) observer.observe(contentRef.current);
    return () => observer.disconnect();
  }, []);

  const updateFollowLatest = () => {
    const log = logRef.current;
    if (log) followLatestRef.current = log.scrollHeight - log.clientHeight - log.scrollTop <= 16;
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
