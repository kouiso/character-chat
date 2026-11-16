// 記憶の使用記録（RIT-92）。返事を作る時に指示文へ入った記憶の id を
// （conversation_id, turn）単位で残し、「さっきの返事で使った」バッジに使う。
// 同じ turn を保存し直す時は入れ替え（消してから挿入）— 再生成で枝が変わっても
// 古い枝で使った記憶が残り続けんようにするため。
import { and, desc, eq } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

import { v2MemoryUseTable } from "./v2-schema";

import type { V2Db } from "./client";

// saveTurn のバッチへ差し込む文。（conversationId, turn）の既存行を消してから
// memoryIds の分だけ挿入する。空配列なら削除だけ残る（そのターンは記憶を使わんかった）。
export const memoryUseStatements = (
  db: V2Db,
  input: { conversationId: string; turn: number; memoryIds: string[] },
  now: number,
): BatchItem<"sqlite">[] => {
  const sameTurn = and(
    eq(v2MemoryUseTable.conversationId, input.conversationId),
    eq(v2MemoryUseTable.turn, input.turn),
  );
  return [
    db.delete(v2MemoryUseTable).where(sameTurn),
    ...input.memoryIds.map((memoryId) =>
      db
        .insert(v2MemoryUseTable)
        .values({
          conversationId: input.conversationId,
          turn: input.turn,
          memoryId,
          createdAt: now,
        })
        .onConflictDoNothing(),
    ),
  ];
};

// 一番新しい記録がある turn の記憶 id 一式。記録が無ければ空集合。
export const loadLastTurnUsedMemoryIds = async (
  db: V2Db,
  conversationId: string,
): Promise<Set<string>> => {
  const [latest] = await db
    .select({ turn: v2MemoryUseTable.turn })
    .from(v2MemoryUseTable)
    .where(eq(v2MemoryUseTable.conversationId, conversationId))
    .orderBy(desc(v2MemoryUseTable.turn))
    .limit(1);
  if (!latest) return new Set();
  const rows = await db
    .select({ memoryId: v2MemoryUseTable.memoryId })
    .from(v2MemoryUseTable)
    .where(
      and(
        eq(v2MemoryUseTable.conversationId, conversationId),
        eq(v2MemoryUseTable.turn, latest.turn),
      ),
    );
  return new Set(rows.map((row) => row.memoryId));
};
