// 記憶の使用記録（RIT-84 の v2_generation_memory が正本）。
// 「さっきの返事で使った」バッジは、一番新しい v2_generation（status='ok'）に
// 紐付く行を読んで出す（RIT-92 の v2_memory_use から一本化した）。
import { and, desc, eq, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

import {
  v2GenerationMemoryTable,
  v2GenerationTable,
  v2MemoryTable,
  v2MemoryUseTable,
} from "./v2-schema";

import type { V2Db } from "./client";

// saveTurn のバッチへ差し込む文。指示文へ入った順（rank）と経由（via）を残す。
// 同じ generation で保存し直す時に備えて onConflictDoNothing（再生成は別 id になる）。
// 採用から保存までの間に記憶が物理削除され得るので、親行の生存を INSERT 自体の
// 条件にする。消えた記憶は行ごと省き、FK 違反で返事ごと rollback されんようにする。
export const generationMemoryStatements = (
  db: V2Db,
  generationId: string,
  usedMemories: { id: string; via: "pinned" | "search" }[],
): BatchItem<"sqlite">[] =>
  usedMemories.map((used, rank) =>
    db
      .insert(v2GenerationMemoryTable)
      .select(
        sql`select ${generationId}, ${used.id}, ${rank}, ${used.via} where exists (select 1 from ${v2MemoryTable} where ${v2MemoryTable.id} = ${used.id})`,
      )
      .onConflictDoNothing(),
  );

// 一番新しい返事（status='ok' の最新 generation）で使った記憶 id 一式。無ければ空集合。
export const loadLastTurnUsedMemoryIds = async (
  db: V2Db,
  conversationId: string,
): Promise<Set<string>> => {
  const [latest] = await db
    .select({ id: v2GenerationTable.id })
    .from(v2GenerationTable)
    .where(
      and(eq(v2GenerationTable.conversationId, conversationId), eq(v2GenerationTable.status, "ok")),
    )
    // 同じミリ秒に 2 本の生成が入る並び替えでも新しい方を取る（rowid は D1 の挿入順）。
    .orderBy(desc(v2GenerationTable.createdAt), sql`rowid desc`)
    .limit(1);
  if (!latest) return new Set();
  const rows = await db
    .select({ memoryId: v2GenerationMemoryTable.memoryId })
    .from(v2GenerationMemoryTable)
    .where(eq(v2GenerationMemoryTable.generationId, latest.id));
  if (rows.length > 0) return new Set(rows.map((row) => row.memoryId));
  // 移行前の返事には行が無い。会話に新表の記録が1件も無い時だけ旧表を読む。
  // 新表が動き出した後は「使わなかった」が正しい答えなので空集合のまま返す。
  const [anyRow] = await db
    .select({ generationId: v2GenerationMemoryTable.generationId })
    .from(v2GenerationMemoryTable)
    .innerJoin(v2GenerationTable, eq(v2GenerationTable.id, v2GenerationMemoryTable.generationId))
    .where(eq(v2GenerationTable.conversationId, conversationId))
    .limit(1);
  if (anyRow) return new Set();
  const [latestTurn] = await db
    .select({ turn: v2MemoryUseTable.turn })
    .from(v2MemoryUseTable)
    .where(eq(v2MemoryUseTable.conversationId, conversationId))
    .orderBy(desc(v2MemoryUseTable.turn))
    .limit(1);
  if (!latestTurn) return new Set();
  const legacy = await db
    .select({ memoryId: v2MemoryUseTable.memoryId })
    .from(v2MemoryUseTable)
    .where(
      and(
        eq(v2MemoryUseTable.conversationId, conversationId),
        eq(v2MemoryUseTable.turn, latestTurn.turn),
      ),
    );
  return new Set(legacy.map((row) => row.memoryId));
};
