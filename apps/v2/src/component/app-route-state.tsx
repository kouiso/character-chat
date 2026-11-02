import { useRouter } from "@tanstack/react-router";

import { useChatOnline } from "../lib/chat-online";

import { RouteState } from "./route-state";

import type { ErrorComponentProps } from "@tanstack/react-router";

export const AppLoadingState = () => {
  const online = useChatOnline();
  const router = useRouter();
  return (
    <RouteState
      state={online ? "loading" : "offline"}
      title={online ? "画面を読み込んでいます" : "オフラインです"}
      description="接続を確認して、読み込みをやり直せます。"
      onRetry={() => {
        void router.invalidate({ forcePending: true });
      }}
    />
  );
};

export const AppErrorState = ({ reset }: ErrorComponentProps) => {
  const online = useChatOnline();
  const router = useRouter();
  return (
    <RouteState
      state={online ? "error" : "offline"}
      title={online ? "画面を読み込めませんでした" : "オフラインです"}
      description="読み込みをやり直すか、一覧に戻ってください。"
      onRetry={() => {
        void router.invalidate({ forcePending: true });
        reset();
      }}
    />
  );
};

export const AppNotFoundState = () => (
  <RouteState
    state="unavailable"
    title="ページが見つかりません"
    description="一覧に戻って、表示したいキャラクターを選んでください。"
  />
);
