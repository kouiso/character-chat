// RIT-78: memory_note → v2_memory + v2_memory_source + 台帳の写し。
// 写す先の決め方・消した物を戻さない・書き換えを上書きしない・[auto] 除去・冪等を
// ローカル D1 で確かめる。
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { characterTable } from "../../../src/schema/character";
import { conversationTable } from "../../../src/schema/conversation";
import { memoryNoteTable } from "../../../src/schema/memory-note";
import { messageTable } from "../../../src/schema/message";
import { userTable } from "../../../src/schema/user";

import {
  legacyMemoryId,
  migrateLegacyMemoryNotes,
  saveMigratedEmbedding,
  stripLegacyAutoPrefix,
  verifyLegacyMemoryNotes,
} from "./legacy-memory-migration";
import { hashMemorySource } from "./memory-extraction-store";
import { openLocalD1, type LocalD1 } from "./test/local-d1";
import {
  v2ConversationTable,
  v2LegacyImportTable,
  v2MemorySourceTable,
  v2MemoryTable,
  v2MemoryTombstoneTable,
  v2MessageTable,
} from "./v2-schema";

const LEGACY_USER = "rit78db-legacy";
const OTHER_USER = "rit78db-other";
const TARGET = "local";
const NOW = 1794190000000;

const id = (name: string) => `rit78db-${name}`;

const seedUser = async (local: LocalD1, userId: string) => {
  await local.db
    .insert(userTable)
    .values({ id: userId, email: `${userId}@test`, createdAt: NOW })
    .onConflictDoNothing();
};

const seedCharacter = async (local: LocalD1, characterId: string) => {
  await local.db
    .insert(characterTable)
    .values({
      id: characterId,
      userId: LEGACY_USER,
      name: `char-${characterId}`,
      systemPrompt: "test",
      greeting: "hi",
      tags: [],
      createdAt: NOW,
    })
    .onConflictDoNothing();
};

const seedLegacyConversation = async (
  local: LocalD1,
  name: string,
  characterId: string,
  userId = LEGACY_USER,
) => {
  await local.db.insert(conversationTable).values({
    id: id(`conv-${name}`),
    userId,
    characterId,
    title: "t",
    createdAt: NOW,
    updatedAt: NOW,
  });
};

const seedLegacyMessage = async (
  local: LocalD1,
  name: string,
  conversation: string,
  characterId: string,
  role: "user" | "assistant",
  content: string,
  createdAt: number,
) => {
  await local.db.insert(messageTable).values({
    id: id(`msg-${name}`),
    conversationId: id(`conv-${conversation}`),
    userId: LEGACY_USER,
    characterId,
    role,
    content,
    createdAt,
  });
};

const seedV2Conversation = async (
  local: LocalD1,
  name: string,
  characterId: string,
  opts: { legacySourceUserId?: string | null; userId?: string; updatedAt?: number } = {},
) => {
  await local.db.insert(v2ConversationTable).values({
    id: id(`v2c-${name}`),
    userId: opts.userId ?? TARGET,
    legacySourceUserId: opts.legacySourceUserId ?? null,
    characterId,
    title: "",
    threadId: id(`v2c-${name}`),
    promptVersion: "legacy-import-v1",
    createdAt: NOW,
    updatedAt: opts.updatedAt ?? NOW,
  });
};

const seedV2Message = async (
  local: LocalD1,
  name: string,
  conversation: string,
  turn: number,
  role: "user" | "assistant",
  content = `content-${name}`,
) => {
  await local.db.insert(v2MessageTable).values({
    id: id(`msg-${name}`),
    conversationId: id(`v2c-${conversation}`),
    turn,
    role,
    content,
    createdAt: NOW + turn,
  });
};

