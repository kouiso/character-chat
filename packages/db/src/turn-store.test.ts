// createD1TurnStore をローカル D1（Miniflare、root の pnpm db:migrate:local と同じ store）で回す。
// v2_conversation.character_id は character(id) への FK（PRAGMA foreign_keys=1）なので、
// seed 済みの character を 1 件借りる。作った行は afterAll で消す。
import { and, asc, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { characterTable } from "../../../src/schema/character";

import { openLocalD1, type LocalD1 } from "./test/local-d1";
import { createD1TurnStore, readD1StoredTurn, type TurnEvent, type TurnStore } from "./turn-store";
import {
  v2ChunkTable,
  v2ConversationTable,
  v2GenerationTable,
  v2LedgerTable,
  v2MessageTable,
} from "./v2-schema";

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

const ledgerAt = (turn: number): SceneLedger => ({
  phase: "conversation",
  location: null,
  time: null,
  present: [],
  clothing: {},
  position: null,
  lastEvents: [`turn ${turn}`],
});

const chunkEvents = (turn: number): TurnEvent[] => [
  {
    type: "generation",
    generationId: crypto.randomUUID(),
    model: "fake-list",
    promptVersion: "v0001",
    systemPrompt: "system",
    request: [{ role: "user", content: `user ${turn}` }],
    rawOutput: `raw ${turn}`,
    usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
    latencyMs: 5,
    status: "ok",
  },
  // seq を逆順で渡して、保存側が seq 順に並べ直すことも同時に見る。
  {
    type: "chunk",
    seq: 1,
    text: `<dialogue>台詞 ${turn}</dialogue>`,
    judge: OK_JUDGE,
    attempt: 1,
    preExtend: true,
  },
  {
    type: "chunk",
    seq: 0,
    text: `<action>動作 ${turn}</action>`,
    judge: OK_JUDGE,
    attempt: 2,
    preExtend: true,
  },
];

describe("createD1TurnStore", () => {
  let local: LocalD1;
  let characterId: string;
  let store: TurnStore;
  const createdConversationIds: string[] = [];

  const newConversationId = (): string => {
    const id = `test-${crypto.randomUUID()}`;
    createdConversationIds.push(id);
    return id;
  };

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
    characterId = character.id;
    store = createD1TurnStore(local.db, {
      userId: "vitest",
      characterId,
      promptVersion: "v0001",
    });
  });

  afterAll(async () => {
    if (createdConversationIds.length > 0) {
      const messageIds = local.db
        .select({ id: v2MessageTable.id })
        .from(v2MessageTable)
        .where(inArray(v2MessageTable.conversationId, createdConversationIds));
      await local.db.batch([
        local.db.delete(v2ChunkTable).where(inArray(v2ChunkTable.messageId, messageIds)),
        local.db
          .delete(v2MessageTable)
          .where(inArray(v2MessageTable.conversationId, createdConversationIds)),
        local.db
          .delete(v2LedgerTable)
          .where(inArray(v2LedgerTable.conversationId, createdConversationIds)),
        local.db
          .delete(v2GenerationTable)
          .where(inArray(v2GenerationTable.conversationId, createdConversationIds)),
        local.db
          .delete(v2ConversationTable)
          .where(inArray(v2ConversationTable.id, createdConversationIds)),
      ]);
    }
    await local.dispose();
  });

  it("2 ターン保存すると history 4 件が turn→user→assistant の順で戻り、次の turn は 3", async () => {
    const conversationId = newConversationId();
    await store.saveTurn({
      conversationId,
      turn: 1,
      userText: "user 1",
      events: chunkEvents(1),
      ledger: ledgerAt(1),
    });
    await store.saveTurn({
      conversationId,
      turn: 2,
      userText: "user 2",
      events: chunkEvents(2),
      ledger: ledgerAt(2),
    });

    const loaded = await store.load(conversationId);
    expect(loaded.history).toEqual([
      { role: "user", content: "user 1" },
      { role: "assistant", content: "<action>動作 1</action>\n\n<dialogue>台詞 1</dialogue>" },
      { role: "user", content: "user 2" },
      { role: "assistant", content: "<action>動作 2</action>\n\n<dialogue>台詞 2</dialogue>" },
    ]);
    expect(loaded.ledger).toEqual(ledgerAt(2));
    // graph.ts の intake は load().turn をそのまま次の saveTurn の turn に使うので「次のターン番号」。
    expect(loaded.turn).toBe(3);

    const [conversation] = await local.db
      .select()
      .from(v2ConversationTable)
      .where(eq(v2ConversationTable.id, conversationId));
    expect(conversation).toMatchObject({
      userId: "vitest",
      characterId,
      threadId: conversationId,
      promptVersion: "v0001",
    });
    expect(conversation?.updatedAt).toBeGreaterThanOrEqual(conversation?.createdAt ?? Infinity);

    const assistantRows = await local.db
      .select()
      .from(v2MessageTable)
      .where(
        and(
          eq(v2MessageTable.conversationId, conversationId),
          eq(v2MessageTable.role, "assistant"),
        ),
      )
      .orderBy(asc(v2MessageTable.turn));
    expect(assistantRows.map((row) => [row.action, row.dialogue, row.inner])).toEqual([
      ["動作 1", "台詞 1", null],
      ["動作 2", "台詞 2", null],
    ]);

    const chunkRows = await local.db
      .select({
        seq: v2ChunkTable.seq,
        attempt: v2ChunkTable.attempt,
        judgeJson: v2ChunkTable.judgeJson,
      })
      .from(v2ChunkTable)
      .where(eq(v2ChunkTable.messageId, assistantRows[0].id))
      .orderBy(asc(v2ChunkTable.seq));
    expect(chunkRows).toEqual([
      { seq: 0, attempt: 2, judgeJson: JSON.stringify(OK_JUDGE) },
      { seq: 1, attempt: 1, judgeJson: JSON.stringify(OK_JUDGE) },
    ]);

    const generationRows = await local.db
      .select()
      .from(v2GenerationTable)
      .where(eq(v2GenerationTable.conversationId, conversationId))
      .orderBy(asc(v2GenerationTable.turn));
    expect(generationRows).toHaveLength(2);
    expect(generationRows.map((row) => row.id)).toEqual(
      assistantRows.map((row) => row.generationId),
    );
    expect(generationRows[0]).toMatchObject({
      model: "fake-list",
      promptVersion: "v0001",
      systemPrompt: "system",
      requestJson: JSON.stringify([{ role: "user", content: "user 1" }]),
      rawOutput: "raw 1",
      usageJson: JSON.stringify({ inputTokens: 1, outputTokens: 2, totalTokens: 3 }),
      latencyMs: 5,
      status: "ok",
      error: null,
    });
  });

  it("未知の conversationId は空履歴・初期 ledger・turn 1", async () => {
    const loaded = await store.load(`unknown-${crypto.randomUUID()}`);
    expect(loaded).toEqual({
      history: [],
      ledger: {
        phase: "conversation",
        location: null,
        time: null,
        present: [],
        clothing: {},
        position: null,
        lastEvents: [],
      },
      turn: 1,
    });
  });

  it("同じ turn を二度保存すると unique index に当たらず置き換わる", async () => {
    const conversationId = newConversationId();
    await store.saveTurn({
      conversationId,
      turn: 1,
      userText: "first",
      events: chunkEvents(1),
      ledger: ledgerAt(1),
    });
    const [before] = await local.db
      .select({ createdAt: v2ConversationTable.createdAt })
      .from(v2ConversationTable)
      .where(eq(v2ConversationTable.id, conversationId));

    await store.saveTurn({
      conversationId,
      turn: 1,
      userText: "second",
      events: [
        chunkEvents(1)[0],
        { type: "chunk", seq: 0, text: "平文だけ", judge: OK_JUDGE, attempt: 1, preExtend: true },
      ],
      ledger: { ...ledgerAt(1), location: "部屋" },
    });

    const loaded = await store.load(conversationId);
    expect(loaded.history).toEqual([
      { role: "user", content: "second" },
      { role: "assistant", content: "平文だけ" },
    ]);
    expect(loaded.ledger.location).toBe("部屋");
    expect(loaded.turn).toBe(2);

    const messages = await local.db
      .select()
      .from(v2MessageTable)
      .where(eq(v2MessageTable.conversationId, conversationId));
    expect(messages).toHaveLength(2);
    const assistant = messages.find((row) => row.role === "assistant");
    // タグ構造が無い本文は action/dialogue/inner を null にする。
    expect([assistant?.action, assistant?.dialogue, assistant?.inner]).toEqual([null, null, null]);
    const chunkRows = await local.db
      .select({ text: v2ChunkTable.text })
      .from(v2ChunkTable)
      .where(
        inArray(
          v2ChunkTable.messageId,
          messages.map((row) => row.id),
        ),
      );
    expect(chunkRows).toEqual([{ text: "平文だけ" }]);
    const ledgerRows = await local.db
      .select({ turn: v2LedgerTable.turn })
      .from(v2LedgerTable)
      .where(eq(v2LedgerTable.conversationId, conversationId));
    expect(ledgerRows).toEqual([{ turn: 1 }]);
    const generationRows = await local.db
      .select({ id: v2GenerationTable.id })
      .from(v2GenerationTable)
      .where(eq(v2GenerationTable.conversationId, conversationId));
    expect(generationRows).toHaveLength(1);

    // upsert: created_at は初回のまま、updated_at だけ進む。
    const [after] = await local.db
      .select({
        createdAt: v2ConversationTable.createdAt,
        updatedAt: v2ConversationTable.updatedAt,
      })
      .from(v2ConversationTable)
      .where(eq(v2ConversationTable.id, conversationId));
    expect(after?.createdAt).toBe(before?.createdAt);
    expect(after?.updatedAt).toBeGreaterThanOrEqual(after?.createdAt ?? Infinity);
  });

  it("存在せん character_id なら batch 全体が拒否され、どのテーブルにも行が残らん", async () => {
    const conversationId = newConversationId();
    const broken = createD1TurnStore(local.db, {
      userId: "vitest",
      characterId: `missing-${crypto.randomUUID()}`,
      promptVersion: "v0001",
    });
    await expect(
      broken.saveTurn({
        conversationId,
        turn: 1,
        userText: "x",
        events: chunkEvents(1),
        ledger: ledgerAt(1),
      }),
    ).rejects.toThrow();

    const [conversations, messages, ledgers, generations] = await local.db.batch([
      local.db.select().from(v2ConversationTable).where(eq(v2ConversationTable.id, conversationId)),
      local.db
        .select()
        .from(v2MessageTable)
        .where(eq(v2MessageTable.conversationId, conversationId)),
      local.db.select().from(v2LedgerTable).where(eq(v2LedgerTable.conversationId, conversationId)),
      local.db
        .select()
        .from(v2GenerationTable)
        .where(eq(v2GenerationTable.conversationId, conversationId)),
    ]);
    expect([conversations, messages, ledgers, generations].map((rows) => rows.length)).toEqual([
      0, 0, 0, 0,
    ]);
  });

  it("別ユーザー・別キャラから同じ会話を読み書きできない", async () => {
    const conversationId = newConversationId();
    const input = {
      conversationId,
      turn: 1,
      userText: "original",
      events: chunkEvents(1),
      ledger: ledgerAt(1),
    };
    await store.saveTurn(input);
    for (const scope of [
      { userId: "other", characterId },
      { userId: "vitest", characterId: "other-character" },
    ]) {
      const other = createD1TurnStore(local.db, { ...scope, promptVersion: "v0001" });
      await expect(other.load(conversationId)).rejects.toThrow("会話が見つかりません");
      await expect(other.saveTurn({ ...input, userText: "changed" })).rejects.toThrow(
        "会話が見つかりません",
      );
    }
    expect((await store.load(conversationId)).history[0].content).toBe("original");
  });

  it("再試行するターン自身を入力履歴に混ぜない", async () => {
    const conversationId = newConversationId();
    for (const turn of [1, 2]) {
      await store.saveTurn({
        conversationId,
        turn,
        userText: `user ${turn}`,
        events: chunkEvents(turn),
        ledger: ledgerAt(turn),
      });
    }
    const retryStore = createD1TurnStore(local.db, {
      userId: "vitest",
      characterId,
      promptVersion: "v0001",
      beforeTurn: 2,
    });
    const before = await retryStore.load(conversationId);
    expect(before.history).toHaveLength(2);
    expect(before.turn).toBe(2);
    expect(before.ledger).toEqual(ledgerAt(1));
    expect((await store.load(conversationId)).history).toHaveLength(4);
  });
  it("連続する既存発言があっても復旧対象をターン番号で特定する", async () => {
    const conversationId = newConversationId();
    await store.saveTurn({
      conversationId,
      turn: 7,
      userText: "再開した質問",
      events: chunkEvents(7),
      ledger: ledgerAt(7),
    });
    await local.db.insert(v2MessageTable).values({
      id: crypto.randomUUID(),
      conversationId,
      turn: 0,
      role: "assistant",
      content: "以前の挨拶",
      createdAt: 1,
    });
    const messages = await readD1StoredTurn(
      local.db,
      {
        userId: "vitest",
        characterId,
        promptVersion: "v0001",
      },
      conversationId,
      7,
    );
    expect(messages).toHaveLength(2);
    expect(messages.find((message) => message.role === "user")?.content).toBe("再開した質問");
    expect(messages.some((message) => message.content === "以前の挨拶")).toBe(false);
    await expect(
      readD1StoredTurn(
        local.db,
        {
          userId: "other",
          characterId,
          promptVersion: "v0001",
        },
        conversationId,
        7,
      ),
    ).rejects.toThrow("会話が見つかりません");
  });
});
