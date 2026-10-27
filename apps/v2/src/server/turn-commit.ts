import type { TurnStore } from "@v2/engine";

// 初回生成からalarm再試行まで同じ受付の書込み条件をwriterへ渡す。
export const withTurnCommit = (
  store: TurnStore,
  generationId: string,
  expectedTurn?: number,
): TurnStore => ({
  ...store,
  saveTurn: (input) => {
    const committed = {
      ...input,
      commit: { expectedTurn: expectedTurn ?? input.turn, writeId: generationId },
    };
    return store.saveTurn(committed);
  },
});
