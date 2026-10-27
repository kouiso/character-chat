import { and, asc, eq } from "drizzle-orm";

import { v2ChunkTable, v2ConversationTable, v2MessageTable } from "./v2-schema";

import type { V2Db } from "./client";
import type { ChunkDelivery } from "./turn-store";

export const loadChunkDeliveries = async (
  db: V2Db,
  identity: { userId: string; characterId: string; conversationId: string },
): Promise<ChunkDelivery[] | null> => {
  const owner = and(
    eq(v2ConversationTable.id, identity.conversationId),
    eq(v2ConversationTable.userId, identity.userId),
    eq(v2ConversationTable.characterId, identity.characterId),
  );
  // 空の会話とアクセスできん会話を混同せず、他の user/character の予定を返さん。
  const [conversation] = await db
    .select({ id: v2ConversationTable.id })
    .from(v2ConversationTable)
    .where(owner)
    .limit(1);
  if (!conversation) return null;
  const rows = await db
    .select({
      turn: v2MessageTable.turn,
      seq: v2ChunkTable.seq,
      text: v2ChunkTable.text,
      scheduledAt: v2ChunkTable.scheduledAt,
      createdAt: v2MessageTable.createdAt,
      generationId: v2MessageTable.generationId,
    })
    .from(v2MessageTable)
    .leftJoin(v2ChunkTable, eq(v2MessageTable.id, v2ChunkTable.messageId))
    .innerJoin(v2ConversationTable, eq(v2ConversationTable.id, v2MessageTable.conversationId))
    .where(and(owner, eq(v2MessageTable.role, "assistant")))
    .orderBy(asc(v2MessageTable.turn), asc(v2ChunkTable.seq));
  const serverNow = Date.now();
  const turns = new Map<number, ChunkDelivery>();
  for (const row of rows) {
    let delivery = turns.get(row.turn);
    if (!delivery) {
      delivery = {
        conversationId: identity.conversationId,
        turn: row.turn,
        generationId: row.generationId,
        serverNow,
        chunks: [],
      };
      turns.set(row.turn, delivery);
    }
    if (row.seq !== null && row.text !== null)
      delivery.chunks.push({
        seq: row.seq,
        text: row.text,
        scheduledAt: row.scheduledAt ?? row.createdAt,
      });
  }
  return [...turns.values()];
};
