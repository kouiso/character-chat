// 記憶の手直しストア（RIT-92）をローカル D1 で回す。
import { emptyLedger } from "@v2/prompt";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { characterTable } from "../../../src/schema/character";

import {
  completeMemoryExtraction,
  listPendingMemoryJobs,
  loadMemoryExtractionSource,
} from "./memory-extraction-store";
import {
  deleteMemory,
  insertManualMemory,
  listCharacterMemories,
  loadExpiredMemories,
  loadPinnedMemories,
  MemoryAccessError,
  MEMORY_RESTORE_WINDOW_MS,
  removeMemories,
  restoreMemory,
  setMemoryPinned,
  updateMemoryContent,
} from "./memory-crud-store";
import { openLocalD1, type LocalD1 } from "./test/local-d1";
import { createD1TurnStore } from "./turn-store";
import {
  v2ChunkTable,
  v2ConversationTable,
  v2GenerationTable,
  v2LedgerTable,
  v2MemorySourceTable,
  v2MemoryTable,
  v2MemoryTombstoneTable,
  v2MessageTable,
  v2SummaryTable,
} from "./v2-schema";

import type { TurnEvent } from "./turn-store";

const owner = `crud-test-${crypto.randomUUID()}`;
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

describe("memory crud store", () => {
  let local: LocalD1;
  let characterId: string;
  const ids: string[] = [];
  const scope = { userId: owner };

  // 1ターン会話を作る（ユーザー発言 + assistant chunk）。
  const talk = async (
    conversationId = crypto.randomUUID(),
    userText = "私は紅茶が好きです。",
    extractMemory = false,
  ) => {
    ids.push(conversationId);
    await createD1TurnStore(local.db, {
      userId: owner,
      characterId,
      promptVersion: "test",
      extractMemory,
    }).saveTurn({ conversationId, turn: 1, userText, ledger: emptyLedger(), events: [reply] });
    return conversationId;
  };

  // 発言の無い空会話。
  const emptyTalk = async () => {
    const conversationId = crypto.randomUUID();
    ids.push(conversationId);
    const now = Date.now();
    await local.db.insert(v2ConversationTable).values({
      id: conversationId,
      userId: owner,
      characterId,
      threadId: crypto.randomUUID(),
      promptVersion: "test",
      createdAt: now,
      updatedAt: now,
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
      local.db
        .delete(v2MemoryTombstoneTable)
        .where(inArray(v2MemoryTombstoneTable.conversationId, ids)),
      local.db.delete(v2MemoryTable).where(inArray(v2MemoryTable.conversationId, ids)),
      local.db.delete(v2SummaryTable).where(inArray(v2SummaryTable.conversationId, ids)),
      local.db.delete(v2ChunkTable).where(inArray(v2ChunkTable.messageId, messages)),
      local.db.delete(v2MessageTable).where(inArray(v2MessageTable.conversationId, ids)),
      local.db.delete(v2LedgerTable).where(inArray(v2LedgerTable.conversationId, ids)),
      local.db.delete(v2GenerationTable).where(inArray(v2GenerationTable.conversationId, ids)),
      local.db.delete(v2ConversationTable).where(inArray(v2ConversationTable.id, ids)),
    ]);
    await local.dispose();
  });

  it("手で足した記憶は一覧に出て、最新ユーザー発言を出どころに固定で植えられる", async () => {
    const conversationId = await talk();
    const memory = await insertManualMemory(
      local.db,
      { ...scope, characterId, conversationId },
      { content: "ユーザーの誕生日は3月3日", kind: "fact" },
    );
    expect(memory).not.toBeNull();
    expect(memory?.pinned).toBe(true);
    expect(memory?.sourceTurn).toBe(1);

    const [source] = await local.db
      .select({ messageId: v2MemorySourceTable.sourceMessageId })
      .from(v2MemorySourceTable)
      .where(eq(v2MemorySourceTable.memoryId, memory!.id));
    const [message] = await local.db
      .select({ role: v2MessageTable.role })
      .from(v2MessageTable)
      .where(eq(v2MessageTable.id, source.messageId));
    expect(message.role).toBe("user");

    const list = await listCharacterMemories(local.db, { ...scope, characterId });
    expect(list.map((row) => row.id)).toContain(memory!.id);
    // 別の利用者からは見えない
    expect(await listCharacterMemories(local.db, { userId: "other", characterId })).toEqual([]);
  });

  it("発言の無い会話では足せず、他人の会話では拒否される", async () => {
    const empty = await emptyTalk();
    expect(
      await insertManualMemory(
        local.db,
        { ...scope, characterId, conversationId: empty },
        { content: "x", kind: "fact" },
      ),
    ).toBeNull();
    const conversationId = await talk();
    await expect(
      insertManualMemory(
        local.db,
        { userId: "other", characterId, conversationId },
        { content: "x", kind: "fact" },
      ),
    ).rejects.toBeInstanceOf(MemoryAccessError);
  });

  it("直すと内容が変わり embedding は捨てられる。固定は類似度無関係の経路に載る", async () => {
    const conversationId = await talk();
    const memory = await insertManualMemory(
      local.db,
      { ...scope, characterId, conversationId },
      { content: "猫派", kind: "preference", pinned: false },
    );
    const updated = await updateMemoryContent(
      local.db,
      { ...scope, characterId },
      memory!.id,
      "犬派に変わった",
    );
    expect(updated?.previous).toBe("猫派");
    expect(updated?.conversationId).toBe(conversationId);
    const [row] = await local.db
      .select({ content: v2MemoryTable.content, embedding: v2MemoryTable.embedding })
      .from(v2MemoryTable)
      .where(eq(v2MemoryTable.id, memory!.id));
    expect(row.content).toBe("犬派に変わった");
    expect(row.embedding).toBeNull();

    // 固定するまでは pinned 経路に出ない
    expect(await loadPinnedMemories(local.db, { ...scope, characterId, conversationId })).toEqual(
      [],
    );
    await setMemoryPinned(local.db, { ...scope, characterId }, memory!.id, true);
    const pinned = await loadPinnedMemories(local.db, {
      ...scope,
      characterId,
      conversationId,
    });
    expect(pinned.map((row) => row.id)).toEqual([memory!.id]);
    expect(pinned[0].content).toBe("犬派に変わった");

    // 他人の記憶は直せない・固定も消せもしない
    expect(
      await updateMemoryContent(local.db, { userId: "other", characterId }, memory!.id, "x"),
    ).toBeNull();
    expect(
      await setMemoryPinned(local.db, { userId: "other", characterId }, memory!.id, true),
    ).toBe(false);
  });

  it("消すと論理削除になり、復元窓を過ぎると物理削除される。他人の記憶は消せない", async () => {
    const conversationId = await talk();
    const memory = await insertManualMemory(
      local.db,
      { ...scope, characterId, conversationId },
      { content: "消す対象", kind: "fact" },
    );
    expect(await deleteMemory(local.db, { userId: "other", characterId }, memory!.id)).toBeNull();
    const deleted = await deleteMemory(local.db, { ...scope, characterId }, memory!.id);
    expect(deleted?.rows[0].content).toBe("消す対象");
    expect(deleted?.conversationId).toBe(conversationId);
    // 論理削除: 行は残り deleted_at + revision 繰り上げ。一覧からは消える。
    const [row] = await local.db
      .select({ deletedAt: v2MemoryTable.deletedAt, revision: v2MemoryTable.revision })
      .from(v2MemoryTable)
      .where(eq(v2MemoryTable.id, memory!.id));
    expect(row.deletedAt).toBe(deleted?.deletedAt);
    expect(row.revision).toBe(2);
    expect(
      (await listCharacterMemories(local.db, { ...scope, characterId })).find(
        (entry) => entry.id === memory!.id,
      ),
    ).toBeUndefined();

    // 復元窓を過ぎると物理削除（source も消える）
    const expired = await loadExpiredMemories(
      local.db,
      { conversationId },
      Date.now() - MEMORY_RESTORE_WINDOW_MS,
    );
    expect(expired).toEqual([]);
    const stale = await loadExpiredMemories(local.db, { conversationId }, Date.now() + 1);
    expect(stale.map((entry) => entry.id)).toEqual([memory!.id]);
    await removeMemories(
      local.db,
      stale.map((entry) => entry.id),
    );
    expect(
      await local.db.select().from(v2MemoryTable).where(eq(v2MemoryTable.id, memory!.id)),
    ).toEqual([]);
    expect(
      await local.db
        .select()
        .from(v2MemorySourceTable)
        .where(eq(v2MemorySourceTable.memoryId, memory!.id)),
    ).toEqual([]);
  });

  it("消した内容は抽出の再実行でも蘇らず、手で足し直せる（RIT-94）", async () => {
    const conversationId = await talk(undefined, "私は紅茶が好きです。", true);
    const scope3 = { ...scope, characterId, conversationId };
    const [job] = await listPendingMemoryJobs(local.db, scope3);
    const source = await loadMemoryExtractionSource(local.db, job.id);
    if (!source) throw new Error("source missing");
    const fact = {
      kind: "preference" as const,
      content: "紅茶が好き",
      subject: "",
      importance: 3,
      validFrom: null,
      validUntil: null,
    };
    await completeMemoryExtraction(local.db, source, [fact]);
    const [memory] = await local.db
      .select({ id: v2MemoryTable.id })
      .from(v2MemoryTable)
      .where(eq(v2MemoryTable.conversationId, conversationId));

    // 消す → tombstone に本文つきで乗る
    await deleteMemory(local.db, { ...scope, characterId }, memory.id);
    const tombstones = await local.db
      .select()
      .from(v2MemoryTombstoneTable)
      .where(eq(v2MemoryTombstoneTable.conversationId, conversationId));
    expect(tombstones).toHaveLength(1);
    expect(tombstones[0].content).toBe("紅茶が好き");

    // 同じ内容の再抽出は書き戻さん（Queue の再配送・ターン置換でも同じ）。
    // 残るのは論理削除された元の行だけ。
    await completeMemoryExtraction(local.db, source, [fact]);
    const memories = await local.db
      .select({ id: v2MemoryTable.id, deletedAt: v2MemoryTable.deletedAt })
      .from(v2MemoryTable)
      .where(eq(v2MemoryTable.conversationId, conversationId));
    expect(memories).toHaveLength(1);
    expect(memories[0].id).toBe(memory.id);
    expect(memories[0].deletedAt).not.toBeNull();

    // 手で明示的に足し直すと帳から外れて普通に残る
    const readded = await insertManualMemory(local.db, scope3, {
      content: "紅茶が好き",
      kind: "preference",
    });
    expect(readded).not.toBeNull();
    expect(
      await local.db
        .select()
        .from(v2MemoryTombstoneTable)
        .where(eq(v2MemoryTombstoneTable.conversationId, conversationId)),
    ).toEqual([]);
  });

  it("消すとその後の要約行も論理削除され、前の要約は残る。本物の要約は伏せ直し待ち（RIT-94）", async () => {
    const conversationId = await talk();
    const scope3 = { ...scope, characterId, conversationId };
    const fact = await insertManualMemory(local.db, scope3, {
      content: "消す対象",
      kind: "fact",
    });
    const now = Date.now();
    // 対象のターン(1)より前・後の要約を直接植える
    for (const [id, turn] of [
      ["summary-before", 0],
      ["summary-after", 5],
    ] as const) {
      await local.db.insert(v2MemoryTable).values({
        id: `${id}-${crypto.randomUUID()}`,
        conversationId,
        kind: "summary",
        content: `要約${turn}`,
        pinned: 0,
        sourceTurn: turn,
        createdAt: now,
      });
    }
    // 本物のあらすじ（v2_summary）を1本植える
    await local.db.insert(v2SummaryTable).values({
      id: crypto.randomUUID(),
      conversationId,
      level: 1,
      coveredTo: 2,
      text: "あらすじ",
      createdAt: now,
    });
    const deleted = await deleteMemory(local.db, { ...scope, characterId }, fact!.id);
    expect(deleted?.rows).toHaveLength(2); // 本体 + 後の要約

    const remaining = await local.db
      .select({
        sourceTurn: v2MemoryTable.sourceTurn,
        deletedAt: v2MemoryTable.deletedAt,
      })
      .from(v2MemoryTable)
      .where(eq(v2MemoryTable.conversationId, conversationId));
    // 本体・後の要約は論理削除、前の要約は残る
    const live = remaining.filter((row) => row.deletedAt === null);
    const swept = remaining.filter((row) => row.deletedAt !== null);
    expect(live.map((row) => row.sourceTurn)).toEqual([0]);
    expect(swept).toHaveLength(2);

    // 本物のあらすじは伏せ直し待ちになる
    const summaries = await local.db
      .select({ redactPending: v2SummaryTable.redactPending })
      .from(v2SummaryTable)
      .where(eq(v2SummaryTable.conversationId, conversationId));
    expect(summaries).toEqual([{ redactPending: 1 }]);
  });

  it("消してから 30 秒以内なら戻せる。窓切れは戻せん（RIT-94）", async () => {
    const conversationId = await talk();
    const scope3 = { ...scope, characterId, conversationId };
    const memory = await insertManualMemory(local.db, scope3, {
      content: "戻す対象",
      kind: "fact",
    });
    const deleted = await deleteMemory(local.db, { ...scope, characterId }, memory!.id);
    expect(deleted).not.toBeNull();

    // 窓の内側: 復元すると一覧に戻り、tombstone も消える
    const restored = await restoreMemory(local.db, { ...scope, characterId }, memory!.id);
    expect(restored).not.toBeNull();
    expect(restored).not.toBe("expired");
    expect(
      (await listCharacterMemories(local.db, { ...scope, characterId })).map((row) => row.id),
    ).toContain(memory!.id);
    expect(
      await local.db
        .select()
        .from(v2MemoryTombstoneTable)
        .where(eq(v2MemoryTombstoneTable.conversationId, conversationId)),
    ).toEqual([]);

    // 窓の外: deleted_at が古い行は "expired"
    const again = await deleteMemory(local.db, { ...scope, characterId }, memory!.id);
    expect(again).not.toBeNull();
    const expired = await restoreMemory(
      local.db,
      { ...scope, characterId },
      memory!.id,
      Date.now() + MEMORY_RESTORE_WINDOW_MS + 1,
    );
    expect(expired).toBe("expired");
    // 他人の記憶は復元も消去もできない
    expect(await restoreMemory(local.db, { userId: "other", characterId }, memory!.id)).toBeNull();
  });

  it("直した記憶の旧内容も tombstone に乗り再抽出で蘇らん（RIT-94）", async () => {
    const conversationId = await talk(undefined, "私は紅茶が好きです。", true);
    const scope3 = { ...scope, characterId, conversationId };
    const memory = await insertManualMemory(local.db, scope3, {
      content: "紅茶が好き",
      kind: "preference",
    });
    await updateMemoryContent(local.db, { ...scope, characterId }, memory!.id, "珈琲が好き");
    const [job] = await listPendingMemoryJobs(local.db, scope3);
    const source = await loadMemoryExtractionSource(local.db, job.id);
    if (!source) throw new Error("source missing");
    await completeMemoryExtraction(local.db, source, [
      {
        kind: "preference",
        content: "紅茶が好き",
        subject: "",
        importance: 3,
        validFrom: null,
        validUntil: null,
      },
    ]);
    const rows = await local.db
      .select({ content: v2MemoryTable.content })
      .from(v2MemoryTable)
      .where(eq(v2MemoryTable.conversationId, conversationId));
    expect(rows.map((row) => row.content)).toEqual(["珈琲が好き"]);
  });

  it("長い記憶も往復できる", async () => {
    const conversationId = await talk();
    const long = "あ".repeat(4000);
    const memory = await insertManualMemory(
      local.db,
      { ...scope, characterId, conversationId },
      { content: long, kind: "fact" },
    );
    const list = await listCharacterMemories(local.db, { ...scope, characterId });
    expect(list.find((row) => row.id === memory!.id)?.content).toBe(long);
  });
});
