// RIT-115: キャラの設定資料（原本は R2、断片はここ）。検索・削除・入切は
// 全部 D1 側の行を正とする。R2 側は原本の置き場で、一覧は走らん。
import { and, eq, inArray } from "drizzle-orm";

import {
  v2CharacterDocumentChunkTable,
  v2CharacterDocumentTable,
} from "./v2-schema";

import type { V2Db } from "./client";

export type CharacterDocument = typeof v2CharacterDocumentTable.$inferSelect;
export type CharacterDocumentChunk = typeof v2CharacterDocumentChunkTable.$inferSelect;

export const DOCUMENT_MAX_PER_CHARACTER = 15;

export const insertCharacterDocument = async (
  db: V2Db,
  document: typeof v2CharacterDocumentTable.$inferInsert,
): Promise<void> => {
  await db.insert(v2CharacterDocumentTable).values(document);
};

export const insertDocumentChunks = async (
  db: V2Db,
  chunks: (typeof v2CharacterDocumentChunkTable.$inferInsert)[],
): Promise<void> => {
  for (const chunk of chunks) await db.insert(v2CharacterDocumentChunkTable).values(chunk);
};

export const countCharacterDocuments = async (
  db: V2Db,
  characterId: string,
  userId: string,
): Promise<number> =>
  (
    await db
      .select({ id: v2CharacterDocumentTable.id })
      .from(v2CharacterDocumentTable)
      .where(
        and(
          eq(v2CharacterDocumentTable.characterId, characterId),
          eq(v2CharacterDocumentTable.userId, userId),
        ),
      )
  ).length;

export const loadCharacterDocument = async (
  db: V2Db,
  documentId: string,
  userId: string,
): Promise<CharacterDocument | null> => {
  const [row] = await db
    .select()
    .from(v2CharacterDocumentTable)
    .where(
      and(
        eq(v2CharacterDocumentTable.id, documentId),
        eq(v2CharacterDocumentTable.userId, userId),
      ),
    )
    .limit(1);
  return row ?? null;
};

export const listCharacterDocuments = async (
  db: V2Db,
  characterId: string,
  userId: string,
): Promise<CharacterDocument[]> =>
  db
    .select()
    .from(v2CharacterDocumentTable)
    .where(
      and(
        eq(v2CharacterDocumentTable.characterId, characterId),
        eq(v2CharacterDocumentTable.userId, userId),
      ),
    )
    .orderBy(v2CharacterDocumentTable.createdAt);

export const setCharacterDocumentStatus = async (
  db: V2Db,
  documentId: string,
  userId: string,
  status: "active" | "disabled",
): Promise<boolean> => {
  const result = await db
    .update(v2CharacterDocumentTable)
    .set({ status })
    .where(
      and(
        eq(v2CharacterDocumentTable.id, documentId),
        eq(v2CharacterDocumentTable.userId, userId),
      ),
    );
  return (result.meta.changes ?? 0) > 0;
};

export const loadDocumentChunks = async (
  db: V2Db,
  documentId: string,
): Promise<CharacterDocumentChunk[]> =>
  db
    .select()
    .from(v2CharacterDocumentChunkTable)
    .where(eq(v2CharacterDocumentChunkTable.documentId, documentId))
    .orderBy(v2CharacterDocumentChunkTable.seq);

export const deleteCharacterDocument = async (
  db: V2Db,
  documentId: string,
  userId: string,
): Promise<void> => {
  await db
    .delete(v2CharacterDocumentChunkTable)
    .where(eq(v2CharacterDocumentChunkTable.documentId, documentId));
  await db
    .delete(v2CharacterDocumentTable)
    .where(
      and(
        eq(v2CharacterDocumentTable.id, documentId),
        eq(v2CharacterDocumentTable.userId, userId),
      ),
    );
};

// 検索時に使う。切られた資料（disabled）はどんな問いにも出さん（RIT-116 の前提）。
export const loadActiveDocumentChunks = async (
  db: V2Db,
  characterId: string,
  userId: string,
  chunkIds: string[],
): Promise<(CharacterDocumentChunk & { documentTitle: string })[]> => {
  if (chunkIds.length === 0) return [];
  return db
    .select({
      id: v2CharacterDocumentChunkTable.id,
      documentId: v2CharacterDocumentChunkTable.documentId,
      seq: v2CharacterDocumentChunkTable.seq,
      content: v2CharacterDocumentChunkTable.content,
      vectorId: v2CharacterDocumentChunkTable.vectorId,
      documentTitle: v2CharacterDocumentTable.title,
    })
    .from(v2CharacterDocumentChunkTable)
    .innerJoin(
      v2CharacterDocumentTable,
      eq(v2CharacterDocumentTable.id, v2CharacterDocumentChunkTable.documentId),
    )
    .where(
      and(
        inArray(v2CharacterDocumentChunkTable.id, chunkIds),
        eq(v2CharacterDocumentTable.characterId, characterId),
        eq(v2CharacterDocumentTable.userId, userId),
        eq(v2CharacterDocumentTable.status, "active"),
      ),
    )
    .orderBy(v2CharacterDocumentChunkTable.documentId, v2CharacterDocumentChunkTable.seq);
};
