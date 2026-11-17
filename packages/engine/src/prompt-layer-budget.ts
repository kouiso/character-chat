// 層ごとの字数上限と、指示文の使用字数の測り方（RIT-71）。
// 層は 7 つ: system（キャラの指示）・summary（あらすじ）・memory（記憶）・documents（設定資料）・
// persona（ユーザーの人物像）・history（過去の会話）・current（今回の入力）。
// 字数は string.length（UTF-16 単位）で、見出し・区切りまで全部数える。
import { MAX_SYSTEM_CHARS } from "@v2/prompt";

import { resolveContextBudget, type ContextBudget } from "./context-budget";
import { DOCUMENT_CONTEXT_CHARACTERS, MEMORY_CONTEXT_CHARACTERS } from "./memory-context";

import type { ComposedPrompt, ContextUsage } from "./types";

// あらすじ塊の見出し（「これまでのあらすじ:」10 字＋改行 1 字＝11 字）。compose と
// packSummaries・計測で同じ値を使う。
export const SUMMARY_BLOCK_HEADER = "これまでのあらすじ:\n";

// ユーザーの人物像塊の見出し（「【ユーザーについて】」10 字＋改行 1 字）。
// 本文は保存の時点で 2,000 字に切られとる（apps/v2 user-settings）ので層の上限は 2,011 字。
export const PERSONA_BLOCK_HEADER = "【ユーザーについて】\n";

export const PROMPT_LAYER_BUDGET = {
  system: MAX_SYSTEM_CHARS,
  summary: 2_500,
  memory: MEMORY_CONTEXT_CHARACTERS,
  documents: DOCUMENT_CONTEXT_CHARACTERS,
  persona: 2_011,
  history: 12_000,
  current: 4_000,
} as const;

// 全層の既定上限の合計。どれかの層の上限検査が抜けとっても、合計がこれを超える事は無いはず。
// 環境変数で層の上限を既定より上げた時に止める最後の網。
export const PROMPT_TOTAL_CHARACTERS = 30_511;

// 層の上限検査が抜けた（＝指示文が予算を超えた）時に投げる決定的な失敗。
// 黙って切り詰めんのがこの票の筋なので、ターンを失敗にして原因を残す。
export class PromptBudgetExceededError extends Error {
  readonly usage: ContextUsage;
  constructor(usage: ContextUsage) {
    super(`指示文が層の予算を超えた: ${usage.total} 字`);
    this.name = "PromptBudgetExceededError";
    this.usage = usage;
  }
}

// あらすじ塊に入れる要約本文を時系列順で選ぶ。合計は「見出し 11 字＋本文＋つなぎ改行」で
// summaryCharacters 以下。収まらん時は古い level 1 から外し、それでも収まらん時
// （例: level 2 だけで上限超え）は古い順に外す。1 本を途中で切らん。
export const packSummaries = (
  list: readonly { level: number; text: string }[],
  summaryCharacters: number,
): string[] => {
  let kept = [...list];
  const lengthOf = (entries: readonly { text: string }[]): number =>
    entries.length === 0
      ? 0
      : SUMMARY_BLOCK_HEADER.length + entries.map((entry) => entry.text).join("\n").length;
  while (kept.length > 0 && lengthOf(kept) > summaryCharacters) {
    const oldestLevel1 = kept.findIndex((entry) => entry.level === 1);
    kept = kept.filter((_, index) => index !== (oldestLevel1 === -1 ? 0 : oldestLevel1));
  }
  return kept.map((entry) => entry.text);
};

export type ContextMeasureParts = {
  // compose が指示文の先頭に置いた各層のメッセージ本文（未挿入は null）。
  // あらすじ・記憶・資料・人物像の順は固定で、計測は指示文の先頭からこの順に照合する。
  layers: {
    summary: string | null;
    memory: string | null;
    documents: string | null;
    persona: string | null;
  };
  // 実効予算（環境変数の反映後）。summary・history・current はこれで検査する。
  budget?: ContextBudget;
  omittedHistoryMessages: number;
  oldestIncludedTurn: number | null;
};

const LAYER_KEYS = ["summary", "memory", "documents", "persona"] as const;

// 指示文を層ごとに測る。計測と組み立てがずれとったら黙って通さず止める
// （ずれたまま記録すると、落ちた場所の切り分けに使う数字が嘘になる）。
export const measureContextUsage = (
  prompt: ComposedPrompt,
  parts: ContextMeasureParts,
): ContextUsage => {
  const usage: ContextUsage = {
    system: prompt.system.length,
    summary: 0,
    memory: 0,
    documents: 0,
    persona: 0,
    history: 0,
    current: 0,
    total: 0,
    omittedHistoryMessages: parts.omittedHistoryMessages,
    oldestIncludedTurn: parts.oldestIncludedTurn,
  };
  let cursor = 0;
  for (const key of LAYER_KEYS) {
    const block = parts.layers[key];
    if (block === null) continue;
    const message = prompt.messages[cursor];
    if (!message || message.content !== block) {
      throw new Error(`指示文と計測の層がずれとる（${key}）`);
    }
    usage[key] = block.length;
    cursor += 1;
  }
  const window = prompt.messages.slice(cursor);
  for (const message of window.slice(0, -1)) usage.history += message.content.length;
  usage.current = window.at(-1)?.content.length ?? 0;
  usage.total =
    usage.system +
    usage.summary +
    usage.memory +
    usage.documents +
    usage.persona +
    usage.history +
    usage.current;
  assertWithinLayerBudget(usage, parts.budget ?? resolveContextBudget());
  return usage;
};

const assertWithinLayerBudget = (usage: ContextUsage, budget: ContextBudget): void => {
  const limits: Record<
    Exclude<keyof ContextUsage, "total" | "omittedHistoryMessages" | "oldestIncludedTurn">,
    number
  > = {
    system: PROMPT_LAYER_BUDGET.system,
    summary: budget.summaryCharacters,
    memory: PROMPT_LAYER_BUDGET.memory,
    documents: PROMPT_LAYER_BUDGET.documents,
    persona: PROMPT_LAYER_BUDGET.persona,
    history: budget.historyCharacters,
    current: budget.currentMessageCharacters,
  };
  const exceeded =
    (Object.keys(limits) as (keyof typeof limits)[]).some((key) => usage[key] > limits[key]) ||
    usage.total > PROMPT_TOTAL_CHARACTERS;
  if (exceeded) throw new PromptBudgetExceededError(usage);
};
