import {
  createManagedMemoryStore,
  ensureSessionContext,
  memorySourceTable,
  readSessionContext,
  registerMemoryConversation,
  v2ConversationTable,
  v2MessageTable,
  type MemoryScope,
  type SessionContext,
  type V2Db,
} from "@v2/db";
import { PROMPT_VERSION } from "@v2/prompt";
import { and, asc, eq, gte, sql } from "drizzle-orm";

type Scope = { ownerUserId: string; characterId: string; conversationId: string };

export const memoryScopeOf = (session: SessionContext): MemoryScope => ({
  ownerUserId: session.ownerUserId,
  characterId: session.characterId,
  conversationId: session.conversationId,
  worldlineId: session.worldlineId,
});

export const ensureTurnSession = async (db: V2Db, scope: Scope): Promise<SessionContext> => {
  const session = await ensureSessionContext(db, scope, PROMPT_VERSION);
  await registerMemoryConversation(db, memoryScopeOf(session));
  return session;
};

// 既存tombstoneを再登録で復活させず、保存後に中断した未登録出典だけ回収する。
export const registerAdoptedSources = async (db: V2Db, session: SessionContext): Promise<void> => {
  const rows = await db
    .select({ id: v2MessageTable.id, turn: v2MessageTable.turn })
    .from(v2MessageTable)
    .innerJoin(v2ConversationTable, eq(v2ConversationTable.id, v2MessageTable.conversationId))
    .where(
      and(
        eq(v2ConversationTable.id, session.conversationId),
        eq(v2ConversationTable.userId, session.ownerUserId),
        eq(v2ConversationTable.characterId, session.characterId),
        gte(v2MessageTable.turn, session.sourceStartTurn),
      ),
    )
    .orderBy(
      asc(v2MessageTable.turn),
      sql`case ${v2MessageTable.role} when 'user' then 0 else 1 end`,
    );
  const store = createManagedMemoryStore(db, memoryScopeOf(session));
  for (const row of rows) {
    const [registered] = await db
      .select({ state: memorySourceTable.state })
      .from(memorySourceTable)
      .where(
        and(
          eq(memorySourceTable.worldlineId, session.worldlineId),
          eq(memorySourceTable.messageId, row.id),
          eq(memorySourceTable.revision, 1),
        ),
      );
    if (registered) continue;
    await store.registerCommittedSource({
      messageId: row.id,
      revision: 1,
      characterVersionId: session.characterVersionId,
    });
  }
};

export const resolveTurnSession = (db: V2Db, scope: Scope): Promise<SessionContext | null> =>
  readSessionContext(db, scope);
