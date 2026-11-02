import { emptyLedger } from "@v2/prompt";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { characterTable } from "../../../src/schema/character";

import {
  completeMemoryExtraction,
  listPendingMemoryJobs,
  loadMemoryExtractionSource,
} from "./memory-extraction-store";
import { openLocalD1, type LocalD1 } from "./test/local-d1";
import { createD1TurnStore } from "./turn-store";
import {
  v2ConversationTable,
  v2ChunkTable,
  v2GenerationTable,
  v2LedgerTable,
  v2MemoryJobTable,
  v2MemoryTable,
  v2MessageTable,
} from "./v2-schema";

import type { ExtractedMemory } from "./memory-extraction-contract";
import type { TurnEvent } from "./turn-store";

const owner = `memory-test-${crypto.randomUUID()}`;
const fact: ExtractedMemory = {
  kind: "preference",
  content: "紅茶が好き",
  importance: 3,
  validFrom: null,
  validUntil: null,
};
const reply: TurnEvent = {
  type: "chunk",
  seq: 0,
  text: "<dialogue>覚えておきます。</dialogue>",
  attempt: 1,
  preExtend: true,
  judge: {
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
  },
};

const generation = (status: "aborted" | "error"): TurnEvent => ({
  type: "generation",
  generationId: crypto.randomUUID(),
  model: "test",
  promptVersion: "test",
  systemPrompt: "system",
  request: [{ role: "user", content: "私は紅茶が好きです。" }],
  rawOutput: reply.text,
  usage: null,
  latencyMs: 1,
  status,
  ...(status === "aborted" ? { truncated: "deadline" } : { error: "generation failed" }),
});

