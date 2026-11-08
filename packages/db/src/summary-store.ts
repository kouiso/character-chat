// 巻き取り要約（RIT-72）の読み書き。engine は TurnStore とは別に summaryStore として受け取る。
// 未注入の store では要約も注入も走らん（opt-in）。
import { asc, eq } from "drizzle-orm";

import { v2SummaryTable } from "./v2-schema";

import type { V2Db } from "./client";

export type StoredSummary = {
  level: number;
  // 履歴の先頭から何件（user/assistant メッセージ数）を吸収したか。
  coveredTo: number;
  text: string;
};

export type SummaryStore = {
  list: (conversationId: string) => Promise<StoredSummary[]>;
  save: (input: {
    conversationId: string;
    level: number;
    coveredTo: number;
    text: string;
  }) => Promise<void>;
};

export const createD1SummaryStore = (db: V2Db): SummaryStore => ({
  list: async (conversationId) => {
    const rows = await db
      .select({
        level: v2SummaryTable.level,
        coveredTo: v2SummaryTable.coveredTo,
        text: v2SummaryTable.text,
      })
      .from(v2SummaryTable)
      .where(eq(v2SummaryTable.conversationId, conversationId))
      .orderBy(asc(v2SummaryTable.coveredTo), asc(v2SummaryTable.level));
    return rows;
  },
  save: async (input) => {
    await db.insert(v2SummaryTable).values({
      id: crypto.randomUUID(),
      conversationId: input.conversationId,
      level: input.level,
      coveredTo: input.coveredTo,
      text: input.text,
      createdAt: Date.now(),
    });
  },
});

export type MemorySummaryStore = SummaryStore & { rows: Map<string, StoredSummary[]> };

// テスト用のインメモリ実装（永続化なし）。
export const createMemorySummaryStore = (): MemorySummaryStore => {
  const rows = new Map<string, StoredSummary[]>();
  return {
    rows,
    list: async (conversationId) => [...(rows.get(conversationId) ?? [])],
    save: async (input) => {
      const list = rows.get(input.conversationId) ?? [];
      list.push({ level: input.level, coveredTo: input.coveredTo, text: input.text });
      rows.set(input.conversationId, list);
    },
  };
};
