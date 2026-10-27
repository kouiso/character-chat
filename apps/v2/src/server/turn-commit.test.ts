// @vitest-environment node
import { emptyLedger } from "@v2/prompt";
import { expect, it, vi } from "vitest";

import { withTurnCommit } from "./turn-commit";

import type { SaveTurnInput } from "@v2/db";
import type { TurnStore } from "@v2/engine";

const input: SaveTurnInput = {
  conversationId: "synthetic-room",
  turn: 4,
  userText: "synthetic",
  events: [],
  ledger: emptyLedger(),
};
it("同じ生成の再試行でも同じCAS条件をwriterへ渡し、拒否を握り潰さない", async () => {
  const writes: (SaveTurnInput & { commit?: { expectedTurn: number; writeId: string } })[] = [];
  const conflict = new Error("synthetic TurnCommitConflictError");
  const store: TurnStore = {
    load: async () => ({ turn: 4, history: [], ledger: emptyLedger() }),
    saveTurn: vi.fn(async (saved) => {
      writes.push(saved);
      throw conflict;
    }),
  };
  const committed = withTurnCommit(store, "synthetic-generation", 4);
  await expect(committed.saveTurn(input)).rejects.toBe(conflict);
  await expect(committed.saveTurn(input)).rejects.toBe(conflict);
  expect(writes.map((write) => write.commit)).toEqual([
    { expectedTurn: 4, writeId: "synthetic-generation" },
    { expectedTurn: 4, writeId: "synthetic-generation" },
  ]);
  expect(await committed.load(input.conversationId)).toMatchObject({ turn: 4 });
});
