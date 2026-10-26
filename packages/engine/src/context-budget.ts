import type { HistoryMessage } from "./types";

export type ContextBudget = {
  historyCharacters: number;
  historyMessages: number;
  currentMessageCharacters: number;
};

export const DEFAULT_CONTEXT_BUDGET: Readonly<ContextBudget> = {
  historyCharacters: 12_000,
  historyMessages: 40,
  currentMessageCharacters: 4_000,
};

export const buildConversationContext = (
  history: readonly HistoryMessage[],
  userText: string,
  overrides: Partial<ContextBudget> = {},
): { messages: HistoryMessage[]; historyCharacters: number; omittedMessages: number } => {
  const budget = { ...DEFAULT_CONTEXT_BUDGET, ...overrides };
  for (const value of Object.values(budget)) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error("Invalid context budget");
  }
  if (userText.length > budget.currentMessageCharacters) {
    throw new Error("Current message exceeds its context budget");
  }
  let characters = 0;
  const selected: HistoryMessage[] = [];
  for (let index = history.length - 1; index >= 0; index--) {
    const message = history[index];
    if (
      selected.length >= budget.historyMessages ||
      characters + message.content.length > budget.historyCharacters
    )
      break;
    characters += message.content.length;
    selected.push(message);
  }
  selected.reverse();
  return {
    messages: [...selected, { role: "user", content: userText }],
    historyCharacters: characters,
    omittedMessages: history.length - selected.length,
  };
};
