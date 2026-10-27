import { splitChunks } from "@v2/judge";
import { emptyLedger } from "@v2/prompt";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { loadChunkDeliveries } from "./chunk-delivery";
import { scheduleChunks } from "./chunk-schedule";
import { openChunkD1 } from "./test/chunk-d1";
import { createD1TurnStore, type TurnEvent, type TurnStore } from "./turn-store";

import type { LocalD1 } from "./test/local-d1";
import type { JudgeResult } from "@v2/judge";

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

const eventsFor = (raw: string): TurnEvent[] =>
  splitChunks(raw).map((text, seq) => ({
    type: "chunk",
    seq,
    text,
    judge: OK_JUDGE,
    attempt: 1,
    preExtend: true,
  }));

describe("chunk scheduling through saveTurn", () => {
  let local: LocalD1;
  let store: TurnStore;
  const base = 1_800_000_000_000;

  beforeAll(async () => {
    local = await openChunkD1();
    store = createD1TurnStore(local.db, {
      userId: "synthetic",
      characterId: "rit-67-synthetic",
      promptVersion: "synthetic",
    });
  });

  afterEach(() => vi.restoreAllMocks());

  afterAll(async () => {
    await local?.dispose();
  });

  const rowsFor = async (conversationId: string) =>
    (
      await local.d1
        .prepare(
          "SELECT c.seq, c.text, c.scheduled_at FROM v2_chunk c JOIN v2_message m ON m.id = c.message_id WHERE m.conversation_id = ? ORDER BY c.seq",
        )
        .bind(conversationId)
        .all<{ seq: number; text: string; scheduled_at: number }>()
    ).results;

  const save = async (conversationId: string, raw: string, events = eventsFor(raw)) =>
    store.saveTurn({ conversationId, turn: 1, userText: "fixture", events, ledger: emptyLedger() });

  it("stores two split chunks with proportional scheduled times", async () => {
    vi.spyOn(Date, "now").mockReturnValue(base);
    const batch = vi.spyOn(local.db, "batch");
    await save("rit-67-two", "a\n\nbb\n\nc");
    expect((await rowsFor("rit-67-two")).map((row) => row.scheduled_at)).toEqual([
      base,
      base + 40,
      base + 120,
    ]);
    expect(batch).toHaveBeenCalledTimes(1);
  });

  it.each(["", " \n\n ", "x", "🙂", "a".repeat(200_000)])(
    "keeps edge replies valid (case %#)",
    async (raw) => {
      vi.spyOn(Date, "now").mockReturnValue(base);
      const id = crypto.randomUUID();
      await save(id, raw);
      const rows = await rowsFor(id);
      expect(rows.map((row) => row.text)).toEqual(splitChunks(raw));
      expect(rows.every((row) => row.scheduled_at === base)).toBe(true);
      expect((await store.load(id)).history[1].content).toBe(splitChunks(raw).join("\n\n"));
    },
  );

  it("orders accepted chunks by seq and caps the gap after a long chunk", async () => {
    vi.spyOn(Date, "now").mockReturnValue(base);
    const events = eventsFor("a".repeat(200_000) + "\n\nx\n\ny");
    const first = events[0];
    const last = events[2];
    await save("rit-67-order", "", [
      last,
      { type: "dropped", seq: 1, reasons: ["synthetic"], attempt: 2 },
      first,
    ]);
    const rows = await rowsFor("rit-67-order");
    expect(rows.map((row) => row.seq)).toEqual([0, 2]);
    expect(rows.map((row) => row.scheduled_at)).toEqual([base, base + 3_000]);
    expect(events[0]).toBe(first);
  });

  it("preserves the anchor across repeated saves and recomputes changed chunk text", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(base);
    await save("rit-67-replay", "a\n\nbb");
    const before = await rowsFor("rit-67-replay");
    clock.mockReturnValue(base + 60_000);
    await save("rit-67-replay", "a\n\nbb");
    expect(await rowsFor("rit-67-replay")).toEqual(before);
    clock.mockReturnValue(base + 120_000);
    await save("rit-67-replay", "abc\n\nd");
    expect((await rowsFor("rit-67-replay")).map((row) => row.scheduled_at)).toEqual([
      base,
      base + 120,
    ]);
    expect((await store.load("rit-67-replay")).turn).toBe(2);
  });

  it("atomically fixes the anchor when concurrent reprocessing reaches the save barrier", async () => {
    const originalBatch = local.db.batch.bind(local.db);
    let bothReady: () => void = () => undefined;
    let firstFinished: () => void = () => undefined;
    const barrier = new Promise<void>((resolve) => {
      bothReady = resolve;
    });
    const firstDone = new Promise<void>((resolve) => {
      firstFinished = resolve;
    });
    let arrivals = 0;
    vi.spyOn(local.db, "batch").mockImplementation(async (statements) => {
      const index = arrivals++;
      if (index === 0) {
        await barrier;
        try {
          return await originalBatch(statements);
        } finally {
          firstFinished();
        }
      }
      bothReady();
      await firstDone;
      return originalBatch(statements);
    });
    const clock = vi.spyOn(Date, "now").mockReturnValue(base);
    const first = save("rit-67-concurrent", "a\n\nbb");
    clock.mockReturnValue(base + 60_000);
    const second = save("rit-67-concurrent", "a\n\nbb");
    const receipts = await Promise.all([first, second]);
    expect(arrivals).toBe(2);
    expect((await rowsFor("rit-67-concurrent")).map((row) => row.scheduled_at)).toEqual([
      base,
      base + 40,
    ]);
    for (const receipt of receipts)
      expect(receipt).toMatchObject({
        chunks: [{ scheduledAt: base }, { scheduledAt: base + 40 }],
      });
  });

  it("rolls back a failed replacement including its schedules", async () => {
    vi.spyOn(Date, "now").mockReturnValue(base);
    await save("rit-67-rollback", "a\n\nbb");
    const before = await rowsFor("rit-67-rollback");
    const duplicate = eventsFor("c")[0];
    await expect(save("rit-67-rollback", "", [duplicate, duplicate])).rejects.toThrow();
    expect(await rowsFor("rit-67-rollback")).toEqual(before);
    expect((await store.load("rit-67-rollback")).history[1].content).toBe("a\n\nbb");
  });

  it("returns persisted delivery data only after successful batch", async () => {
    vi.spyOn(Date, "now").mockReturnValue(base);
    const delivery = await save("rit-67-receipt", "a\n\nbb");
    expect(delivery).toEqual({
      conversationId: "rit-67-receipt",
      turn: 1,
      generationId: null,
      serverNow: base,
      chunks: [
        { seq: 0, text: "a", scheduledAt: base },
        { seq: 1, text: "bb", scheduledAt: base + 40 },
      ],
    });
    const owner = {
      userId: "synthetic",
      characterId: "rit-67-synthetic",
      conversationId: "rit-67-receipt",
    };
    expect(await loadChunkDeliveries(local.db, owner)).toEqual([delivery]);
    expect(await loadChunkDeliveries(local.db, { ...owner, userId: "other" })).toBeNull();
    expect(await loadChunkDeliveries(local.db, { ...owner, characterId: "other" })).toBeNull();
    expect(await loadChunkDeliveries(local.db, { ...owner, conversationId: "missing" })).toBeNull();
  });

  it("reads legacy unscheduled rows as immediately available without changing them", async () => {
    vi.spyOn(Date, "now").mockReturnValue(base);
    await save("rit-67-legacy", "legacy");
    await local.d1
      .prepare(
        "UPDATE v2_chunk SET scheduled_at = NULL WHERE message_id IN (SELECT id FROM v2_message WHERE conversation_id = ?)",
      )
      .bind("rit-67-legacy")
      .run();
    const deliveries = await loadChunkDeliveries(local.db, {
      userId: "synthetic",
      characterId: "rit-67-synthetic",
      conversationId: "rit-67-legacy",
    });
    expect(deliveries?.[0].chunks[0].scheduledAt).toBe(base);
  });

  it("adopts an existing assistant timestamp atomically when upgrading a saved turn", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(base);
    await save("rit-67-upgrade", "a\n\nbb");
    await local.d1
      .prepare("DELETE FROM v2_turn_delivery WHERE conversation_id = ?")
      .bind("rit-67-upgrade")
      .run();
    clock.mockReturnValue(base + 60_000);
    await save("rit-67-upgrade", "a\n\nbb");
    expect((await rowsFor("rit-67-upgrade")).map((row) => row.scheduled_at)).toEqual([
      base,
      base + 40,
    ]);
  });

  it("uses the generation id from persisted messages in delivery and recovery snapshots", async () => {
    const generationId = crypto.randomUUID();
    const delivery = await save("rit-67-generation", "", [
      {
        type: "generation",
        generationId,
        model: "synthetic",
        promptVersion: "synthetic",
        systemPrompt: "fixture",
        request: [],
        rawOutput: "fixture",
        usage: null,
        latencyMs: 1,
        status: "ok",
      },
      ...eventsFor("fixture"),
    ]);
    expect(delivery).toMatchObject({ generationId });
    const recovered = await loadChunkDeliveries(local.db, {
      userId: "synthetic",
      characterId: "rit-67-synthetic",
      conversationId: "rit-67-generation",
    });
    expect(recovered?.[0].generationId).toBe(generationId);
  });

  it("keeps each receipt tied to its own transaction when a later writer replaces the turn", async () => {
    const originalBatch = local.db.batch.bind(local.db);
    let firstWritten: () => void = () => undefined;
    let secondWritten: () => void = () => undefined;
    const firstDone = new Promise<void>((resolve) => {
      firstWritten = resolve;
    });
    const secondDone = new Promise<void>((resolve) => {
      secondWritten = resolve;
    });
    let arrivals = 0;
    vi.spyOn(local.db, "batch").mockImplementation(async (statements) => {
      const index = arrivals++;
      const result = await originalBatch(statements);
      if (index === 0) {
        firstWritten();
        await secondDone;
      } else secondWritten();
      return result;
    });
    const withGeneration = (generationId: string, text: string): TurnEvent[] => [
      {
        type: "generation",
        generationId,
        model: "synthetic",
        promptVersion: "synthetic",
        systemPrompt: "fixture",
        request: [],
        rawOutput: text,
        usage: null,
        latencyMs: 1,
        status: "ok",
      },
      ...eventsFor(text),
    ];
    const generationA = crypto.randomUUID();
    const generationB = crypto.randomUUID();
    const clock = vi.spyOn(Date, "now").mockReturnValue(base);
    const first = save("rit-67-receipt-race", "", withGeneration(generationA, "first"));
    await firstDone;
    clock.mockReturnValue(base + 1_000);
    const second = save("rit-67-receipt-race", "", withGeneration(generationB, "second"));
    const receipts = await Promise.all([first, second]);
    expect(receipts[0]).toMatchObject({
      generationId: generationA,
      chunks: [{ text: "first", scheduledAt: base }],
    });
    expect(receipts[1]).toMatchObject({
      generationId: generationB,
      chunks: [{ text: "second", scheduledAt: base }],
    });
    const recovered = await loadChunkDeliveries(local.db, {
      userId: "synthetic",
      characterId: "rit-67-synthetic",
      conversationId: "rit-67-receipt-race",
    });
    expect(recovered?.[0]).toMatchObject({
      generationId: generationB,
      chunks: [{ text: "second", scheduledAt: base }],
    });
  });

  it("persists only rejection reasons for dropped chunks and replaces their audit atomically", async () => {
    vi.spyOn(Date, "now").mockReturnValue(base);
    const dropped: TurnEvent = {
      type: "dropped",
      seq: 3,
      reasons: ["synthetic-repeat", "synthetic-format"],
      attempt: 2,
    };
    const delivery = await save("rit-70-rejected", "", [dropped]);
    expect(delivery).toMatchObject({ chunks: [] });
    expect(await rowsFor("rit-70-rejected")).toEqual([]);
    const audits = () =>
      local.d1
        .prepare(
          "SELECT r.seq, r.attempt, r.reasons_json FROM v2_chunk_rejection r JOIN v2_message m ON m.id = r.message_id WHERE m.conversation_id = ?",
        )
        .bind("rit-70-rejected")
        .all();
    expect((await audits()).results).toEqual([
      { seq: 3, attempt: 2, reasons_json: JSON.stringify(dropped.reasons) },
    ]);
    await expect(save("rit-70-rejected", "", [dropped, dropped])).rejects.toThrow();
    expect((await audits()).results).toHaveLength(1);
    await save("rit-70-rejected", "accepted");
    expect((await audits()).results).toEqual([]);
    expect((await rowsFor("rit-70-rejected")).map((row) => row.text)).toEqual(["accepted"]);
  });
});

