import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import { memoryChangeSchema, memoryDeleteSchema, newMemorySchema } from "./memory-contract";
import { ConversationAccessError } from "./turn-store";
import { v2ConversationTable, v2MemoryTable } from "./v2-schema";

import type { V2Db } from "./client";
import type { MemoryChange, MemoryDelete, MemoryRecord, NewMemory } from "./memory-contract";

export type MemoryScope = { userId: string; characterId: string; conversationId: string };

export class MemoryConflictError extends Error {
  constructor() {
    super("別の画面で変更されています。最新の内容を読み直してください。");
    this.name = "MemoryConflictError";
  }
}

const ownedConversation = (db: V2Db, scope: MemoryScope) =>
  db
    .select({ id: v2ConversationTable.id })
    .from(v2ConversationTable)
    .where(
      and(
        eq(v2ConversationTable.id, scope.conversationId),
        eq(v2ConversationTable.userId, scope.userId),
        eq(v2ConversationTable.characterId, scope.characterId),
      ),
    );

const requireConversation = async (db: V2Db, scope: MemoryScope) => {
  if ((await ownedConversation(db, scope)).length === 0) throw new ConversationAccessError();
};

const columns = {
  id: v2MemoryTable.id,
  conversationId: v2MemoryTable.conversationId,
  kind: v2MemoryTable.kind,
  content: v2MemoryTable.content,
  pinned: v2MemoryTable.pinned,
  revision: v2MemoryTable.revision,
  createdAt: v2MemoryTable.createdAt,
  updatedAt: v2MemoryTable.updatedAt,
};

export const listMemories = async (db: V2Db, scope: MemoryScope): Promise<MemoryRecord[]> => {
  await requireConversation(db, scope);
  return db
    .select(columns)
    .from(v2MemoryTable)
    .where(inArray(v2MemoryTable.conversationId, ownedConversation(db, scope)))
    .orderBy(desc(v2MemoryTable.pinned), desc(v2MemoryTable.updatedAt), desc(v2MemoryTable.id));
};

export const addMemory = async (db: V2Db, scope: MemoryScope, input: NewMemory) => {
  const value = newMemorySchema.parse(input);
  await requireConversation(db, scope);
  const now = Date.now();
  const [created] = await db
    .insert(v2MemoryTable)
    .select(
      db
        .select({
          id: sql<string>`${value.id}`.as("id"),
          conversationId: sql<string>`${scope.conversationId}`.as("conversation_id"),
          kind: sql<NewMemory["kind"]>`${value.kind}`.as("kind"),
          content: sql<string>`${value.content}`.as("content"),
          sourceTurn: sql<number | null>`null`.as("source_turn"),
          embedding: sql<Buffer | null>`null`.as("embedding"),
          createdAt: sql<number>`${now}`.as("created_at"),
          updatedAt: sql<number>`${now}`.as("updated_at"),
          revision: sql<number>`0`.as("revision"),
          pinned: sql<boolean>`${value.pinned ? 1 : 0}`.as("pinned"),
        })
        .from(v2ConversationTable)
        .where(
          and(
            eq(v2ConversationTable.id, scope.conversationId),
            eq(v2ConversationTable.userId, scope.userId),
            eq(v2ConversationTable.characterId, scope.characterId),
          ),
        ),
    )
    .onConflictDoNothing()
    .returning(columns);
  if (created) return created;
  const [existing] = await db
    .select(columns)
    .from(v2MemoryTable)
    .where(
      and(
        eq(v2MemoryTable.id, value.id),
        inArray(v2MemoryTable.conversationId, ownedConversation(db, scope)),
      ),
    );
  // 応答だけ失われた追加は同じIDで再試行し、後の編集を上書きしない。
  if (
    existing &&
    existing.revision === 0 &&
    existing.content === value.content &&
    existing.kind === value.kind &&
    existing.pinned === value.pinned
  )
    return existing;
  throw new MemoryConflictError();
};

export const changeMemory = async (db: V2Db, scope: MemoryScope, input: MemoryChange) => {
  const { id, revision, ...value } = memoryChangeSchema.parse(input);
  await requireConversation(db, scope);
  const [changed] = await db
    .update(v2MemoryTable)
    .set({
      ...value,
      revision: sql`${v2MemoryTable.revision} + 1`,
      updatedAt: Date.now(),
      embedding: null,
      // 明示的な訂正は、元発言ではなく利用者自身が確定した記憶として扱う。
      sourceTurn: null,
    })
    .where(
      and(
        eq(v2MemoryTable.id, id),
        eq(v2MemoryTable.revision, revision),
        inArray(v2MemoryTable.conversationId, ownedConversation(db, scope)),
      ),
    )
    .returning(columns);
  if (!changed) throw new MemoryConflictError();
  return changed;
};

export const removeMemory = async (db: V2Db, scope: MemoryScope, input: MemoryDelete) => {
  const value = memoryDeleteSchema.parse(input);
  await requireConversation(db, scope);
  const deleted = await db
    .delete(v2MemoryTable)
    .where(
      and(
        eq(v2MemoryTable.id, value.id),
        eq(v2MemoryTable.revision, value.revision),
        inArray(v2MemoryTable.conversationId, ownedConversation(db, scope)),
      ),
    )
    .returning({ id: v2MemoryTable.id });
  if (!deleted.length) throw new MemoryConflictError();
};

export const readManualMemories = async (db: V2Db, scope: MemoryScope) =>
  db
    .select({ id: v2MemoryTable.id, content: v2MemoryTable.content })
    .from(v2MemoryTable)
    .where(
      and(
        isNull(v2MemoryTable.sourceTurn),
        inArray(v2MemoryTable.conversationId, ownedConversation(db, scope)),
      ),
    )
    .orderBy(desc(v2MemoryTable.pinned), desc(v2MemoryTable.updatedAt), desc(v2MemoryTable.id))
    .limit(100);
