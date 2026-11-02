import type { HistoryMessage } from "./types";

export const MEMORY_CONTEXT_CHARACTERS = 2_000;

export const withMemoryContext = (
  messages: HistoryMessage[],
  memories: readonly string[],
): HistoryMessage[] => {
  const selected: string[] = [];
  for (const memory of memories) {
    if (!memory.trim()) continue;
    const candidate = JSON.stringify({ savedMemories: [...selected, memory] });
    if (candidate.length <= MEMORY_CONTEXT_CHARACTERS) selected.push(memory);
  }
  // 保存した文はシステム指示に昇格させず、利用者の参考データとして履歴の前に置く。
  return selected.length === 0
    ? messages
    : [{ role: "user", content: JSON.stringify({ savedMemories: selected }) }, ...messages];
};