describe("memory extraction store", () => {
  let local: LocalD1;
  let characterId: string;
  const ids: string[] = [];
  const scope = (conversationId: string) => ({ userId: owner, characterId, conversationId });
  const save = async (conversationId = crypto.randomUUID(), events: TurnEvent[] = [reply]) => {
    ids.push(conversationId);
    await createD1TurnStore(local.db, {
      userId: owner,
      characterId,
      promptVersion: "test",
      extractMemory: true,
    }).saveTurn({
      conversationId,
      turn: 1,
      userText: "私は紅茶が好きです。",
      ledger: emptyLedger(),
      events,
    });
    return conversationId;
  };
  beforeAll(async () => {
    local = await openLocalD1();
    const [character] = await local.db
      .select({ id: characterTable.id })
      .from(characterTable)
      .limit(1);
    characterId = character.id;
  }, 120_000);
  afterAll(async () => {
    const messages = local.db
      .select({ id: v2MessageTable.id })
      .from(v2MessageTable)
      .where(inArray(v2MessageTable.conversationId, ids));
    await local.db.batch([
      local.db.delete(v2MemoryTable).where(inArray(v2MemoryTable.conversationId, ids)),
      local.db.delete(v2ChunkTable).where(inArray(v2ChunkTable.messageId, messages)),
      local.db.delete(v2MessageTable).where(inArray(v2MessageTable.conversationId, ids)),
      local.db.delete(v2LedgerTable).where(inArray(v2LedgerTable.conversationId, ids)),
      local.db.delete(v2GenerationTable).where(inArray(v2GenerationTable.conversationId, ids)),
      local.db.delete(v2ConversationTable).where(inArray(v2ConversationTable.id, ids)),
    ]);
    await local.dispose();
  });

  it("確定ターンだけ予約し、利用者・キャラ・会話の境界を保つ", async () => {
    const id = await save();
    expect(await listPendingMemoryJobs(local.db, scope(id))).toHaveLength(1);
    expect(await listPendingMemoryJobs(local.db, { ...scope(id), userId: "other" })).toEqual([]);
    expect(await listPendingMemoryJobs(local.db, { ...scope(id), characterId: "other" })).toEqual(
      [],
    );
    expect(
      await listPendingMemoryJobs(local.db, { ...scope(id), conversationId: "other" }),
    ).toEqual([]);
    expect(await listPendingMemoryJobs(local.db, scope(await save(undefined, [])))).toEqual([]);
  });

  it("非空の中断ターンを予約し、明示的な失敗と空応答は除外する", async () => {
    const abortedId = await save(crypto.randomUUID(), [generation("aborted"), reply]);
    expect(await listPendingMemoryJobs(local.db, scope(abortedId))).toHaveLength(1);

    const blankId = await save(crypto.randomUUID(), [
      generation("aborted"),
      { ...reply, text: " \n\t " },
    ]);
    expect(await listPendingMemoryJobs(local.db, scope(blankId))).toEqual([]);

    const failedId = await save(crypto.randomUUID(), [generation("error"), reply]);
    expect(await listPendingMemoryJobs(local.db, scope(failedId))).toEqual([]);
  });

  it("同時配送でも重複せず、削除済みの記憶を再配送で復活させない", async () => {
    const id = await save();
    const [job] = await listPendingMemoryJobs(local.db, scope(id));
    const source = await loadMemoryExtractionSource(local.db, job.id);
    if (!source) throw new Error("source missing");
    await Promise.all([
      completeMemoryExtraction(local.db, source, [fact]),
      completeMemoryExtraction(local.db, source, [fact]),
    ]);
    const rows = await local.db
      .select()
      .from(v2MemoryTable)
      .where(eq(v2MemoryTable.conversationId, id));
    expect(rows).toHaveLength(1);
    await local.db.delete(v2MemoryTable).where(eq(v2MemoryTable.conversationId, id));
    await completeMemoryExtraction(local.db, source, [fact]);
    expect(
      await local.db.select().from(v2MemoryTable).where(eq(v2MemoryTable.conversationId, id)),
    ).toEqual([]);
    expect(await loadMemoryExtractionSource(local.db, job.id)).toBeNull();
  });

  it("推論中に書き換わった元発言からは記憶を保存しない", async () => {
    const id = await save();
    const [job] = await listPendingMemoryJobs(local.db, scope(id));
    const source = await loadMemoryExtractionSource(local.db, job.id);
    if (!source) throw new Error("source missing");
    await local.db
      .update(v2MessageTable)
      .set({ content: "今はコーヒーが好きです。" })
      .where(eq(v2MessageTable.id, source.sourceMessageId));
    await completeMemoryExtraction(local.db, source, [fact]);
    expect(
      await local.db.select().from(v2MemoryTable).where(eq(v2MemoryTable.conversationId, id)),
    ).toEqual([]);
    const [failed] = await local.db
      .select()
      .from(v2MemoryJobTable)
      .where(eq(v2MemoryJobTable.id, job.id));
    expect(failed.errorCode).toBe("source_changed");
  });

  it("ターン置換で元の記憶を消し、古いQueue配送を無効にする", async () => {
    const id = await save();
    const [job] = await listPendingMemoryJobs(local.db, scope(id));
    const source = await loadMemoryExtractionSource(local.db, job.id);
    if (!source) throw new Error("source missing");
    await completeMemoryExtraction(local.db, source, [fact]);
    await save(id);
    expect(await loadMemoryExtractionSource(local.db, job.id)).toBeNull();
    expect(
      await local.db.select().from(v2MemoryTable).where(eq(v2MemoryTable.conversationId, id)),
    ).toEqual([]);
    expect(await listPendingMemoryJobs(local.db, scope(id))).toHaveLength(1);
  });

  it("抽出予約に失敗すると会話の保存もロールバックする", async () => {
    await local.d1.exec(
      "CREATE TRIGGER memory_test_abort BEFORE INSERT ON v2_memory_job WHEN NEW.conversation_id = 'memory-test-rollback' BEGIN SELECT RAISE(ABORT, 'test failure'); END",
    );
    try {
      await expect(save("memory-test-rollback")).rejects.toThrow();
      expect(
        await local.db
          .select()
          .from(v2ConversationTable)
          .where(eq(v2ConversationTable.id, "memory-test-rollback")),
      ).toEqual([]);
    } finally {
      await local.d1.exec("DROP TRIGGER memory_test_abort");
    }
  });
});
