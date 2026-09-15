export type PersistedTurnMessage = { role: "user" | "assistant" | "system"; content: string };

// D1 から読んだ行。role は文字列のまま届く。
export type PersistedHistoryRow = { role: string; content: string };

export const isEmptyOrPlaceholderContent = (value: string): boolean => {
  const trimmed = value.trim();
  return trimmed === "" || trimmed === "受信中" || trimmed.includes("ことばを探している");
};

const CLASSIFIER_TURN_WINDOW = 6;

/**
 * フェーズ分類器へ渡す直近履歴を選ぶ。
 *
 * 行数だけを見て D1 の履歴を採用すると、次の2つを取り違える。
 * - 「今ターンの行がまだ書かれていない」= 行数で検出できる
 * - 「行は在るが中身が古い」= 行数では検出できない
 *
 * 後者は再生成経路で起きる。ou-app.tsx の handleRegenerate は
 * updateMessageContentEntry を await する前に setLoading(false) を呼ぶため、
 * 入力欄が有効に戻っても本文の書き戻しは終わっていない。
 * 空応答が再生成の引き金なので、その時 D1 に残っているのは空の assistant 行になる。
 */
export const selectRecentTurnsForClassifier = (input: {
  persistedMessages: readonly PersistedHistoryRow[];
  expectedPersistedCount: number;
  renderedUserMsg: string;
  renderedAssistantMsg: string;
}): PersistedTurnMessage[] => {
  const fallback: PersistedTurnMessage[] = [
    { role: "user", content: input.renderedUserMsg },
    { role: "assistant", content: input.renderedAssistantMsg },
  ];

  if (input.persistedMessages.length === 0) return fallback;
  if (input.persistedMessages.length < input.expectedPersistedCount) return fallback;

  const rows: PersistedTurnMessage[] = input.persistedMessages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role === "assistant" ? ("assistant" as const) : ("user" as const),
      content: message.content,
    }));
  if (rows.length === 0) return fallback;

  const window = rows.slice(-CLASSIFIER_TURN_WINDOW);
  if (isEmptyOrPlaceholderContent(input.renderedAssistantMsg)) return window;

  const lastAssistantIndex = window.map((message) => message.role).lastIndexOf("assistant");
  if (lastAssistantIndex === -1) return window;
  if (!isEmptyOrPlaceholderContent(window[lastAssistantIndex].content)) return window;

  // 画面の本文で差し替える。fallback へ落とすと前ターンの文脈まで失うため。
  return window.map((message, index) =>
    index === lastAssistantIndex ? { ...message, content: input.renderedAssistantMsg } : message,
  );
};
