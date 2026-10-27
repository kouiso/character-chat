import { emptyLedger } from "@v2/prompt";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { openChunkD1 } from "./test/chunk-d1";
import { ConversationAccessError, createD1TurnStore, TurnCommitConflictError } from "./turn-store";

import type { LocalD1 } from "./test/local-d1";
import type { ChunkDelivery, SaveTurnInput, TurnEvent } from "./turn-store";
import type { JudgeResult } from "@v2/judge";

const JUDGE: JudgeResult = {
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

const events = (id: string, text = "合成応答"): TurnEvent[] => [
  {
    type: "generation",
    generationId: id,
    model: "synthetic-model",
    promptVersion: "synthetic",
    systemPrompt: "synthetic-system",
    request: [{ role: "user", content: "synthetic-input" }],
    rawOutput: text,
    usage: null,
    latencyMs: 1,
    status: "ok",
  },
  { type: "chunk", seq: 0, text, judge: JUDGE, attempt: 1, preExtend: true },
  { type: "chunk", seq: 1, text: "次の合成応答", judge: JUDGE, attempt: 1, preExtend: true },
];

const input = (conversationId: string, writeId: string, turn = 1): SaveTurnInput => ({
  conversationId,
  turn,
  userText: "synthetic-input",
  events: events(writeId),
  ledger: emptyLedger(),
  commit: { expectedTurn: turn, writeId },
});

const withoutNow = (delivery: void | ChunkDelivery) => {
  if (!delivery) throw new Error("合成配送の保存に失敗");
  return {
    conversationId: delivery.conversationId,
    turn: delivery.turn,
    generationId: delivery.generationId,
    chunks: delivery.chunks,
  };
};

describe("D1 turn commit CAS", () => {
  let local: LocalD1;
  const options = {
    userId: "synthetic-owner",
    characterId: "rit-67-synthetic",
    promptVersion: "synthetic",
  };
  const store = () => createD1TurnStore(local.db, options);
  const id = () => `cas-${crypto.randomUUID()}`;

  beforeAll(async () => {
    local = await openChunkD1();
    await local.d1.prepare("INSERT INTO character (id) VALUES ('synthetic-other-character')").run();
  });

  afterAll(async () => local?.dispose());

  const snapshot = async (conversationId: string) => {
    const result = await local.d1.batch([
      local.d1.prepare("SELECT * FROM v2_conversation WHERE id = ?").bind(conversationId),
      local.d1
        .prepare("SELECT * FROM v2_message WHERE conversation_id = ? ORDER BY role,turn")
        .bind(conversationId),
      local.d1
        .prepare(
          "SELECT * FROM v2_chunk WHERE message_id IN (SELECT id FROM v2_message WHERE conversation_id = ?) ORDER BY seq",
        )
        .bind(conversationId),
      local.d1
        .prepare("SELECT * FROM v2_generation WHERE conversation_id = ? ORDER BY turn")
        .bind(conversationId),
      local.d1
        .prepare("SELECT * FROM v2_ledger WHERE conversation_id = ? ORDER BY turn")
        .bind(conversationId),
      local.d1
        .prepare("SELECT * FROM v2_turn_commit WHERE conversation_id = ? ORDER BY turn")
        .bind(conversationId),
      local.d1
        .prepare("SELECT * FROM v2_turn_delivery WHERE conversation_id = ? ORDER BY turn")
        .bind(conversationId),
    ]);
    return result.map((rows) => rows.results);
  };

  it("同一 owner の異なる generation が同じ next turn を競合保存しても一方だけ確定する", async () => {
    const conversationId = id();
    const attempts = [input(conversationId, id()), input(conversationId, id())];
    const results = await Promise.allSettled(attempts.map((attempt) => store().saveTurn(attempt)));
    const winner = results.findIndex((result) => result.status === "fulfilled");
    const loser = results.find((result) => result.status === "rejected");
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(loser?.status === "rejected" && loser.reason).toBeInstanceOf(TurnCommitConflictError);
    const saved = await store().load(conversationId);
    expect(saved.turn).toBe(2);
    const snapshotRows = await snapshot(conversationId);
    expect(snapshotRows[1]).toHaveLength(2);
    expect(snapshotRows[2]).toHaveLength(2);
    expect(snapshotRows[3]).toMatchObject([{ id: attempts[winner].commit?.writeId }]);
    expect(snapshotRows[5]).toHaveLength(1);
  });

  it("初回の異なる owner 同士の競合で所有者を奪わず、敗者は読めない", async () => {
    const conversationId = id();
    const stores = [
      store(),
      createD1TurnStore(local.db, { ...options, userId: "synthetic-other-owner" }),
    ];
    const results = await Promise.allSettled(
      stores.map((candidate) => candidate.saveTurn(input(conversationId, id()))),
    );
    const winner = results.findIndex((result) => result.status === "fulfilled");
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const loser = results[1 - winner];
    expect(loser.status === "rejected" && loser.reason).toBeInstanceOf(ConversationAccessError);
    await expect(stores[1 - winner].load(conversationId)).rejects.toBeInstanceOf(
      ConversationAccessError,
    );
    expect((await stores[winner].load(conversationId)).history).toHaveLength(2);
  });

  it("同一 user でも別 character の読み書きは全 transaction を拒否する", async () => {
    const conversationId = id();
    await store().saveTurn(input(conversationId, id()));
    const before = await snapshot(conversationId);
    const other = createD1TurnStore(local.db, {
      ...options,
      characterId: "synthetic-other-character",
    });
    await expect(other.load(conversationId)).rejects.toBeInstanceOf(ConversationAccessError);
    await expect(other.saveTurn(input(conversationId, id(), 2))).rejects.toBeInstanceOf(
      ConversationAccessError,
    );
    expect(await snapshot(conversationId)).toEqual(before);
  });

  it("同じ generation と payload の同時再送では同じ receipt を返し、行を再作成しない", async () => {
    const conversationId = id();
    const savedInput = input(conversationId, id());
    const results = await Promise.all([store().saveTurn(savedInput), store().saveTurn(savedInput)]);
    expect(withoutNow(results[0])).toEqual(withoutNow(results[1]));
    const before = await snapshot(conversationId);
    expect(withoutNow(await store().saveTurn(savedInput))).toEqual(withoutNow(results[0]));
    expect(await snapshot(conversationId)).toEqual(before);
  });

  it("同一 writeId の payload 改変を拒否し、保存済みの全行を保つ", async () => {
    const conversationId = id();
    const savedInput = input(conversationId, id());
    await store().saveTurn(savedInput);
    const before = await snapshot(conversationId);
    await expect(
      store().saveTurn({ ...savedInput, userText: "changed-synthetic-input" }),
    ).rejects.toBeInstanceOf(TurnCommitConflictError);
    await expect(
      store().saveTurn({
        ...savedInput,
        events: events(savedInput.commit!.writeId, "changed-synthetic-output"),
      }),
    ).rejects.toBeInstanceOf(TurnCommitConflictError);
    expect(await snapshot(conversationId)).toEqual(before);
  });

  it("古い generation による上書き・turn の飛び越しは拒否し、元 generation 再送だけは許す", async () => {
    const conversationId = id();
    const first = input(conversationId, id());
    const receipt = await store().saveTurn(first);
    await store().saveTurn(input(conversationId, id(), 2));
    const before = await snapshot(conversationId);
    await expect(store().saveTurn(input(conversationId, id()))).rejects.toBeInstanceOf(
      TurnCommitConflictError,
    );
    await expect(store().saveTurn(input(conversationId, id(), 4))).rejects.toBeInstanceOf(
      TurnCommitConflictError,
    );
    expect(withoutNow(await store().saveTurn(first))).toEqual(withoutNow(receipt));
    expect(await snapshot(conversationId)).toEqual(before);
  });

  it("guard 済み turn を legacy writer が置換できない", async () => {
    const conversationId = id();
    const savedInput = input(conversationId, id());
    await store().saveTurn(savedInput);
    const before = await snapshot(conversationId);
    await expect(store().saveTurn({ ...savedInput, commit: undefined })).rejects.toBeInstanceOf(
      TurnCommitConflictError,
    );
    expect(await snapshot(conversationId)).toEqual(before);
  });

  it("CAS 保存中の制約失敗は commit と anchor と会話作成も巻き戻す", async () => {
    const conversationId = id();
    const savedInput = input(conversationId, id());
    const chunk = savedInput.events[1];
    await expect(
      store().saveTurn({ ...savedInput, events: [...savedInput.events, chunk] }),
    ).rejects.toThrow();
    expect((await snapshot(conversationId)).every((rows) => rows.length === 0)).toBe(true);
    await store().saveTurn(savedInput);
    expect((await store().load(conversationId)).turn).toBe(2);
  });

  it.each([
    { turn: 0, expectedTurn: 0, writeId: "fixture" },
    { turn: 1.5, expectedTurn: 1.5, writeId: "fixture" },
    { turn: 1, expectedTurn: 2, writeId: "fixture" },
    { turn: 1, expectedTurn: 1, writeId: "" },
    { turn: 1, expectedTurn: 1, writeId: "invalid id" },
  ])("不正 commit は保存前に固定エラーで拒否する (%#)", async (commit) => {
    const conversationId = id();
    const savedInput = input(conversationId, id());
    await expect(
      store().saveTurn({ ...savedInput, turn: commit.turn, commit }),
    ).rejects.toBeInstanceOf(TurnCommitConflictError);
    expect((await snapshot(conversationId)).every((rows) => rows.length === 0)).toBe(true);
  });
});
