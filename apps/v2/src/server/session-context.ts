import {
  createManagedMemoryStore,
  ensureSessionContext,
  readSessionContext,
  registerMemoryConversation,
  type MemoryScope,
  type SessionContext,
  type V2Db,
} from "@v2/db";
import { PROMPT_VERSION } from "@v2/prompt";

import { adoptedSourceQuery } from "./adopted-source-query";

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
  const rows = await db.all<{ id: string; turn: number }>(adoptedSourceQuery(session));
  const store = createManagedMemoryStore(db, memoryScopeOf(session));
  for (const row of rows) {
    await store.registerCommittedSource({
      messageId: row.id,
      revision: 1,
      characterVersionId: session.characterVersionId,
    });
  }
};

export const resolveTurnSession = (db: V2Db, scope: Scope): Promise<SessionContext | null> =>
  readSessionContext(db, scope);
