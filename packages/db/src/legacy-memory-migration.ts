// RIT-78: 旧 memory_note（user_id+character_id 単位）を v2_memory（conversation 単位）へ移す。
// 移行先会話は legacy_source_user_id が同じ会話を優先し、無ければ target の最新会話。
// 会話が無い組はスキップして件数に残す（黙って落とさん）。
import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { memoryNoteTable } from "../../../src/schema/memory-note";
import { ragChunkTable } from "../../../src/schema/rag-chunk";

import { v2ConversationTable, v2MemoryTable } from "./v2-schema";

import type { V2Db } from "./client";

export type LegacyMemoryMigrationOptions = {
  sourceUserId: string;
  targetUserId: string;
  // 1 キャラだけに絞る段階実行用。未指定は全ペア。
  characterId?: string;
  dryRun?: boolean;
};

export type MemoryPairReport = {
  characterId: string;
  conversationId: string | null;
  notes: number;
  migrated: number;
  skipped: number;
};

export type LegacyMemoryMigrationReport = {
  notesTotal: number;
  migrated: number;
  skippedNoConversation: number;
  pairs: MemoryPairReport[];
  // 実行時に差し込んだ v2_memory の id。呼び出し側が埋め込み・索引に回す。
  migratedMemoryIds: string[];
};

export const legacyMemoryId = (noteId: string): string => `legacy-mn-${noteId}`;

const findTargetConversationId = async (
  db: V2Db,
  opts: { sourceUserId: string; targetUserId: string; characterId: string },
): Promise<string | null> => {
  const rows = await db
    .select({
      id: v2ConversationTable.id,
      updatedAt: v2ConversationTable.updatedAt,
      legacySourceUserId: v2ConversationTable.legacySourceUserId,
    })
    .from(v2ConversationTable)
    .where(eq(v2ConversationTable.characterId, opts.characterId))
    .orderBy(desc(v2ConversationTable.updatedAt));
  const legacy = rows.find((row) => row.legacySourceUserId === opts.sourceUserId);
  const target = rows.find((row) => row.legacySourceUserId === null);
  return (legacy ?? target)?.id ?? null;
};

export const migrateMemoryNotes = async (
  db: V2Db,
  opts: LegacyMemoryMigrationOptions,
): Promise<LegacyMemoryMigrationReport> => {
  const conditions = [eq(memoryNoteTable.userId, opts.sourceUserId)];
  if (opts.characterId) conditions.push(eq(memoryNoteTable.characterId, opts.characterId));
  const notes = await db
    .select({
      id: memoryNoteTable.id,
      characterId: memoryNoteTable.characterId,
      content: memoryNoteTable.content,
      createdAt: memoryNoteTable.createdAt,
    })
    .from(memoryNoteTable)
    .where(and(...conditions));

  const pairs = new Map<string, MemoryPairReport>();
  const migratedMemoryIds: string[] = [];
  for (const note of notes) {
    let pair = pairs.get(note.characterId);
    if (!pair) {
      pair = {
        characterId: note.characterId,
        conversationId: await findTargetConversationId(db, {
          sourceUserId: opts.sourceUserId,
          targetUserId: opts.targetUserId,
          characterId: note.characterId,
        }),
        notes: 0,
        migrated: 0,
        skipped: 0,
      };
      pairs.set(note.characterId, pair);
    }
    pair.notes += 1;
    if (!pair.conversationId) {
      pair.skipped += 1;
      continue;
    }
    const memoryId = legacyMemoryId(note.id);
    if (!opts.dryRun) {
      await db
        .insert(v2MemoryTable)
        .values({
          id: memoryId,
          conversationId: pair.conversationId,
          kind: "fact",
          content: note.content,
          createdAt: note.createdAt,
        })
        .onConflictDoNothing();
    }
    pair.migrated += 1;
    migratedMemoryIds.push(memoryId);
  }

  const pairList = [...pairs.values()];
  return {
    notesTotal: notes.length,
    migrated: pairList.reduce((sum, pair) => sum + pair.migrated, 0),
    skippedNoConversation: pairList.reduce((sum, pair) => sum + pair.skipped, 0),
    pairs: pairList,
    migratedMemoryIds,
  };
};

// 移行済みメモのうち指定 id の行を返す（埋め込み・索引の入力）。
export const loadMigratedMemories = async (db: V2Db, memoryIds: string[]) => {
  if (memoryIds.length === 0) return [];
  return db
    .select({
      id: v2MemoryTable.id,
      conversationId: v2MemoryTable.conversationId,
      kind: v2MemoryTable.kind,
      content: v2MemoryTable.content,
    })
    .from(v2MemoryTable)
    .where(inArray(v2MemoryTable.id, memoryIds));
};

// 移行したメモに埋め込みを書き戻す（float32 を little-endian の生バイトで）。
export const saveMigratedEmbedding = async (
  db: V2Db,
  memoryId: string,
  values: number[],
): Promise<void> => {
  await db
    .update(v2MemoryTable)
    .set({ embedding: sql<Buffer>`${new Uint8Array(new Float32Array(values).buffer)}` })
    .where(eq(v2MemoryTable.id, memoryId));
};

// 移行済みメモが紐づく会話→キャラの逆引き（Vectorize namespace 決定用）。
export const loadConversationCharacterMap = async (
  db: V2Db,
  conversationIds: string[],
): Promise<Map<string, string>> => {
  if (conversationIds.length === 0) return new Map();
  const rows = await db
    .select({ id: v2ConversationTable.id, characterId: v2ConversationTable.characterId })
    .from(v2ConversationTable)
    .where(inArray(v2ConversationTable.id, conversationIds));
  return new Map(rows.map((row) => [row.id, row.characterId]));
};

// 移行対象の rag_chunk（共有コーパス）を全部返す。
export const loadRagChunks = async (db: V2Db) =>
  db
    .select({
      id: ragChunkTable.id,
      type: ragChunkTable.type,
      phase: ragChunkTable.phase,
      characterId: ragChunkTable.characterId,
      text: ragChunkTable.text,
    })
    .from(ragChunkTable);

// memory_note に現れる user_id の一覧（sourceUserId 未指定時の全移行用）。
export const listLegacyMemoryUserIds = async (db: V2Db): Promise<string[]> => {
  const rows = await db.selectDistinct({ userId: memoryNoteTable.userId }).from(memoryNoteTable);
  return rows.map((row) => row.userId);
};
