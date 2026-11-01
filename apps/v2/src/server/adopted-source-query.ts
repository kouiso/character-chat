import { memorySourceTable, v2ConversationTable, v2MessageTable } from "@v2/db";
import { and, asc, eq, gte, notExists, sql } from "drizzle-orm";
import { QueryBuilder } from "drizzle-orm/sqlite-core";

import type { SessionContext } from "@v2/db";

type SourceScope = Pick<
  SessionContext,
  "conversationId" | "ownerUserId" | "characterId" | "worldlineId" | "sourceStartTurn"
>;

export const adoptedSourceQuery = (session: SourceScope) => {
  const query = new QueryBuilder();
  // 登録済みの全履歴を毎ターン読み直すN+1を避け、tombstoneも登録済みとして扱う。
  const registered = query
    .select({ id: memorySourceTable.messageId })
    .from(memorySourceTable)
    .where(
      and(
        eq(memorySourceTable.worldlineId, session.worldlineId),
        eq(memorySourceTable.messageId, v2MessageTable.id),
        eq(memorySourceTable.revision, 1),
      ),
    );
  return query
    .select({ id: v2MessageTable.id, turn: v2MessageTable.turn })
    .from(v2MessageTable)
    .innerJoin(v2ConversationTable, eq(v2ConversationTable.id, v2MessageTable.conversationId))
    .where(
      and(
        eq(v2ConversationTable.id, session.conversationId),
        eq(v2ConversationTable.userId, session.ownerUserId),
        eq(v2ConversationTable.characterId, session.characterId),
        gte(v2MessageTable.turn, session.sourceStartTurn),
        notExists(registered),
      ),
    )
    .orderBy(
      asc(v2MessageTable.turn),
      sql`case ${v2MessageTable.role} when 'user' then 0 else 1 end`,
    );
};
