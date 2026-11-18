// v2_summary の読み書きと無効化の確かめ（RIT-72）。
// v2_summary.conversation_id は v2_conversation への FK なので、先に saveTurn で
// 会話行を作る（seed 済み character を 1 件借りる）。
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { characterTable } from "../../../src/schema/character";

import {
  applySummaryRedaction,
  createD1SummaryStore,
  dropSummary,
  invalidateSummariesFrom,
  invalidateSummariesFromStatement,
  listActiveSummaries,
  listRedactPendingSummaries,
  loadRecentActiveMessages,
  loadTurnRange,
  saveSummaryRange,
  summarySourceHash,
} from "./summary-store";
import { openLocalD1, type LocalD1 } from "./test/local-d1";
import { createD1TurnStore, type TurnEvent } from "./turn-store";
import { v2MemoryTombstoneTable, v2MessageTable, v2SummaryTable } from "./v2-schema";

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

const makeTurn = (text: string): TurnEvent[] => [
  {
    type: "generation",
    generationId: crypto.randomUUID(),
    model: "fake-list",
    promptVersion: "v0001",
    systemPrompt: "system",
    request: [{ role: "user", content: "user" }],
    rawOutput: `<action>${text}</action>`,
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    latencyMs: 1,
    status: "ok",
  },
  { type: "chunk", seq: 1, text, judge: OK_JUDGE, attempt: 1, preExtend: true },
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

const OPTS = (characterId: string, branch = false) => ({
  userId: "vitest",
  characterId,
  promptVersion: "v0001",
  branch,
});

describe("v2_summary の読み書き（RIT-72）", () => {
  let local: LocalD1;
  let characterId = "";
  const createdConversationIds: string[] = [];

  const newConversation = async (): Promise<string> => {
    const store = createD1TurnStore(local.db, OPTS(characterId));
    const conversationId = `test-${crypto.randomUUID()}`;
    createdConversationIds.push(conversationId);
    await store.saveTurn({
      conversationId,
      turn: 1,
      userText: "user 1",
      events: makeTurn("assistant 1"),
      ledger: LEDGER,
    });
    return conversationId;
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
  });

  afterAll(async () => {
    await local.db
      .delete(v2SummaryTable)
      .where(inArray(v2SummaryTable.conversationId, createdConversationIds));
    await local.dispose();
  });

  it("listActive は有効な行だけを from_turn 順で返し、旧行（to_turn null）と無効行は読まん", async () => {
    const conversationId = await newConversation();
    const seed = {
      conversationId,
      sourceHash: "hash",
      text: "本文",
    };
    await saveSummaryRange(local.db, { ...seed, level: 1, fromTurn: 11, toTurn: 20 });
    await saveSummaryRange(local.db, { ...seed, level: 2, fromTurn: 1, toTurn: 20 });
    await saveSummaryRange(local.db, { ...seed, level: 1, fromTurn: 1, toTurn: 10 });
    // 旧行（from_turn/to_turn 無し）と、無効にした行は読まん。
    await local.db.insert(v2SummaryTable).values({
      id: `legacy-${crypto.randomUUID()}`,
      conversationId,
      level: 1,
      coveredTo: 30,
      text: "旧行",
      createdAt: Date.now(),
    });
    // to_turn >= 20 の行（1:11-20 と 2:1-20）は無効になる。to_turn null の旧行は
    // 条件に当たらんので有効のままだが、listActive は to_turn 無しの行を読まん。
    await invalidateSummariesFrom(local.db, conversationId, 20);
    const active = await listActiveSummaries(local.db, conversationId);
    expect(active.map((row) => [row.level, row.fromTurn, row.toTurn])).toEqual([[1, 1, 10]]);
    // 無効になった行自体は残る（行は消さん）。
    const all = await local.db
      .select({ invalidatedAt: v2SummaryTable.invalidatedAt })
      .from(v2SummaryTable)
      .where(eq(v2SummaryTable.conversationId, conversationId));
    expect(all).toHaveLength(4);
    expect(all.filter((row) => row.invalidatedAt !== null)).toHaveLength(2);
    expect(all.filter((row) => row.invalidatedAt === null)).toHaveLength(2);
    const stillValid = await local.db
      .select({ id: v2SummaryTable.id })
      .from(v2SummaryTable)
      .where(
        and(
          eq(v2SummaryTable.conversationId, conversationId),
          isNull(v2SummaryTable.invalidatedAt),
        ),
      );
    expect(stillValid).toHaveLength(2);
  });

  it("同じキーの要約は 1 行だけ（FR-6）。無効化後の同キー再保存は有効へ戻る", async () => {
    const conversationId = await newConversation();
    const input = {
      conversationId,
      level: 1,
      fromTurn: 1,
      toTurn: 10,
      sourceHash: "same-hash",
      text: "一度目",
    };
    await saveSummaryRange(local.db, input);
    await saveSummaryRange(local.db, { ...input, text: "二度目" });
    const active = await listActiveSummaries(local.db, conversationId);
    expect(active).toHaveLength(1);
    expect(active[0]?.text).toBe("二度目");
    // 無効化してから同じキーで保存し直すと、その行は有効へ戻る。
    await invalidateSummariesFrom(local.db, conversationId, 5);
    expect(await listActiveSummaries(local.db, conversationId)).toHaveLength(0);
    await saveSummaryRange(local.db, { ...input, text: "三度目" });
    const revived = await listActiveSummaries(local.db, conversationId);
    expect(revived).toHaveLength(1);
    expect(revived[0]?.text).toBe("三度目");
    // 別の source_hash は別キーなので別行。
    await saveSummaryRange(local.db, { ...input, sourceHash: "other-hash" });
    expect(await listActiveSummaries(local.db, conversationId)).toHaveLength(2);
  });

  it("loadTurnRange は範囲の表示中メッセージをターン順で返し、source hash が安定する（FR-8）", async () => {
    const conversationId = await newConversation();
    const store = createD1TurnStore(local.db, OPTS(characterId));
    for (let turn = 2; turn <= 5; turn += 1) {
      await store.saveTurn({
        conversationId,
        turn,
        userText: `user ${turn}`,
        events: makeTurn(`assistant ${turn}`),
        ledger: LEDGER,
      });
    }
    const rows = await loadTurnRange(local.db, { conversationId, fromTurn: 2, toTurn: 4 });
    expect(rows.map((row) => `${row.turn}:${row.role}`)).toEqual([
      "2:user",
      "2:assistant",
      "3:user",
      "3:assistant",
      "4:user",
      "4:assistant",
    ]);
    const hash = await summarySourceHash(rows);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    // 同じ並びは同じ hash、1 通違えば違う hash（直列化は 1 箇所に閉じとる）。
    const same = await summarySourceHash(
      await loadTurnRange(local.db, { conversationId, fromTurn: 2, toTurn: 4 }),
    );
    expect(same).toBe(hash);
    const tampered = rows.map((row, index) =>
      index === 0 ? { ...row, content: `${row.content}（書き換え）` } : row,
    );
    expect(await summarySourceHash(tampered)).not.toBe(hash);
    // 履歴の 1 通を書き換えると、保存した hash と合わず使われん（FR-8 の網）。
    await saveSummaryRange(local.db, {
      conversationId,
      level: 1,
      fromTurn: 2,
      toTurn: 4,
      sourceHash: hash,
      text: "範囲の要約",
    });
    await local.db
      .update(v2MessageTable)
      .set({ content: "assistant 2 改訂" })
      .where(
        and(
          eq(v2MessageTable.conversationId, conversationId),
          eq(v2MessageTable.content, "assistant 2"),
        ),
      );
    const actual = await summarySourceHash(
      await loadTurnRange(local.db, { conversationId, fromTurn: 2, toTurn: 4 }),
    );
    expect(actual).not.toBe(hash);
    const recent = await loadRecentActiveMessages(local.db, conversationId, 4);
    expect(recent.map((row) => `${row.turn}:${row.role}`)).toEqual([
      "4:user",
      "4:assistant",
      "5:user",
      "5:assistant",
    ]);
  });

  it("saveTurn の置き換え経路で、置き換えたターン以降を覆う要約が無効になる（FR-7）", async () => {
    const conversationId = await newConversation();
    const store = createD1TurnStore(local.db, OPTS(characterId));
    for (let turn = 2; turn <= 5; turn += 1) {
      await store.saveTurn({
        conversationId,
        turn,
        userText: `user ${turn}`,
        events: makeTurn(`assistant ${turn}`),
        ledger: LEDGER,
      });
    }
    await saveSummaryRange(local.db, {
      conversationId,
      level: 1,
      fromTurn: 1,
      toTurn: 2,
      sourceHash: "h1",
      text: "前半",
    });
    await saveSummaryRange(local.db, {
      conversationId,
      level: 1,
      fromTurn: 3,
      toTurn: 4,
      sourceHash: "h2",
      text: "後半",
    });
    await saveSummaryRange(local.db, {
      conversationId,
      level: 2,
      fromTurn: 1,
      toTurn: 4,
      sourceHash: "h3",
      text: "まとめ",
    });
    // turn 3 を送り直す（同じターンを保存し直す = 置き換え経路）。
    await store.saveTurn({
      conversationId,
      turn: 3,
      userText: "user 3 改訂",
      events: makeTurn("assistant 3 改訂"),
      ledger: LEDGER,
    });
    const active = await listActiveSummaries(local.db, conversationId);
    // to_turn >= 3 の 2 行が無効、to_turn = 2 の行は有効のまま。
    expect(active.map((row) => [row.level, row.fromTurn, row.toTurn])).toEqual([[1, 1, 2]]);
    // 無効になった行は消さず残る。
    const all = await local.d1
      .prepare("SELECT invalidated_at AS inv FROM v2_summary WHERE conversation_id = ?")
      .bind(conversationId)
      .all<{ inv: number | null }>();
    expect(all.results?.filter((row) => row.inv !== null)).toHaveLength(2);
  });

  it("saveTurn の枝経路（再生成）でも同じ無効化が入る（FR-7）", async () => {
    const conversationId = await newConversation();
    const store = createD1TurnStore(local.db, OPTS(characterId));
    await store.saveTurn({
      conversationId,
      turn: 2,
      userText: "user 2",
      events: makeTurn("assistant 2"),
      ledger: LEDGER,
    });
    await saveSummaryRange(local.db, {
      conversationId,
      level: 1,
      fromTurn: 1,
      toTurn: 2,
      sourceHash: "h1",
      text: "要約",
    });
    // 枝（再生成）は assistant 行だけ新しい枝として保存する経路。
    const branchStore = createD1TurnStore(local.db, OPTS(characterId, true));
    await branchStore.saveTurn({
      conversationId,
      turn: 2,
      userText: "user 2",
      events: makeTurn("assistant 2 別枝"),
      ledger: LEDGER,
    });
    expect(await listActiveSummaries(local.db, conversationId)).toHaveLength(0);
  });

  it("invalidateSummariesFromStatement は batch へ入れられる文を返す", async () => {
    const conversationId = await newConversation();
    await saveSummaryRange(local.db, {
      conversationId,
      level: 1,
      fromTurn: 1,
      toTurn: 1,
      sourceHash: "h",
      text: "要約",
    });
    await local.db.batch([invalidateSummariesFromStatement(local.db, conversationId, 1)]);
    expect(await listActiveSummaries(local.db, conversationId)).toHaveLength(0);
  });
});

