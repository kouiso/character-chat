import { RouteState } from "./route-state";

export type ChatStateKind = "loading" | "error" | "offline" | "unavailable";

const STATE_COPY: Record<ChatStateKind, { title: string; description: string }> = {
  loading: {
    title: "会話を読み込んでいます",
    description: "時間がかかる場合は、一覧に戻れます。",
  },
  error: {
    title: "会話を読み込めませんでした",
    description: "読み込みをやり直すか、一覧に戻ってください。",
  },
  offline: {
    title: "オフラインです",
    description: "接続を確認してください。メッセージは自動で再送しません。",
  },
  unavailable: {
    title: "このキャラクターは利用できません",
    description: "一覧に戻って、別のキャラクターを選んでください。",
  },
};

export type ChatStateProps = {
  state: ChatStateKind;
  onRetry?: () => void;
};

export const ChatState = ({ state, onRetry }: ChatStateProps) => {
  const copy = STATE_COPY[state];
  return <RouteState state={state} {...copy} onRetry={onRetry} />;
};
