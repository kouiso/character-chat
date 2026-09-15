// テスト用の TurnStore 実装（インメモリ、永続化なし）。
// 本番実装（D1 版）は @v2/db 側が createD1TurnStore として提供する想定（M1）。
import { emptyLedger, type SceneLedger } from "@v2/prompt";

import type { HistoryMessage, TurnEvent, TurnStore } from "./types";

type StoredTurn = { userText: string; events: TurnEvent[]; ledger: SceneLedger };

export type MemoryTurnStore = TurnStore & { turns: Map<string, StoredTurn[]> };

const assistantTextOf = (events: TurnEvent[]): string =>
  events
    .filter((event): event is Extract<TurnEvent, { type: "chunk" }> => event.type === "chunk")
    .map((event) => event.text)
    .join("\n\n");

export const createMemoryTurnStore = (): MemoryTurnStore => {
  const turns = new Map<string, StoredTurn[]>();

  return {
    turns,
    load: async (conversationId) => {
      const existing = turns.get(conversationId) ?? [];
      const history: HistoryMessage[] = existing.flatMap((stored) => [
        { role: "user", content: stored.userText },
        { role: "assistant", content: assistantTextOf(stored.events) },
      ]);
      const ledger = existing.length > 0 ? existing[existing.length - 1].ledger : emptyLedger();
      return { history, ledger, turn: existing.length + 1 };
    },
    saveTurn: async (input) => {
      const list = turns.get(input.conversationId) ?? [];
      list.push({ userText: input.userText, events: input.events, ledger: input.ledger });
      turns.set(input.conversationId, list);
    },
  };
};
