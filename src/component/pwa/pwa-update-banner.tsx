import { useCallback, useEffect, useRef, type JSX } from "react";

import { useRegisterSW } from "virtual:pwa-register/react";

import { useChatStore } from "@/store/chat-store";

const UPDATE_CHECK_INTERVAL_MS = 60_000;
const AUTO_APPLY_DELAY_MS = 60_000;

export const PwaUpdateBanner = (): JSX.Element | null => {
  const registeredCleanupRef = useRef<(() => void) | null>(null);

  const setRegisteredCleanup = useCallback((cleanup: () => void) => {
    registeredCleanupRef.current?.();
    registeredCleanupRef.current = cleanup;
  }, []);

  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, r) {
      if (!r) return;

      const triggerCheck = () => {
        void r.update().catch(() => undefined);
      };

      triggerCheck();

      const intervalId = setInterval(triggerCheck, UPDATE_CHECK_INTERVAL_MS);

      const onVisible = () => {
        if (document.visibilityState === "visible") triggerCheck();
      };
      const onFocus = () => triggerCheck();

      document.addEventListener("visibilitychange", onVisible);
      window.addEventListener("focus", onFocus);

      setRegisteredCleanup(() => {
        clearInterval(intervalId);
        document.removeEventListener("visibilitychange", onVisible);
        window.removeEventListener("focus", onFocus);
      });
    },
  });

  const isStreaming = useChatStore((state) => state.isLoading);
  const hasAppliedRef = useRef(false);

  const applyUpdate = useCallback(async () => {
    if (hasAppliedRef.current) return;

    hasAppliedRef.current = true;
    try {
      await updateServiceWorker(true);
    } catch {
      hasAppliedRef.current = false;
    }
  }, [updateServiceWorker]);

  useEffect(
    () => () => {
      registeredCleanupRef.current?.();
      registeredCleanupRef.current = null;
    },
    [],
  );

  useEffect(() => {
    if (!needRefresh || isStreaming) return;

    const onHidden = () => {
      if (document.visibilityState === "hidden") {
        void applyUpdate();
      }
    };

    const timeoutId = setTimeout(() => {
      void applyUpdate();
    }, AUTO_APPLY_DELAY_MS);

    document.addEventListener("visibilitychange", onHidden);
    onHidden();

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener("visibilitychange", onHidden);
    };
  }, [needRefresh, isStreaming, applyUpdate]);

  if (!needRefresh) return null;

  return (
    <div className="pointer-events-none fixed right-0 bottom-4 left-0 z-50 flex justify-center">
      <div className="pointer-events-auto flex items-center gap-3 rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2 text-sm text-zinc-200 shadow-lg">
        <span>アプリが更新されました</span>
        <button
          type="button"
          onClick={() => void applyUpdate()}
          disabled={isStreaming}
          className="rounded bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-900 disabled:opacity-50"
          title={isStreaming ? "配信完了後に更新できます" : undefined}
        >
          {isStreaming ? "配信中..." : "今すぐ更新"}
        </button>
      </div>
    </div>
  );
};
