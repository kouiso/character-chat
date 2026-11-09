import { asc } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { characterTable } from "../../../src/schema/character";

import { openLocalD1, type LocalD1 } from "./test/local-d1";
import { createD1TurnStore, type TurnEvent } from "./turn-store";
import { countUserTurnsSince } from "./usage-store";

import type { JudgeResult } from "@v2/judge";
import type { SceneLedger } from "@v2/prompt";

const OK_JUDGE: JudgeResult = {
  ok: true,
  reasons: [],
  warnings: [],
  checks: {
    ngram: { ok: true, ratio: 0, matchedPhrases: [], exactRepeat: false },
    nearDuplicate: { ok: true, matches: [] },
    voice: { ok: true, endingsMismatch: false },
    format: { ok: true },
    empty: { ok: true },
  },
};

const events = (id: string): TurnEvent[] => [
  {
    type: "generation",
    generationId: id,
    model: "fake-list",
    promptVersion: "v0001",
    systemPrompt: "system",
    request: [{ role: "user", content: "user" }],
    rawOutput: "<action>動作</action>",
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    latencyMs: 1,
    status: "ok",
  },
  { type: "chunk", seq: 1, text: "動作", judge: OK_JUDGE, attempt: 1, preExtend: true },
];

const LEDGER: SceneLedger = {
  phase: "conversation",
  location: null,
  time: null,
  present: [],
  clothing: {},
  position: null,
  lastEvents: [],
};

describe("countUserTurnsSince", () => {
  let local: LocalD1;
  const userId = `usage-${crypto.randomUUID()}`;
  const conversationId = `conv-${crypto.randomUUID()}`;

  beforeAll(async () => {
    local = await openLocalD1();
    const [character] = await local.db
      .select({ id: characterTable.id })
      .from(characterTable)
      .orderBy(asc(characterTable.displayOrder), asc(characterTable.createdAt))
      .limit(1);
    const store = createD1TurnStore(local.db, {
      userId,
      characterId: character?.id ?? "missing",
      promptVersion: "v0001",
    });
    for (let turn = 1; turn <= 3; turn++) {
      await store.saveTurn({
        conversationId,
        turn,
        userText: `発言${turn}`,
        events: events(crypto.randomUUID()),
        ledger: LEDGER,
      });
    }
  });

  afterAll(async () => {
    await local.dispose();
  });

  it("ユーザー発言だけを数える（assistant 行は含まん）", async () => {
    const n = await countUserTurnsSince(local.db, { userId, sinceMs: 0 });
    expect(n).toBe(3);
  });

  it("別ユーザーの発言は数えん", async () => {
    const n = await countUserTurnsSince(local.db, { userId: "other-user", sinceMs: 0 });
    expect(n).toBe(0);
  });

  it("sinceMs 以降だけを数える（未来なら 0）", async () => {
    const n = await countUserTurnsSince(local.db, { userId, sinceMs: Date.now() + 60_000 });
    expect(n).toBe(0);
  });
});
