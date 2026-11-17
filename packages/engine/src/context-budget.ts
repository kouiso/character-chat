import type { HistoryMessage } from "./types";

export type ContextBudget = {
  historyCharacters: number;
  historyMessages: number;
  currentMessageCharacters: number;
  // あらすじ（要約）層の上限。既定 2,500 字は仮の値（RIT-71 未決 2、
  // RIT-99 の 200 ターン試験で見直す）。
  summaryCharacters: number;
};

export const DEFAULT_CONTEXT_BUDGET: Readonly<ContextBudget> = {
  historyCharacters: 12_000,
  historyMessages: 40,
  currentMessageCharacters: 4_000,
  summaryCharacters: 2_500,
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
  V2_SUMMARY_CHARACTERS?: unknown;
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
  const summaryCharacters = readBudgetVar("V2_SUMMARY_CHARACTERS", env.V2_SUMMARY_CHARACTERS);
  return {
    ...(historyCharacters === undefined ? {} : { historyCharacters }),
    ...(historyMessages === undefined ? {} : { historyMessages }),
    ...(summaryCharacters === undefined ? {} : { summaryCharacters }),
  };
};

// 値が undefined の上書きは既定値を消さん。Partial は undefined を許すので、呼び出し側ごとに
// 気を付けるのやなく、ここで落とす。buildConversationContext と層の上限検査が同じ実効値を見る。
export const resolveContextBudget = (overrides: Partial<ContextBudget> = {}): ContextBudget => {
  const defined = Object.fromEntries(
    Object.entries(overrides).filter(([, value]) => value !== undefined),
  );
  return { ...DEFAULT_CONTEXT_BUDGET, ...defined };
};

export const buildConversationContext = (
  history: readonly HistoryMessage[],
  userText: string,
  overrides: Partial<ContextBudget> = {},
): {
  messages: HistoryMessage[];
  historyCharacters: number;
  omittedMessages: number;
  oldestIncludedTurn: number | null;
} => {
  const budget = resolveContextBudget(overrides);
  for (const value of Object.values(budget)) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error("Invalid context budget");
  }
  if (userText.length > budget.currentMessageCharacters) {
    throw new Error("Current message exceeds its context budget");
  }
  const { characters, selected } = selectHistoryWindow(history, budget);
  return {
    // turn は窓の境目を計る内部情報。request_json（送った messages[]）の形を変えんため、
    // 指示文へ渡す messages からは剥がす。
    messages: [
      ...selected.map((message) => ({ role: message.role, content: message.content })),
      { role: "user", content: userText },
    ],
    historyCharacters: characters,
    omittedMessages: history.length - selected.length,
    oldestIncludedTurn: selected[0]?.turn ?? null,
  };
};

const selectHistoryWindow = (
  history: readonly HistoryMessage[],
  budget: ContextBudget,
): { characters: number; selected: HistoryMessage[] } => {
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
  return { characters, selected };
};
