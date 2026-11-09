import { and, count, eq, gte } from "drizzle-orm";

import { v2ConversationTable, v2MessageTable } from "./v2-schema";

import type { V2Db } from "./client";

// ユーザー発言の回数を時点以降で数える。1日の使いすぎ止め（RIT-103）の判定材料。
export const countUserTurnsSince = async (
  db: V2Db,
  input: { userId: string; sinceMs: number },
): Promise<number> => {
  const rows = await db
    .select({ n: count() })
    .from(v2MessageTable)
    .innerJoin(v2ConversationTable, eq(v2MessageTable.conversationId, v2ConversationTable.id))
    .where(
      and(
        eq(v2ConversationTable.userId, input.userId),
        eq(v2MessageTable.role, "user"),
        gte(v2MessageTable.createdAt, input.sinceMs),
      ),
    );
  return rows[0]?.n ?? 0;
};