describe("伏せ直し（RIT-94）", () => {
  let local: LocalD1;
  let conversationId = "";
  let characterId = "";

  beforeAll(async () => {
    local = await openLocalD1();
    const [character] = await local.db
      .select({ id: characterTable.id })
      .from(characterTable)
      .orderBy(asc(characterTable.displayOrder), asc(characterTable.createdAt))
      .limit(1);
    if (!character) throw new Error("ローカル D1 に character が無い");
    characterId = character.id;
    const store = createD1TurnStore(local.db, OPTS(characterId));
    conversationId = `redact-${crypto.randomUUID()}`;
    await store.saveTurn({
      conversationId,
      turn: 1,
      userText: "user 1",
      events: makeTurn("assistant 1"),
      ledger: LEDGER,
    });
  });

  afterAll(async () => {
    await local.db.delete(v2SummaryTable).where(eq(v2SummaryTable.conversationId, conversationId));
    await local.db
      .delete(v2MemoryTombstoneTable)
      .where(eq(v2MemoryTombstoneTable.conversationId, conversationId));
    await local.dispose();
  });

  it("伏せ直し待ち・墓標の本文・書き戻し・行消しが動く（RIT-94）", async () => {
    const store = createD1SummaryStore(local.db);
    await saveSummaryRange(local.db, {
      conversationId,
      level: 1,
      fromTurn: 1,
      toTurn: 10,
      sourceHash: "h",
      text: "古い文",
    });
    // 削除が走った体でその会話の全要約を redact_pending に立てる
    await local.db
      .update(v2SummaryTable)
      .set({ redactPending: 1 })
      .where(eq(v2SummaryTable.conversationId, conversationId));
    const pendings = await listRedactPendingSummaries(local.db, conversationId);
    expect(pendings.length).toBeGreaterThan(0);

    for (const row of pendings) {
      await applySummaryRedaction(local.db, row.id, `伏せ直し:${row.id}`);
    }
    expect(await listRedactPendingSummaries(local.db, conversationId)).toEqual([]);
    const listed = await store.listActive(conversationId);
    expect(listed.every((row) => !row.redactPending)).toBe(true);
    expect(listed.filter((row) => row.text.startsWith("伏せ直し:"))).toHaveLength(pendings.length);

    await local.db.insert(v2MemoryTombstoneTable).values({
      conversationId,
      contentHash: `h-${crypto.randomUUID()}`,
      content: "消した本文",
      createdAt: Date.now(),
    });
    expect(await store.listForgotten(conversationId)).toContain("消した本文");

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
        .where(eq(v2SummaryTable.id, doomed)),
    ).toEqual([]);
  });
});