const seedNote = async (
  local: LocalD1,
  name: string,
  characterId: string,
  content: string,
  sourceMessageName?: string,
) => {
  await local.db.insert(memoryNoteTable).values({
    id: id(`note-${name}`),
    userId: LEGACY_USER,
    characterId,
    content,
    sourceMessageId: sourceMessageName ? id(`msg-${sourceMessageName}`) : null,
    createdAt: NOW,
  });
};

const migrate = (local: LocalD1, apply = true) =>
  migrateLegacyMemoryNotes(local.db, {
    sourceUserId: LEGACY_USER,
    targetUserId: TARGET,
    apply,
  });

describe("migrateLegacyMemoryNotes", () => {
  let local: LocalD1;
  const chars = {
    a: id("char-a"),
    b: id("char-b"),
    none: id("char-none"),
    nouser: id("char-nouser"),
    other: id("char-other"),
  };

  beforeAll(async () => {
    local = await openLocalD1();
    await seedUser(local, LEGACY_USER);
    await seedUser(local, OTHER_USER);
    for (const c of Object.values(chars)) await seedCharacter(local, c);

    // 旧側: 会話と発言（発言 id は RIT-77 で同じ id のまま v2_message へ移った前提）。
    await seedLegacyConversation(local, "a1", chars.a);
    await seedLegacyMessage(local, "a1-u1", "a1", chars.a, "user", "古い自分の発言", NOW + 1);
    await seedLegacyMessage(local, "a1-a2", "a1", chars.a, "assistant", "相手の返事", NOW + 2);
    await seedLegacyMessage(local, "a1-u3", "a1", chars.a, "user", "三番目の自分の発言", NOW + 3);
    await seedLegacyConversation(local, "a2", chars.a);
    await seedLegacyMessage(local, "a2-u1", "a2", chars.a, "user", "新しい自分の発言", NOW + 3);
    await seedLegacyConversation(local, "b1", chars.b);
    await seedLegacyMessage(local, "b1-u1", "b1", chars.b, "user", "B の自分の発言", NOW + 4);

    // v2 側（移行済みの会話と発言）。
    await seedV2Conversation(local, "a1", chars.a, {
      legacySourceUserId: LEGACY_USER,
      updatedAt: NOW - 1000,
    });
    await seedV2Message(local, "a1-u1", "a1", 1, "user");
    await seedV2Message(local, "a1-a2", "a1", 2, "assistant");
    await seedV2Message(local, "a1-u3", "a1", 3, "user");
    await seedV2Conversation(local, "a2", chars.a, {
      legacySourceUserId: LEGACY_USER,
      updatedAt: NOW,
    });
    await seedV2Message(local, "a2-u1", "a2", 1, "user");
    // キャラ B の会話（混ざらない事の検査用）。
    await seedV2Conversation(local, "b1", chars.b, { legacySourceUserId: LEGACY_USER });
    await seedV2Message(local, "b1-u1", "b1", 1, "user");
    // 自分の発言が無い会話と、別の利用者の会話。
    await seedV2Conversation(local, "d1", chars.nouser, { legacySourceUserId: LEGACY_USER });
    await seedV2Message(local, "d1-a1", "d1", 1, "assistant");
    await seedV2Conversation(local, "e1", chars.other, {
      userId: OTHER_USER,
      updatedAt: NOW,
    });
    await seedV2Message(local, "e1-u1", "e1", 1, "user");
  });

  afterAll(async () => {
    await local.d1.batch([
      local.d1.prepare("DELETE FROM v2_memory_source WHERE memory_id LIKE 'legacy-mn-rit78db-%'"),
      local.d1.prepare("DELETE FROM v2_memory WHERE id LIKE 'legacy-mn-rit78db-%'"),
      local.d1.prepare("DELETE FROM v2_legacy_import WHERE legacy_table = 'memory_note'").bind(),
      local.d1.prepare("DELETE FROM v2_memory_tombstone"),
      local.d1.prepare("DELETE FROM v2_message WHERE id LIKE 'rit78db-%'"),
      local.d1.prepare("DELETE FROM v2_conversation WHERE id LIKE 'rit78db-%'"),
      local.d1.prepare("DELETE FROM message WHERE id LIKE 'rit78db-%'"),
      local.d1.prepare("DELETE FROM conversation WHERE id LIKE 'rit78db-%'"),
      local.d1.prepare("DELETE FROM memory_note WHERE id LIKE 'rit78db-%'"),
      local.d1.prepare("DELETE FROM character WHERE id LIKE 'rit78db-%'"),
      local.d1.prepare("DELETE FROM user WHERE id LIKE 'rit78db-%'"),
    ]);
    await local.dispose();
  });

  it("メモ 1 件が v2_memory・v2_memory_source・台帳の 3 行になる（FR-1）", async () => {
    await seedNote(local, "n1", chars.a, "コーヒーは砂糖なし", "a1-u3");
    const report = await migrate(local);
    expect(report.insertedMemories).toBe(1);

    const memory = await local.db
      .select()
      .from(v2MemoryTable)
      .where(eq(v2MemoryTable.id, legacyMemoryId(id("note-n1"))));
    expect(memory).toHaveLength(1);
    expect(memory[0]).toMatchObject({
      conversationId: id("v2c-a1"),
      kind: "fact",
      content: "コーヒーは砂糖なし",
      pinned: 0,
      sourceTurn: 3,
      createdAt: NOW,
    });
    const source = await local.db
      .select()
      .from(v2MemorySourceTable)
      .where(eq(v2MemorySourceTable.memoryId, legacyMemoryId(id("note-n1"))));
    expect(source).toHaveLength(1);
    expect(source[0]).toMatchObject({
      sourceMessageId: id("msg-a1-u3"),
      importance: 3,
    });
    const ledger = await local.db
      .select()
      .from(v2LegacyImportTable)
      .where(
        and(
          eq(v2LegacyImportTable.legacyTable, "memory_note"),
          eq(v2LegacyImportTable.legacyId, id("note-n1")),
        ),
      );
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({
      v2Id: legacyMemoryId(id("note-n1")),
      conversationId: id("v2c-a1"),
      sourceUserId: LEGACY_USER,
      targetUserId: TARGET,
      contentHash: await hashMemorySource("コーヒーは砂糖なし"),
    });
  });

  it("[auto] を取り除いて写す（FR-4）", async () => {
    await seedNote(local, "n2", chars.a, "[auto] 紅茶も好き", "a1-u1");
    const report = await migrate(local);
    const memory = await local.db
      .select()
      .from(v2MemoryTable)
      .where(eq(v2MemoryTable.id, legacyMemoryId(id("note-n2"))));
    expect(memory[0]?.content).toBe("紅茶も好き");
    expect(stripLegacyAutoPrefix("[auto] x")).toBe("x");
    expect(report.insertedMemories).toBe(1);
  });

  it("assistant の出どころは番号がそれ以下の起きている自分の発言（FR-2 その 1）", async () => {
    // msg-a1-a2 は turn 2 の assistant。turn ≤ 2 の起きている自分の発言は u1（turn 1）。
    await seedNote(local, "n3", chars.a, "覚えた事", "a1-a2");
    await migrate(local);
    const memory = await local.db
      .select()
      .from(v2MemoryTable)
      .where(eq(v2MemoryTable.id, legacyMemoryId(id("note-n3"))));
    expect(memory[0]).toMatchObject({ conversationId: id("v2c-a1"), sourceTurn: 1 });
    const source = await local.db
      .select()
      .from(v2MemorySourceTable)
      .where(eq(v2MemorySourceTable.memoryId, legacyMemoryId(id("note-n3"))));
    expect(source[0]?.sourceMessageId).toBe(id("msg-a1-u1"));
  });

  it("発言が無ければ移した会話のうち最新に付き、出どころは最後の自分の発言（FR-2 その 2）", async () => {
    await seedNote(local, "n4", chars.a, "どこからの記憶か不明");
    const report = await migrate(local);
    expect(report.insertedMemories).toBe(1);
    const memory = await local.db
      .select()
      .from(v2MemoryTable)
      .where(eq(v2MemoryTable.id, legacyMemoryId(id("note-n4"))));
    // a1・a2 のうち updated_at が大きい a2 に付く。
    expect(memory[0]?.conversationId).toBe(id("v2c-a2"));
    expect(memory[0]?.sourceTurn).toBe(1);
    const source = await local.db
      .select()
      .from(v2MemorySourceTable)
      .where(eq(v2MemorySourceTable.memoryId, legacyMemoryId(id("note-n4"))));
    expect(source[0]?.sourceMessageId).toBe(id("msg-a2-u1"));
  });

  it("会話が無ければ数えて飛ばす（skippedNoConversation）", async () => {
    await seedNote(local, "n5", chars.none, "行き場の無い記憶");
    const report = await migrate(local);
    expect(report.skippedNoConversation).toBe(1);
    const memory = await local.db
      .select()
      .from(v2MemoryTable)
      .where(eq(v2MemoryTable.id, legacyMemoryId(id("note-n5"))));
    expect(memory).toHaveLength(0);
  });

  it("自分の発言が無ければ数えて飛ばす（skippedNoUserMessage）", async () => {
    await seedNote(local, "n6", chars.nouser, "発言の無い会話の記憶");
    const report = await migrate(local);
    expect(report.skippedNoUserMessage).toBe(1);
    const memory = await local.db
      .select()
      .from(v2MemoryTable)
      .where(eq(v2MemoryTable.id, legacyMemoryId(id("note-n6"))));
    expect(memory).toHaveLength(0);
  });

  it("別の利用者の会話には付かない（FR-3）", async () => {
    await seedNote(local, "n7", chars.other, "別の利用者の会話しか無い");
    const report = await migrate(local);
    expect(report.skippedNoConversation).toBeGreaterThanOrEqual(1);
    const memory = await local.db
      .select()
      .from(v2MemoryTable)
      .where(eq(v2MemoryTable.id, legacyMemoryId(id("note-n7"))));
    expect(memory).toHaveLength(0);
  });

  it("別のキャラの会話には付かない（FR-3）", async () => {
    await seedNote(local, "n8", chars.b, "キャラ B の記憶");
    await migrate(local);
    const memory = await local.db
      .select()
      .from(v2MemoryTable)
      .where(eq(v2MemoryTable.id, legacyMemoryId(id("note-n8"))));
    // キャラ A の会話ではなくキャラ B の会話に付く。
    expect(memory[0]?.conversationId).toBe(id("v2c-b1"));
    const aMemories = await local.db
      .select()
      .from(v2MemoryTable)
      .where(eq(v2MemoryTable.conversationId, id("v2c-b1")));
    expect(aMemories.map((row) => row.content)).toEqual(["キャラ B の記憶"]);
  });

  it("v2 で消した記憶は戻らない（skippedDeletedInV2・FR-7）", async () => {
    await seedNote(local, "n9", chars.b, "消したはずの記憶");
    // 台帳に行が在って v2_memory に行が無い = v2 で消した。
    await local.db.insert(v2LegacyImportTable).values({
      legacyTable: "memory_note",
      legacyId: id("note-n9"),
      v2Id: legacyMemoryId(id("note-n9")),
      conversationId: id("v2c-b1"),
      sourceUserId: LEGACY_USER,
      targetUserId: TARGET,
      contentHash: await hashMemorySource("消したはずの記憶"),
      importedAt: NOW,
    });
    const report = await migrate(local);
    expect(report.skippedDeletedInV2).toBe(1);
    const memory = await local.db
      .select()
      .from(v2MemoryTable)
      .where(eq(v2MemoryTable.id, legacyMemoryId(id("note-n9"))));
    expect(memory).toHaveLength(0);
  });

  it("消した印が在れば写さない（skippedTombstoned・FR-7）", async () => {
    await seedNote(local, "n10", chars.b, "手で消した記憶");
    await local.db.insert(v2MemoryTombstoneTable).values({
      conversationId: id("v2c-b1"),
      contentHash: await hashMemorySource("手で消した記憶"),
      createdAt: NOW,
    });
    const report = await migrate(local);
    expect(report.skippedTombstoned).toBe(1);
    const memory = await local.db
      .select()
      .from(v2MemoryTable)
      .where(eq(v2MemoryTable.id, legacyMemoryId(id("note-n10"))));
    expect(memory).toHaveLength(0);
  });

  it("書き換えた記憶を上書きしない（FR-8）", async () => {
    await seedNote(local, "n11", chars.b, "元の本文");
    await migrate(local);
    await local.db
      .update(v2MemoryTable)
      .set({ content: "v2 で書き換えた本文", editedAt: NOW + 1 })
      .where(eq(v2MemoryTable.id, legacyMemoryId(id("note-n11"))));
    const report = await migrate(local);
    expect(report.insertedMemories).toBe(0);
    expect(report.alreadyImported).toBeGreaterThanOrEqual(1);
    const memory = await local.db
      .select()
      .from(v2MemoryTable)
      .where(eq(v2MemoryTable.id, legacyMemoryId(id("note-n11"))));
    expect(memory[0]?.content).toBe("v2 で書き換えた本文");
  });

  it("旧の本文が変わっていれば source_changed で v2 を変えない", async () => {
    await seedNote(local, "n12", chars.b, "移した時の本文");
    await migrate(local);
    // 旧側の本文が後から変わった状態を模す（台帳のハッシュと今の本文が違う）。
    await local.db
      .update(memoryNoteTable)
      .set({ content: "後から書き換えられた旧の本文" })
      .where(eq(memoryNoteTable.id, id("note-n12")));
    const report = await migrate(local);
    expect(report.failures).toEqual([{ noteId: id("note-n12"), code: "source_changed" }]);
    const memory = await local.db
      .select()
      .from(v2MemoryTable)
      .where(eq(v2MemoryTable.id, legacyMemoryId(id("note-n12"))));
    expect(memory[0]?.content).toBe("移した時の本文");
  });

  it("台帳の無い頃に写した記憶は台帳と出どころを補う（backfill）", async () => {
    await seedNote(local, "n13", chars.b, "[auto] 台帳の無い頃の記憶");
    // 台帳も出どころも無い、source_turn も空の古い写し。
    await local.db.insert(v2MemoryTable).values({
      id: legacyMemoryId(id("note-n13")),
      conversationId: id("v2c-b1"),
      kind: "fact",
      content: "[auto] 台帳の無い頃の記憶",
      createdAt: NOW,
    });
    const report = await migrate(local);
    expect(report.alreadyImported).toBeGreaterThanOrEqual(1);
    expect(report.insertedMemories).toBe(0);
    const memory = await local.db
      .select()
      .from(v2MemoryTable)
      .where(eq(v2MemoryTable.id, legacyMemoryId(id("note-n13"))));
    expect(memory[0]?.content).toBe("台帳の無い頃の記憶");
    expect(memory[0]?.sourceTurn).toBe(1);
    const source = await local.db
      .select()
      .from(v2MemorySourceTable)
      .where(eq(v2MemorySourceTable.memoryId, legacyMemoryId(id("note-n13"))));
    expect(source).toHaveLength(1);
    const ledger = await local.db
      .select()
      .from(v2LegacyImportTable)
      .where(
        and(
          eq(v2LegacyImportTable.legacyTable, "memory_note"),
          eq(v2LegacyImportTable.legacyId, id("note-n13")),
        ),
      );
    expect(ledger).toHaveLength(1);
  });

  it("2 回続けて流すと 2 回目は insertedMemories 0（冪等）", async () => {
    await seedNote(local, "n14", chars.b, "冪等の記憶");
    const first = await migrate(local);
    const second = await migrate(local);
    expect(first.insertedMemories).toBe(1);
    expect(second.insertedMemories).toBe(0);
    expect(second.alreadyImported).toBeGreaterThanOrEqual(1);
    const rows = await local.db
      .select()
      .from(v2MemoryTable)
      .where(eq(v2MemoryTable.id, legacyMemoryId(id("note-n14"))));
    expect(rows).toHaveLength(1);
  });

  it("確認だけは件数を返すだけで何も書かない", async () => {
    await seedNote(local, "n15", chars.b, "確認だけの記憶");
    const report = await migrate(local, false);
    expect(report.insertedMemories).toBe(1);
    const memory = await local.db
      .select()
      .from(v2MemoryTable)
      .where(eq(v2MemoryTable.id, legacyMemoryId(id("note-n15"))));
    expect(memory).toHaveLength(0);
  });

  it("expected と計画が違えば LegacyPlanChangedError で何も書かない", async () => {
    await seedNote(local, "n16", chars.b, "ずれのある記憶");
    await expect(
      migrateLegacyMemoryNotes(local.db, {
        sourceUserId: LEGACY_USER,
        targetUserId: TARGET,
        apply: true,
        expected: { insertedMemories: 0 },
      }),
    ).rejects.toThrow("確認だけで見た件数と計画が変わっている");
    const memory = await local.db
      .select()
      .from(v2MemoryTable)
      .where(eq(v2MemoryTable.id, legacyMemoryId(id("note-n16"))));
    expect(memory).toHaveLength(0);
  });

  it("verify-memory の状態: not_imported・skipped・deleted_in_v2・source_changed・edited_in_v2・not_indexed・match", async () => {
    // 直前のテストまでの状態をそのまま使う: n1（match への途中）・n5（skipped）・n9（deleted_in_v2）。
    // match にするには embedding と出どころの行が要る。
    const vector = Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : i / 1024));
    await saveMigratedEmbedding(local.db, legacyMemoryId(id("note-n1")), vector);
    // edited_in_v2: n11 は上のテストで書き換え済み。
    // source_changed: n12 は上のテストで旧の本文が変わっている。
    // not_indexed: n2 は出どころの行も embedding も在るはず… embedding を消して作る。
    await local.db
      .update(v2MemoryTable)
      .set({ embedding: null })
      .where(eq(v2MemoryTable.id, legacyMemoryId(id("note-n2"))));
    const verify = await verifyLegacyMemoryNotes(local.db, {
      sourceUserId: LEGACY_USER,
      targetUserId: TARGET,
    });
    const byNote = new Map(verify.items.map((item) => [item.noteId, item.status]));
    expect(byNote.get(id("note-n1"))).toBe("match");
    expect(byNote.get(id("note-n2"))).toBe("not_indexed");
    expect(byNote.get(id("note-n5"))).toBe("skipped");
    expect(byNote.get(id("note-n9"))).toBe("deleted_in_v2");
    expect(byNote.get(id("note-n11"))).toBe("edited_in_v2");
    expect(byNote.get(id("note-n12"))).toBe("source_changed");
    expect(byNote.get(id("note-n15"))).toBe("not_imported");
  });

  it("旧表（memory_note）の行数と本文は変わらない（NFR-4）", async () => {
    const before = await local.db
      .select({ id: memoryNoteTable.id, content: memoryNoteTable.content })
      .from(memoryNoteTable)
      .where(eq(memoryNoteTable.userId, LEGACY_USER));
    await migrate(local);
    const after = await local.db
      .select({ id: memoryNoteTable.id, content: memoryNoteTable.content })
      .from(memoryNoteTable)
      .where(eq(memoryNoteTable.userId, LEGACY_USER));
    expect(after).toEqual(before);
  });
});
