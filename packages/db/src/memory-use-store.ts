// 記憶の使用記録（RIT-84 の v2_generation_memory が正本）。
// 「さっきの返事で使った」バッジは、一番新しい v2_generation（status='ok'）に
// 紐付く行を読んで出す（RIT-92 の v2_memory_use から一本化した）。
import { and, desc, eq, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

import { v2GenerationMemoryTable, v2GenerationTable } from "./v2-schema";

import type { V2Db } from "./client";

// saveTurn のバッチへ差し込む文。指示文へ入った順（rank）と経由（via）を残す。
// 同じ generation で保存し直す時に備えて onConflictDoNothing（再生成は別 id になる）。
export const generationMemoryStatements = (
  db: V2Db,
  generationId: string,
  usedMemories: { id: string; via: "pinned" | "search" }[],
): BatchItem<"sqlite">[] =>
  usedMemories.map((used, rank) =>
    db
      .insert(v2GenerationMemoryTable)
      .values({ generationId, memoryId: used.id, rank, via: used.via })
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
  return new Set(rows.map((row) => row.memoryId));
};
