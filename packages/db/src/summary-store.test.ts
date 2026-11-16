// createD1SummaryStore をローカル D1（Miniflare）で回す（RIT-72）。
// v2_summary.conversation_id は v2_conversation への FK なので、先に saveTurn で
// 会話行を作る（seed 済み character を 1 件借りる）。
import { asc, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { characterTable } from "../../../src/schema/character";

import {
  applySummaryRedaction,
  createD1SummaryStore,
  dropSummary,
  listRedactPendingSummaries,
} from "./summary-store";
import { openLocalD1, type LocalD1 } from "./test/local-d1";
import { createD1TurnStore, type TurnEvent } from "./turn-store";
import { v2MemoryTombstoneTable, v2SummaryTable } from "./v2-schema";

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

const ONE_TURN: TurnEvent[] = [
  {
    type: "generation",
    generationId: crypto.randomUUID(),
    model: "fake-list",
    promptVersion: "v0001",
    systemPrompt: "system",
    request: [{ role: "user", content: "user" }],
    rawOutput: "<action>動作</action>",
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    latencyMs: 1,
    status: "ok",
  },
  {
    type: "chunk",
    seq: 1,
    text: "動作",
    judge: OK_JUDGE,
    attempt: 1,
    preExtend: true,
  },
];

const LEDGER: SceneLedger = {
  phase: "conversation",
  location: null,
  time: null,
  present: [],
  clothing: {},
  position: null,
  lastEvents: [],
  items: {},
};

describe("createD1SummaryStore", () => {
  let local: LocalD1;
  let conversationId = "";
  const createdConversationIds: string[] = [];

  beforeAll(async () => {
    local = await openLocalD1();
    const [character] = await local.db
      .select({ id: characterTable.id })
      .from(characterTable)
      .orderBy(asc(characterTable.displayOrder), asc(characterTable.createdAt))
      .limit(1);
    if (!character) {
      throw new Error("ローカル D1 に character が無い（pnpm db:migrate:local && pnpm db:seed）");
    }
    const turnStore = createD1TurnStore(local.db, {
      userId: "vitest",
      characterId: character.id,
      promptVersion: "v0001",
    });
    conversationId = `test-${crypto.randomUUID()}`;
    createdConversationIds.push(conversationId);
    await turnStore.saveTurn({
      conversationId,
      turn: 1,
      userText: "user 1",
      events: ONE_TURN,
      ledger: LEDGER,
    });
  });

  afterAll(async () => {
    await local.db
      .delete(v2SummaryTable)
      .where(inArray(v2SummaryTable.conversationId, createdConversationIds));
    await local.dispose();
  });

  it("保存した要約を coveredTo・level 順で読め、他会話と混ざらん", async () => {
    const store = createD1SummaryStore(local.db);
    // わざと順不同で入れても coveredTo → level の順で返ること。
    await store.save({ conversationId, level: 1, coveredTo: 40, text: "1段目b" });
    await store.save({ conversationId, level: 2, coveredTo: 20, text: "2段目" });
    await store.save({ conversationId, level: 1, coveredTo: 20, text: "1段目a" });
    expect(await store.list(conversationId)).toEqual([
      { level: 1, coveredTo: 20, text: "1段目a", redactPending: false },
      { level: 2, coveredTo: 20, text: "2段目", redactPending: false },
      { level: 1, coveredTo: 40, text: "1段目b", redactPending: false },
    ]);
    expect(await store.list("conv-none")).toEqual([]);
  });

  it("伏せ直し待ち・墓標の本文・書き戻し・行消しが動く（RIT-94）", async () => {
    const store = createD1SummaryStore(local.db);
    await store.save({ conversationId, level: 1, coveredTo: 50, text: "古い文" });

    // 削除が走った体でその会話の全要約を redact_pending に立てる
    await local.db
      .update(v2SummaryTable)
      .set({ redactPending: 1 })
      .where(inArray(v2SummaryTable.conversationId, [conversationId]));
    const pendings = await listRedactPendingSummaries(local.db, conversationId);
    expect(pendings.length).toBeGreaterThan(0);

    // 1行ずつ書き戻すと redact_pending が下りる（Queue 消費側と同じ手順）
    for (const row of pendings) {
      await applySummaryRedaction(local.db, row.id, `伏せ直し:${row.id}`);
    }
    expect(await listRedactPendingSummaries(local.db, conversationId)).toEqual([]);
    const listed = await store.list(conversationId);
    expect(listed.every((row) => !row.redactPending)).toBe(true);
    expect(listed.filter((row) => row.text.startsWith("伏せ直し:"))).toHaveLength(pendings.length);

    // 墓標の本文は読める（件数・字数に上限）
    await local.db.insert(v2MemoryTombstoneTable).values({
      conversationId,
      contentHash: `h-${crypto.randomUUID()}`,
      content: "消した本文",
      createdAt: Date.now(),
    });
    expect(await store.listForgotten(conversationId)).toContain("消した本文");

    // 限度まで失敗した要約は行ごと消す
    const doomed = `doomed-${crypto.randomUUID()}`;
    await local.db.insert(v2SummaryTable).values({
      id: doomed,
      conversationId,
      level: 1,
      coveredTo: 60,
      text: "消す要約",
      createdAt: Date.now(),
    });
    await dropSummary(local.db, doomed);
    expect(
      await local.db
        .select({ id: v2SummaryTable.id })
        .from(v2SummaryTable)
        .where(inArray(v2SummaryTable.id, [doomed])),
    ).toEqual([]);

    await local.db
      .delete(v2MemoryTombstoneTable)
      .where(inArray(v2MemoryTombstoneTable.conversationId, [conversationId]));
  });
});
