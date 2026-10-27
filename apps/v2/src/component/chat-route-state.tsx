import { Link, useRouter } from "@tanstack/react-router";

import { useChatOnline } from "../lib/chat-online";

import { ChatState } from "./chat-state";

export const ChatLoadingState = () => {
  const online = useChatOnline();
  return <ChatState state={online ? "loading" : "offline"} />;
};

export const ChatErrorState = () => {
  const router = useRouter();
  const online = useChatOnline();
  return (
    <ChatState
      state={online ? "error" : "offline"}
      onRetry={() => {
        // loader の再取得だけに限定し、会話 POST の二重送信を避ける。
        void router.invalidate({ filter: (match) => match.routeId === "/chat/$id" });
      }}
    />
  );
};

export const ChatUnavailableState = () => <ChatState state="unavailable" />;

export const ChatConnectionState = () => {
  const online = useChatOnline();
  return online ? (
    <nav className="v2-list" aria-label="会話の移動">
      <Link to="/">一覧に戻る</Link>
    </nav>
  ) : (
    <ChatState state="offline" />
  );
};
