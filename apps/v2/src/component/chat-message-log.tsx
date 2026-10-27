import { useLayoutEffect, useRef, type ReactNode } from "react";

import "./chat-message-log.css";

export type ChatMessageLogProps = {
  children: ReactNode;
  busy: boolean;
};

export const ChatMessageLog = ({ children, busy }: ChatMessageLogProps) => {
  const logRef = useRef<HTMLDivElement>(null);
  const followLatestRef = useRef(true);

  useLayoutEffect(() => {
    const log = logRef.current;
    if (log && followLatestRef.current) log.scrollTop = log.scrollHeight - log.clientHeight;
  }, [children]);

  useLayoutEffect(() => {
    const log = logRef.current;
    if (!log) return;
    const followLatest = () => {
      if (followLatestRef.current) log.scrollTop = log.scrollHeight - log.clientHeight;
    };
    const resize =
      typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(followLatest);
    resize?.observe(log);
    // 子の配送タイマーで本文が増えた時も、親の再描画を待たず末尾へ追従する。
    const content = new MutationObserver(followLatest);
    content.observe(log, { childList: true, subtree: true, characterData: true });
    return () => {
      resize?.disconnect();
      content.disconnect();
    };
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
      {children}
    </div>
  );
};
