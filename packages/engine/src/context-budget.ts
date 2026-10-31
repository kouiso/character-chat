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

export class ContextBudgetConfigError extends Error {
  constructor(name: string, value: unknown) {
    super(`${name} は0以上の整数で指定してください: ${JSON.stringify(String(value))}`);
    this.name = "ContextBudgetConfigError";
  }
}

export type ContextBudgetEnv = {
  V2_HISTORY_CHARACTERS?: unknown;
  V2_HISTORY_MESSAGES?: unknown;
};

// wrangler は env.<name>.vars に最上位の vars を引き継がんので、未設定・空は既定値へ戻す。
// 値がある時に読めんのは設定ミスなので、既定値へ黙って逃がさず止める。
const readBudgetVar = (name: string, raw: unknown): number | undefined => {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const value =
    typeof raw === "number"
      ? raw
      : typeof raw === "string" && /^\d+$/.test(raw)
        ? Number(raw)
        : NaN;
  if (!Number.isSafeInteger(value) || value < 0) throw new ContextBudgetConfigError(name, raw);
  return value;
};

export const contextBudgetFromEnv = (env: ContextBudgetEnv): Partial<ContextBudget> => {
  const historyCharacters = readBudgetVar("V2_HISTORY_CHARACTERS", env.V2_HISTORY_CHARACTERS);
  const historyMessages = readBudgetVar("V2_HISTORY_MESSAGES", env.V2_HISTORY_MESSAGES);
  return {
    ...(historyCharacters === undefined ? {} : { historyCharacters }),
    ...(historyMessages === undefined ? {} : { historyMessages }),
  };
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
