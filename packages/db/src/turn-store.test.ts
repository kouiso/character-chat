// createD1TurnStore をローカル D1（Miniflare、root の pnpm db:migrate:local と同じ store）で回す。
// v2_conversation.character_id は character(id) への FK（PRAGMA foreign_keys=1）なので、
// seed 済みの character を 1 件借りる。作った行は afterAll で消す。
import { and, asc, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { characterTable } from "../../../src/schema/character";

import { truncateFromTurn } from "./branch-store";
import { CHUNK_MS_PER_CHAR } from "./chunk-schedule";
import { openLocalD1, type LocalD1 } from "./test/local-d1";
import {
  createD1TurnStore,
  ensureConversationVersion,
  loadLatestLedger,
  readD1StoredTurn,
  readDisplayHistory,
  updateGenerationProvider,
  updateLatestLedger,
  type TurnEvent,
  type TurnStore,
} from "./turn-store";
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
  items: {},
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
    attempts: [{ model: "fake-list", outcome: "ok" }],
    timeoutMs: 120_000,
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
  const storeOpts = (): { userId: string; characterId: string; promptVersion: string } => ({
    userId: "vitest",
    characterId,
    promptVersion: "v0001",
  });
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

  it("即時 lookup で引けんかった provider は後から generation 行へ追記できる（RIT-100）", async () => {
    const conversationId = newConversationId();
    const generationId = crypto.randomUUID();
    await store.saveTurn({
      conversationId,
      turn: 1,
      userText: "user 1",
      events: [
        {
          type: "generation",
          generationId,
          model: "fake-list",
          provider: "unknown",
          upstreamId: "gen-x",
          promptVersion: "v0001",
          systemPrompt: "system",
          request: [{ role: "user", content: "user 1" }],
          rawOutput: "raw 1",
          usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
          latencyMs: 5,
          status: "ok",
        },
        ...chunkEvents(1).slice(1),
      ],
      ledger: ledgerAt(1),
    });

    await updateGenerationProvider(local.db, generationId, "DeepInfra");

    const row = await local.db
      .select({ provider: v2GenerationTable.provider, upstreamId: v2GenerationTable.upstreamId })
      .from(v2GenerationTable)
      .where(eq(v2GenerationTable.id, generationId));
    expect(row[0]).toEqual({ provider: "DeepInfra", upstreamId: "gen-x" });
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
      attemptsJson: JSON.stringify([{ model: "fake-list", outcome: "ok" }]),
      timeoutMs: 120_000,
    });
  });

  it("塊ごとの送る予定時刻が seq 順に一度で保存される（RIT-67）", async () => {
    const conversationId = newConversationId();
    await store.saveTurn({
      conversationId,
      turn: 1,
      userText: "user 1",
      events: chunkEvents(1),
      ledger: ledgerAt(1),
    });

    const [assistant] = await local.db
      .select({ id: v2MessageTable.id })
      .from(v2MessageTable)
      .where(
        and(
          eq(v2MessageTable.conversationId, conversationId),
          eq(v2MessageTable.role, "assistant"),
        ),
      );
    const chunkRows = await local.db
      .select({
        seq: v2ChunkTable.seq,
        sendAt: v2ChunkTable.sendAt,
        createdAt: v2ChunkTable.createdAt,
      })
      .from(v2ChunkTable)
      .where(eq(v2ChunkTable.messageId, assistant.id))
      .orderBy(asc(v2ChunkTable.seq));

    // 先頭の塊は保存時刻そのもの、2個目は先頭の字数に比例した間。
    const firstText = `<action>動作 1</action>`;
    expect(chunkRows).toHaveLength(2);
    expect(chunkRows[0].sendAt).toBe(chunkRows[0].createdAt);
    expect(chunkRows[1].sendAt).toBe(chunkRows[0].createdAt + firstText.length * CHUNK_MS_PER_CHAR);
  });

  it("判定で落ちた塊は本文に入らず、理由つきで dropped=1 の行が残る（RIT-70）", async () => {
    const conversationId = newConversationId();
    const droppedJudge: JudgeResult = {
      ...OK_JUDGE,
      ok: false,
      reasons: ["repetition"],
      checks: {
        ...OK_JUDGE.checks,
        ngram: { ok: false, ratio: 0.9, matchedPhrases: ["同じ文"], exactRepeat: true },
      },
    };
    await store.saveTurn({
      conversationId,
      turn: 1,
      userText: "user 1",
      events: [
        ...chunkEvents(1),
        {
          type: "dropped",
          seq: 2,
          reasons: ["repetition"],
          attempt: 3,
          text: "<action>同じ文</action>",
          judge: droppedJudge,
        },
      ],
      ledger: ledgerAt(1),
    });

    const [assistant] = await local.db
      .select({ id: v2MessageTable.id, content: v2MessageTable.content })
      .from(v2MessageTable)
      .where(
        and(
          eq(v2MessageTable.conversationId, conversationId),
          eq(v2MessageTable.role, "assistant"),
        ),
      );
    // 落ちた塊は配る本文に混ざらん。
    expect(assistant.content).not.toContain("同じ文");

    const chunkRows = await local.db
      .select({
        seq: v2ChunkTable.seq,
        text: v2ChunkTable.text,
        judgeJson: v2ChunkTable.judgeJson,
        attempt: v2ChunkTable.attempt,
        sendAt: v2ChunkTable.sendAt,
        dropped: v2ChunkTable.dropped,
      })
      .from(v2ChunkTable)
      .where(eq(v2ChunkTable.messageId, assistant.id))
      .orderBy(asc(v2ChunkTable.seq));

    expect(chunkRows).toHaveLength(3);
    expect(chunkRows.filter((row) => row.dropped === 0)).toHaveLength(2);
    const [droppedRow] = chunkRows.filter((row) => row.dropped === 1);
    expect(droppedRow).toMatchObject({
      seq: 2,
      text: "<action>同じ文</action>",
      attempt: 3,
      sendAt: null,
    });
    expect(JSON.parse(droppedRow.judgeJson)).toMatchObject({
      ok: false,
      reasons: ["repetition"],
    });
  });

  it("最新の台帳が壊れとっても一個前の台帳へ遡って会話は止まらん（RIT-118）", async () => {
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
    await local.db
      .update(v2LedgerTable)
      .set({ ledgerJson: "{not json" })
      .where(and(eq(v2LedgerTable.conversationId, conversationId), eq(v2LedgerTable.turn, 2)));

    const loaded = await store.load(conversationId);
    expect(loaded.ledger).toEqual(ledgerAt(1));
    expect(loaded.turn).toBe(3);
  });

  it("台帳が全滅しても初期台帳で会話を止めん", async () => {
    const conversationId = newConversationId();
    await store.saveTurn({
      conversationId,
      turn: 1,
      userText: "user 1",
      events: chunkEvents(1),
      ledger: ledgerAt(1),
    });
    await local.db
      .update(v2LedgerTable)
      .set({ ledgerJson: "garbage" })
      .where(eq(v2LedgerTable.conversationId, conversationId));

    const loaded = await store.load(conversationId);
    expect(loaded.ledger.lastEvents).toEqual([]);
    expect(loaded.turn).toBe(2);
  });

  it("手で直した台帳が次の load に載る（RIT-118）", async () => {
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

    const fixed = { ...ledgerAt(2), location: "台所", position: "立ったまま" };
    const updated = await updateLatestLedger(local.db, storeOpts(), conversationId, fixed);
    expect(updated).toBe(2);

    const loaded = await store.load(conversationId);
    expect(loaded.ledger).toEqual(fixed);
    expect(loaded.turn).toBe(3);
  });

  it("台帳行が無い会話の手直しは null（対話未開始）", async () => {
    const conversationId = newConversationId();
    await ensureConversationVersion(local.db, {
      conversationId,
      userId: "vitest",
      characterId,
      promptVersion: "v0001",
      versionId: `ver-${conversationId}`,
    });
    const updated = await updateLatestLedger(local.db, storeOpts(), conversationId, ledgerAt(1));
    expect(updated).toBeNull();
  });

  it("loadLatestLedger: 最新の有効台帳を返し、行が無ければ null（手直し画面用）", async () => {
    const conversationId = newConversationId();
    await store.saveTurn({
      conversationId,
      turn: 1,
      userText: "user 1",
      events: chunkEvents(1),
      ledger: ledgerAt(1),
    });
    expect(await loadLatestLedger(local.db, storeOpts(), conversationId)).toEqual(ledgerAt(1));

    const empty = newConversationId();
    await ensureConversationVersion(local.db, {
      conversationId: empty,
      userId: "vitest",
      characterId,
      promptVersion: "v0001",
      versionId: `ver-${empty}`,
    });
    expect(await loadLatestLedger(local.db, storeOpts(), empty)).toBeNull();
  });

  it("v0001 時代の items の無い台帳行も読める（後方互換）", async () => {
    const conversationId = newConversationId();
    await store.saveTurn({
      conversationId,
      turn: 1,
      userText: "user 1",
      events: chunkEvents(1),
      ledger: ledgerAt(1),
    });
    // v0001 形式（items 無し）で上書き保存しても、読み側は items を空として返す。
    const legacy = ledgerAt(1) as Partial<SceneLedger>;
    delete legacy.items;
    await local.db
      .update(v2LedgerTable)
      .set({ ledgerJson: JSON.stringify(legacy) })
      .where(eq(v2LedgerTable.conversationId, conversationId));

    const loaded = await loadLatestLedger(local.db, storeOpts(), conversationId);
    expect(loaded).toEqual({ ...ledgerAt(1), items: {} });
  });

  it("saveTurn は既存会話の pinned character version を上書きしない", async () => {
    const conversationId = newConversationId();
    await ensureConversationVersion(local.db, {
      conversationId,
      userId: "vitest",
      characterId,
      promptVersion: "v0001",
      versionId: "pinned-version",
    });
    await store.saveTurn({
      conversationId,
      turn: 1,
      userText: "会話を続ける。",
      events: chunkEvents(1),
      ledger: ledgerAt(1),
    });
    const [conversation] = await local.db
      .select({ characterVersionId: v2ConversationTable.characterVersionId })
      .from(v2ConversationTable)
      .where(eq(v2ConversationTable.id, conversationId));
    expect(conversation.characterVersionId).toBe("pinned-version");
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
        items: {},
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
    // 生成記録は実コールの出処として消さん（RIT-202）。置き換え前の分も残るので 2 行。
    expect(generationRows).toHaveLength(2);

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

  // RIT-202: 「ここから戻る」は行を眠らせるだけ。戻った先へ新しく送ったら、
  // 眠った旧列を消さんまま新しい枝として積む（戻る/進むで旧列へ帰れる）。
  it("戻った先への再送は旧枝を消さず、新しい枝番号で積む", async () => {
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
    await truncateFromTurn(local.db, conversationId, 2);
    const rewound = await store.load(conversationId);
    expect(rewound.turn).toBe(2);

    await store.saveTurn({
      conversationId,
      turn: 2,
      userText: "別の分岐の質問",
      events: chunkEvents(2),
      ledger: { ...ledgerAt(2), location: "別の部屋" },
    });

    const loaded = await store.load(conversationId);
    expect(loaded.history.map((message) => message.content)).toEqual([
      "user 1",
      "<action>動作 1</action>\n\n<dialogue>台詞 1</dialogue>",
      "別の分岐の質問",
      "<action>動作 2</action>\n\n<dialogue>台詞 2</dialogue>",
    ]);
    // 眠った turn 2 の旧行は残っとる（2行）＋新しい枝（2行）＋ turn 1 の2行。
    const messages = await local.db
      .select()
      .from(v2MessageTable)
      .where(eq(v2MessageTable.conversationId, conversationId));
    expect(messages).toHaveLength(6);
    const turn2 = messages.filter((row) => row.turn === 2);
    expect(turn2.filter((row) => row.active === 1)).toHaveLength(2);
    expect(turn2.filter((row) => row.active === 0)).toHaveLength(2);
    expect(turn2.find((row) => row.role === "user" && row.active === 1)?.branchNo).toBe(1);
    expect(turn2.find((row) => row.role === "assistant" && row.active === 1)?.branchNo).toBe(1);
    // 旧枝の chunk も残る（記憶出処・生成記録と同じく消さん設計）。
    const sleepingAssistant = turn2.find((row) => row.role === "assistant" && row.active === 0);
    const sleepingChunks = await local.db
      .select({ id: v2ChunkTable.id })
      .from(v2ChunkTable)
      .where(eq(v2ChunkTable.messageId, sleepingAssistant!.id));
    expect(sleepingChunks).toHaveLength(2);
  });

  it("branch=true の saveTurn は assistant だけ新しい枝へ積み、user 行は触らん", async () => {
    const conversationId = newConversationId();
    await store.saveTurn({
      conversationId,
      turn: 1,
      userText: "user 1",
      events: chunkEvents(1),
      ledger: ledgerAt(1),
    });
    const branchStore = createD1TurnStore(local.db, {
      userId: "vitest",
      characterId,
      promptVersion: "v0001",
      branch: true,
    });
    await branchStore.saveTurn({
      conversationId,
      turn: 1,
      userText: "user 1",
      events: [
        chunkEvents(1)[0],
        {
          type: "chunk",
          seq: 0,
          text: "別の返答",
          judge: OK_JUDGE,
          attempt: 1,
          preExtend: true,
        },
      ],
      ledger: { ...ledgerAt(1), location: "枝の部屋" },
    });

    const loaded = await store.load(conversationId);
    expect(loaded.history.map((message) => message.content)).toEqual(["user 1", "別の返答"]);
    const messages = await local.db
      .select()
      .from(v2MessageTable)
      .where(eq(v2MessageTable.conversationId, conversationId));
    expect(messages).toHaveLength(3);
    const assistants = messages.filter((row) => row.role === "assistant");
    expect(assistants).toHaveLength(2);
    expect(assistants.filter((row) => row.active === 1)).toHaveLength(1);
    // 台帳は最新生成で入れ直すので、枝の台帳が load で見える。
    expect(loaded.ledger.location).toBe("枝の部屋");
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
  // engine の persist は本文ゼロの失敗でも saveTurn する（締切で 1 字も来ん・全塊が判定で落ちた）。
  const deadTurnEvents = (turn: number, chunkText: string | null): TurnEvent[] => [
    {
      type: "generation",
      generationId: crypto.randomUUID(),
      model: "fake-list",
      promptVersion: "v0001",
      systemPrompt: "system",
      request: [{ role: "user", content: `user ${turn}` }],
      rawOutput: "",
      usage: null,
      latencyMs: 5,
      status: "aborted",
      truncated: "deadline",
    },
    ...(chunkText === null
      ? []
      : [
          {
            type: "chunk" as const,
            seq: 0,
            text: chunkText,
            judge: OK_JUDGE,
            attempt: 1,
            preExtend: true,
          },
        ]),
  ];

  it.each([
    ["空", null],
    ["空白だけ", " \n\t "],
  ])(
    "末尾ターンの応答が%sなら未保存として扱い、次の保存で同じ turn を置き換える",
    async (_label, chunkText) => {
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
        userText: "失敗した質問",
        events: deadTurnEvents(2, chunkText),
        ledger: ledgerAt(2),
      });

      const afterFailure = await store.load(conversationId);
      expect(afterFailure.history).toEqual([
        { role: "user", content: "user 1" },
        { role: "assistant", content: "<action>動作 1</action>\n\n<dialogue>台詞 1</dialogue>" },
      ]);
      expect(afterFailure.turn).toBe(2);
      // 失敗ターンの ledger_update 結果を次の生成へ持ち越さん。
      expect(afterFailure.ledger).toEqual(ledgerAt(1));

      await store.saveTurn({
        conversationId,
        turn: afterFailure.turn,
        userText: "送り直した質問",
        events: chunkEvents(2),
        ledger: ledgerAt(2),
      });
      const resent = await store.load(conversationId);
      expect(resent.history.map((message) => message.content)).toEqual([
        "user 1",
        "<action>動作 1</action>\n\n<dialogue>台詞 1</dialogue>",
        "送り直した質問",
        "<action>動作 2</action>\n\n<dialogue>台詞 2</dialogue>",
      ]);
      expect(resent.turn).toBe(3);
    },
  );

  it("最初のターンが本文ゼロなら空履歴・初期 ledger・turn 1 に戻る", async () => {
    const conversationId = newConversationId();
    await store.saveTurn({
      conversationId,
      turn: 1,
      userText: "失敗した最初の質問",
      events: deadTurnEvents(1, null),
      ledger: ledgerAt(1),
    });
    const loaded = await store.load(conversationId);
    expect(loaded.history).toEqual([]);
    expect(loaded.turn).toBe(1);
    expect(loaded.ledger.lastEvents).toEqual([]);
  });

  // 修正前の画面は失敗後に次の番号へ進んだので、本文ゼロのターンが続けて残っとる会話がある。
  it("本文ゼロのターンが続いても、通常の読込と再試行用の読込が同じ turn と履歴を返す", async () => {
    const conversationId = newConversationId();
    await store.saveTurn({
      conversationId,
      turn: 1,
      userText: "user 1",
      events: chunkEvents(1),
      ledger: ledgerAt(1),
    });
    for (const turn of [2, 3]) {
      await store.saveTurn({
        conversationId,
        turn,
        userText: `失敗した質問 ${turn}`,
        events: deadTurnEvents(turn, null),
        ledger: ledgerAt(turn),
      });
    }
    const liveHistory = [
      { role: "user", content: "user 1" },
      { role: "assistant", content: "<action>動作 1</action>\n\n<dialogue>台詞 1</dialogue>" },
    ];

    const loaded = await store.load(conversationId);
    expect(loaded.history).toEqual(liveHistory);
    expect(loaded.turn).toBe(3);
    expect(loaded.ledger).toEqual(ledgerAt(1));

    // ChatRoom は loaded.turn を job.turn に固定し、engine はその番号を beforeTurn にして読む。
    const retryStore = createD1TurnStore(local.db, {
      userId: "vitest",
      characterId,
      promptVersion: "v0001",
      beforeTurn: loaded.turn,
    });
    const retried = await retryStore.load(conversationId);
    expect(retried.history).toEqual(liveHistory);
    expect(retried.turn).toBe(loaded.turn);
    expect(retried.ledger).toEqual(ledgerAt(1));

    await store.saveTurn({
      conversationId,
      turn: retried.turn,
      userText: "送り直した質問",
      events: chunkEvents(3),
      ledger: ledgerAt(3),
    });
    const resent = await store.load(conversationId);
    expect(resent.history.map((message) => message.content)).toEqual([
      "user 1",
      "<action>動作 1</action>\n\n<dialogue>台詞 1</dialogue>",
      "送り直した質問",
      "<action>動作 3</action>\n\n<dialogue>台詞 3</dialogue>",
    ]);
    expect(resent.turn).toBe(4);
    expect(resent.ledger).toEqual(ledgerAt(3));
  });

  // 画面の履歴と次の番号を別々の読込から作ると、失敗ターンが画面に残ったまま次の送信で上書きされる。
  it("表示用の履歴は load と同じ失敗ターンを外し、同じ次の番号を返す", async () => {
    const conversationId = newConversationId();
    await store.saveTurn({
      conversationId,
      turn: 1,
      userText: "user 1",
      events: chunkEvents(1),
      ledger: ledgerAt(1),
    });
    for (const turn of [2, 3]) {
      await store.saveTurn({
        conversationId,
        turn,
        userText: `失敗した質問 ${turn}`,
        events: deadTurnEvents(turn, turn === 2 ? null : " "),
        ledger: ledgerAt(turn),
      });
    }
    const loaded = await store.load(conversationId);
    const display = await readDisplayHistory(
      local.db,
      { userId: "vitest", characterId, promptVersion: "v0001" },
      conversationId,
    );
    expect(display.turn).toBe(loaded.turn);
    expect(display.history.map(({ role, content }) => ({ role, content }))).toEqual(loaded.history);
    expect(display.history.map((row) => row.content)).not.toContain("失敗した質問 3");
  });

  it("末尾ターンの応答が 1 字でもあれば保存済みとして残す", async () => {
    const conversationId = newConversationId();
    await store.saveTurn({
      conversationId,
      turn: 1,
      userText: "短い返事の質問",
      events: deadTurnEvents(1, "…"),
      ledger: ledgerAt(1),
    });
    const loaded = await store.load(conversationId);
    expect(loaded.history).toEqual([
      { role: "user", content: "短い返事の質問" },
      { role: "assistant", content: "…" },
    ]);
    expect(loaded.turn).toBe(2);
    expect(loaded.ledger).toEqual(ledgerAt(1));
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
