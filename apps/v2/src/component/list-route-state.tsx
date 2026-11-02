import { useRouter } from "@tanstack/react-router";

import { useChatOnline } from "../lib/chat-online";

import { RouteState } from "./route-state";

const useRetryList = () => {
  const router = useRouter();
  return () => {
    // 一覧が戻り先でも、同じ URL への移動だけで再取得が省略されるのを避ける。
    void router.invalidate({ filter: (match) => match.routeId === "/", forcePending: true });
  };
};

export const ListLoadingState = () => {
  const online = useChatOnline();
  const retry = useRetryList();
  return (
    <RouteState
      state={online ? "loading" : "offline"}
      title={online ? "一覧を読み込んでいます" : "オフラインです"}
      description="接続を確認して、読み込みをやり直せます。"
      onRetry={retry}
    />
  );
};

export const ListErrorState = () => {
  const online = useChatOnline();
  const retry = useRetryList();
  return (
    <RouteState
      state={online ? "error" : "offline"}
      title={online ? "一覧を読み込めませんでした" : "オフラインです"}
      description="接続を確認して、読み込みをやり直せます。"
      onRetry={retry}
    />
  );
};

export const ListConnectionState = () => {
  const online = useChatOnline();
  const retry = useRetryList();
  return online ? null : (
    <RouteState
      state="offline"
      title="オフラインです"
      description="表示中の一覧はそのまま使えます。接続後に読み込みをやり直せます。"
      onRetry={retry}
    />
  );
};

export const ListEmptyState = () => {
  const online = useChatOnline();
  const retry = useRetryList();
  return (
    <RouteState
      state={online ? "empty" : "offline"}
      title={online ? "キャラクターがありません" : "オフラインです"}
      description={
        online
          ? "読み込みをやり直して、一覧を確認できます。"
          : "接続後に読み込みをやり直して、一覧を確認できます。"
      }
      onRetry={retry}
    />
  );
};
