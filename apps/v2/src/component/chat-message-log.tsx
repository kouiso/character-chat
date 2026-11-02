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
  const pointerDownRef = useRef(false);
  const touchYRef = useRef<number | null>(null);

  const syncPosition = useCallback(() => {
    const log = logRef.current;
    if (!log) return;
    if (followLatestRef.current) log.scrollTop = log.scrollHeight - log.clientHeight;
  }, []);
  const pauseFollowLatest = useCallback(() => {
    if (logRef.current && logRef.current.scrollTop > 0) followLatestRef.current = false;
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

  useLayoutEffect(() => {
    const log = logRef.current;
    if (!log) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        ["ArrowUp", "PageUp", "Home"].includes(event.key) ||
        (event.key === " " && event.shiftKey)
      )
        pauseFollowLatest();
    };
    log.addEventListener("keydown", onKeyDown);
    return () => log.removeEventListener("keydown", onKeyDown);
  }, [pauseFollowLatest]);

  const updateFollowLatest = () => {
    const log = logRef.current;
    if (!log) return;
    // 回転後の遅延scrollもtrustedになるため、入力なしでは追従の意図を解除しない。
    if (followLatestRef.current && !pointerDownRef.current) {
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
      onWheel={(event) => {
        if (event.deltaY < 0) pauseFollowLatest();
      }}
      onTouchStart={(event) => {
        touchYRef.current = event.touches[0]?.clientY ?? null;
      }}
      onTouchMove={(event) => {
        const y = event.touches[0]?.clientY ?? null;
        if (y !== null && touchYRef.current !== null && y > touchYRef.current) pauseFollowLatest();
        touchYRef.current = y;
      }}
      onTouchEnd={() => {
        touchYRef.current = null;
      }}
      onTouchCancel={() => {
        touchYRef.current = null;
      }}
      onPointerDown={() => {
        pointerDownRef.current = true;
      }}
      onPointerUp={() => {
        pointerDownRef.current = false;
      }}
      onPointerCancel={() => {
        pointerDownRef.current = false;
      }}
      onPointerLeave={() => {
        pointerDownRef.current = false;
      }}
    >
      <div ref={contentRef} className="v2-message-log-content">
        {children}
      </div>
    </div>
  );
};
