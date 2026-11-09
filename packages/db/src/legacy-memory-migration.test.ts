import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { characterTable } from "../../../src/schema/character";
import { conversationTable } from "../../../src/schema/conversation";
import { memoryNoteTable } from "../../../src/schema/memory-note";
import { userTable } from "../../../src/schema/user";

import {
  legacyMemoryId,
  migrateMemoryNotes,
  saveMigratedEmbedding,
} from "./legacy-memory-migration";
import { openLocalD1, type LocalD1 } from "./test/local-d1";
import { v2ConversationTable, v2MemoryTable } from "./v2-schema";

const LEGACY_USER = "rit78-legacy-user";
const TARGET_USER = "rit78-target-user";
const NOW = 1794190000000;

const insertUser = async (local: LocalD1, id: string) => {
  await local.db
    .insert(userTable)
    .values({ id, email: `${id}@test`, createdAt: NOW })
    .onConflictDoNothing();
};

const insertLegacyConversation = async (local: LocalD1, id: string, characterId: string) => {
  await local.db
    .insert(conversationTable)
    .values({ id, userId: LEGACY_USER, characterId, title: "t", createdAt: NOW, updatedAt: NOW })
    .onConflictDoNothing();
};

const insertV2Conversation = async (
  local: LocalD1,
  id: string,
  characterId: string,
  legacySourceUserId: string | null,
) => {
  await local.db.insert(v2ConversationTable).values({
    id,
    userId: TARGET_USER,
    legacySourceUserId,
    characterId,
    title: "",
    threadId: `thread-${id}`,
    promptVersion: "legacy-import-v1",
    createdAt: NOW,
    updatedAt: NOW,
  });
};

const insertNote = async (local: LocalD1, id: string, characterId: string, content: string) => {
  await local.db.insert(memoryNoteTable).values({
    id,
    userId: LEGACY_USER,
    characterId,
    content,
    createdAt: NOW,
  });
};

describe("migrateMemoryNotes", () => {
  let local: LocalD1;
  let charA: string;
  let charB: string;
  let charNoConv: string;

  beforeAll(async () => {
    local = await openLocalD1();
    const chars = await local.db.select({ id: characterTable.id }).from(characterTable).limit(3);
    if (chars.length < 3) throw new Error("ローカル D1 にキャラが3件必要");
    [charA, charB, charNoConv] = chars.map((c) => c.id);
    await insertUser(local, LEGACY_USER);
    await insertUser(local, TARGET_USER);
    await insertLegacyConversation(local, `rit78-conv-a`, charA);
    await insertLegacyConversation(local, `rit78-conv-b`, charB);
    await insertV2Conversation(local, `rit78-v2conv-a`, charA, LEGACY_USER);
    await insertV2Conversation(local, `rit78-v2conv-b`, charB, null);
    // charNoConv には v2_conversation を作らん → 移行先無しでスキップになるはず。
    await insertNote(local, "rit78-note-a1", charA, "Aの記憶1");
    await insertNote(local, "rit78-note-a2", charA, "Aの記憶2");
    await insertNote(local, "rit78-note-b1", charB, "Bの記憶1");
    await insertNote(local, "rit78-note-c1", charNoConv, "会話無しの記憶");
  });

  afterAll(async () => {
    await local.db.delete(v2MemoryTable).where(eq(v2MemoryTable.conversationId, "rit78-v2conv-a"));
    await local.db.delete(v2MemoryTable).where(eq(v2MemoryTable.conversationId, "rit78-v2conv-b"));
    await local.db.delete(memoryNoteTable).where(eq(memoryNoteTable.userId, LEGACY_USER));
    await local.db.delete(v2ConversationTable).where(eq(v2ConversationTable.id, "rit78-v2conv-a"));
    await local.db.delete(v2ConversationTable).where(eq(v2ConversationTable.id, "rit78-v2conv-b"));
    await local.db.delete(conversationTable).where(eq(conversationTable.userId, LEGACY_USER));
    await local.dispose();
  });

  it("memory_note が会話へ移され、会話無しはスキップ、件数が一致する（RIT-78）", async () => {
    const report = await migrateMemoryNotes(local.db, {
      sourceUserId: LEGACY_USER,
      targetUserId: TARGET_USER,
    });
    expect(report.notesTotal).toBeGreaterThanOrEqual(4);
    const a = report.pairs.find((p) => p.characterId === charA);
    const b = report.pairs.find((p) => p.characterId === charB);
    const c = report.pairs.find((p) => p.characterId === charNoConv);
    expect(a?.conversationId).toBe("rit78-v2conv-a");
    expect(b?.conversationId).toBe("rit78-v2conv-b");
    expect(c?.conversationId).toBeNull();
    expect(c?.skipped).toBe(1);

    // 会話へ入った記憶は内容一致・クロスキャラ無し。
    const aMem = await local.db
      .select()
      .from(v2MemoryTable)
      .where(eq(v2MemoryTable.conversationId, "rit78-v2conv-a"));
    expect(aMem.map((m) => m.content).sort()).toEqual(["Aの記憶1", "Aの記憶2"]);
    const bMem = await local.db
      .select()
      .from(v2MemoryTable)
      .where(eq(v2MemoryTable.conversationId, "rit78-v2conv-b"));
    expect(bMem.map((m) => m.content)).toEqual(["Bの記憶1"]);
    expect(report.migrated).toBe(3);
    expect(report.skippedNoConversation).toBe(1);
  });

  it("2回実行しても重複しない（冪等）", async () => {
    const again = await migrateMemoryNotes(local.db, {
      sourceUserId: LEGACY_USER,
      targetUserId: TARGET_USER,
    });
    const aMem = await local.db
      .select()
      .from(v2MemoryTable)
      .where(eq(v2MemoryTable.conversationId, "rit78-v2conv-a"));
    expect(aMem.length).toBe(2);
    expect(again.migrated).toBe(3);
  });

  it("dryRun は件数だけ数えて書き込まん", async () => {
    await local.db.delete(v2MemoryTable).where(eq(v2MemoryTable.conversationId, "rit78-v2conv-a"));
    const report = await migrateMemoryNotes(local.db, {
      sourceUserId: LEGACY_USER,
      targetUserId: TARGET_USER,
      dryRun: true,
    });
    expect(report.migrated).toBe(3);
    const aMem = await local.db
      .select()
      .from(v2MemoryTable)
      .where(eq(v2MemoryTable.conversationId, "rit78-v2conv-a"));
    expect(aMem.length).toBe(0);
    // 後続テストのため戻す
    await migrateMemoryNotes(local.db, { sourceUserId: LEGACY_USER, targetUserId: TARGET_USER });
  });

  it("埋め込みを行へ書き戻せる", async () => {
    const id = legacyMemoryId("rit78-note-a1");
    const values = Array.from({ length: 1024 }, (_, i) => i / 1024);
    await saveMigratedEmbedding(local.db, id, values);
    const row = await local.db
      .select({ embedding: v2MemoryTable.embedding })
      .from(v2MemoryTable)
      .where(eq(v2MemoryTable.id, id));
    expect(row[0]?.embedding).not.toBeNull();
    expect(row[0]?.embedding?.byteLength).toBe(4096);
  });
});
