import type { ComposedPrompt, HistoryMessage } from "./types";

export type ContextBudget = {
  systemChars: number;
  recentChars: number;
  instructionChars: number;
};

export const DEFAULT_CONTEXT_BUDGET: Readonly<ContextBudget> = Object.freeze({
  systemChars: 4000,
  recentChars: 8000,
  instructionChars: 2000,
});

export type ContextUsage = {
  systemChars: number;
  recentChars: number;
  instructionChars: number;
  totalChars: number;
  omittedMessages: number;
  truncatedLatest: boolean;
  truncatedInstruction: boolean;
};

export const resolveContextBudget = (overrides: Partial<ContextBudget> = {}): ContextBudget => {
  const budget = { ...DEFAULT_CONTEXT_BUDGET, ...overrides };
  for (const [layer, chars] of Object.entries(budget)) {
    const minimum = layer === "systemChars" ? 0 : 1;
    if (!Number.isSafeInteger(chars) || chars < minimum)
      throw new RangeError(`${layer} must be a safe integer >= ${minimum}`);
  }
  if (!Number.isSafeInteger(budget.systemChars + budget.recentChars + budget.instructionChars))
    throw new RangeError("Total context budget must be a safe integer");
  return budget;
};

// UTF-16 の途中で切らんよう、予算はコードポイントで数える。巨大入力も配列へ展開せん。
const charsWithin = (text: string, limit: number): number => {
  let chars = 0;
  const points = text[Symbol.iterator]();
  while (chars <= limit && !points.next().done) chars += 1;
  return chars;
};

const tailWithin = (text: string, limit: number): string => {
  let start = text.length;
  let remaining = limit;
  while (start > 0 && remaining > 0) {
    start -= 1;
    const unit = text.charCodeAt(start);
    const previous = text.charCodeAt(start - 1);
    if (unit >= 0xdc00 && unit <= 0xdfff && previous >= 0xd800 && previous <= 0xdbff) start -= 1;
    remaining -= 1;
  }
  return text.slice(start);
};

type RecentWindow = Pick<ContextUsage, "recentChars" | "omittedMessages" | "truncatedLatest"> & {
  messages: HistoryMessage[];
};

export const selectRecentMessages = (
  messages: readonly HistoryMessage[],
  maxChars: number,
): RecentWindow => {
  if (!Number.isSafeInteger(maxChars) || maxChars < 1)
    throw new RangeError("Recent message budget must be a positive safe integer");
  const selected: HistoryMessage[] = [];
  let recentChars = 0;
  let truncatedLatest = false;
  let index = messages.length - 1;
  while (index >= 0) {
    const message = messages[index];
    const chars = charsWithin(message.content, maxChars - recentChars);
    if (chars + recentChars > maxChars) {
      // 履歴に穴を空けん。最新一通だけは末尾を残し、元の入力・保存内容は書き換えん。
      if (selected.length === 0) {
        selected.push({ ...message, content: tailWithin(message.content, maxChars) });
        recentChars = maxChars;
        truncatedLatest = true;
      }
      break;
    }
    selected.push({ ...message });
    recentChars += chars;
    index -= 1;
  }
  return {
    messages: selected.reverse(),
    recentChars,
    omittedMessages: messages.length - selected.length,
    truncatedLatest,
  };
};

export const composeContextPrompt = (
  input: {
    system: string;
    messages: readonly HistoryMessage[];
    instruction?: string;
  },
  overrides: Partial<ContextBudget> = {},
): ComposedPrompt => {
  const budget = resolveContextBudget(overrides);
  const systemChars = charsWithin(input.system, budget.systemChars);
  // 人格と出力契約は途中切断できんため、設定が小さすぎる場合はモデル呼出し前に拒否する。
  if (systemChars > budget.systemChars) throw new RangeError("System context exceeds its budget");
  const recent = selectRecentMessages(input.messages, budget.recentChars);
  const instruction =
    input.instruction === undefined
      ? undefined
      : tailWithin(input.instruction, budget.instructionChars);
  const instructionChars = charsWithin(instruction ?? "", budget.instructionChars);
  const messages = [...recent.messages];
  if (instruction !== undefined) messages.push({ role: "user", content: instruction });
  return {
    version: "v0001",
    system: input.system,
    messages,
    contextUsage: {
      systemChars,
      recentChars: recent.recentChars,
      instructionChars,
      totalChars: systemChars + recent.recentChars + instructionChars,
      omittedMessages: recent.omittedMessages,
      truncatedLatest: recent.truncatedLatest,
      truncatedInstruction: instruction !== input.instruction,
    },
  };
};
