import {
  v2ChunkTable,
  v2ConversationTable,
  v2MessageTable,
  type ChunkDelivery,
  type V2Db,
} from "@v2/db";
import { and, asc, eq, sql } from "drizzle-orm";

type ConversationScope = { userId: string; characterId: string; conversationId: string };
const ownerCondition = (scope: ConversationScope) =>
  and(
    eq(v2ConversationTable.id, scope.conversationId),
    eq(v2ConversationTable.userId, scope.userId),
    eq(v2ConversationTable.characterId, scope.characterId),
  );

// 画面と復旧でturnを共有し、挨拶やassistantの件数から保存位置を推測しない。
export const loadConversationMessages = (db: V2Db, scope: ConversationScope, turn?: number) =>
  db
    .select({
      turn: v2MessageTable.turn,
      role: v2MessageTable.role,
      content: v2MessageTable.content,
    })
    .from(v2MessageTable)
    .innerJoin(v2ConversationTable, eq(v2ConversationTable.id, v2MessageTable.conversationId))
    .where(
      and(
        eq(v2ConversationTable.id, scope.conversationId),
        eq(v2ConversationTable.userId, scope.userId),
        eq(v2ConversationTable.characterId, scope.characterId),
        turn === undefined ? undefined : eq(v2MessageTable.turn, turn),
      ),
    )
    .orderBy(
      asc(v2MessageTable.turn),
      sql`case ${v2MessageTable.role} when 'user' then 0 else 1 end`,
    );

export const loadConversationSnapshot = async (db: V2Db, scope: ConversationScope) => {
  const [owners, history, rows] = await db.batch([
    db
      .select({ id: v2ConversationTable.id })
      .from(v2ConversationTable)
      .where(ownerCondition(scope)),
    loadConversationMessages(db, scope),
    db
      .select({
        turn: v2MessageTable.turn,
        seq: v2ChunkTable.seq,
        text: v2ChunkTable.text,
        scheduledAt: v2ChunkTable.scheduledAt,
        createdAt: v2MessageTable.createdAt,
        generationId: v2MessageTable.generationId,
      })
      .from(v2MessageTable)
      .innerJoin(v2ConversationTable, eq(v2ConversationTable.id, v2MessageTable.conversationId))
      .leftJoin(v2ChunkTable, eq(v2ChunkTable.messageId, v2MessageTable.id))
      .where(and(ownerCondition(scope), eq(v2MessageTable.role, "assistant")))
      .orderBy(asc(v2MessageTable.turn), asc(v2ChunkTable.seq)),
  ]);
  if (owners.length === 0) return null;
  const serverNow = Date.now();
  const byTurn = new Map<number, ChunkDelivery>();
  for (const row of rows) {
    let delivery = byTurn.get(row.turn);
    if (!delivery) {
      delivery = {
        conversationId: scope.conversationId,
        turn: row.turn,
        generationId: row.generationId,
        serverNow,
        chunks: [],
      };
      byTurn.set(row.turn, delivery);
    }
    if (row.seq !== null && row.text !== null)
      delivery.chunks.push({
        seq: row.seq,
        text: row.text,
        scheduledAt: row.scheduledAt ?? row.createdAt,
      });
  }
  return {
    conversationId: scope.conversationId,
    turn: history.reduce((max, row) => Math.max(max, row.turn), 0) + 1,
    history,
    deliveries: [...byTurn.values()],
  };
};