describe("scheduleChunks", () => {
  it("counts visible Unicode characters and leaves the input untouched", () => {
    const chunks = [
      { seq: 2, text: "end" },
      { seq: 0, text: "<dialogue>🙂あ</dialogue>" },
    ];
    expect(scheduleChunks(chunks, 1_000).map((chunk) => chunk.scheduledAt)).toEqual([1_000, 1_080]);
    expect(chunks).toEqual([
      { seq: 2, text: "end" },
      { seq: 0, text: "<dialogue>🙂あ</dialogue>" },
    ]);
  });

  it("handles empty chunk lists and empty chunk text", () => {
    expect(scheduleChunks([], 1_000)).toEqual([]);
    expect(
      scheduleChunks(
        [
          { seq: 0, text: "" },
          { seq: 1, text: "x" },
        ],
        1_000,
      ).map((chunk) => chunk.scheduledAt),
    ).toEqual([1_000, 1_040]);
  });

  it.each([NaN, Infinity, -1, 0.5, 8_640_000_000_000_001])(
    "rejects invalid anchor %s",
    (anchor) => {
      expect(() => scheduleChunks([{ seq: 0, text: "x" }], anchor)).toThrow(RangeError);
    },
  );

  it("rejects timestamp overflow", () => {
    expect(() =>
      scheduleChunks(
        [
          { seq: 0, text: "x" },
          { seq: 1, text: "y" },
        ],
        8_640_000_000_000_000,
      ),
    ).toThrow(RangeError);
  });
});
