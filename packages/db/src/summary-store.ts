// 巻き取り要約（RIT-72）の読み書き。engine は TurnStore とは別に summaryStore として受け取る。
// 未注入の store では要約も注入も走らん（opt-in）。
// RIT-94: 記憶の削除・書き換えで触れた文があらすじに残っとる可能性があるので、
// redact_pending = 1 の間は指示文から外し、伏せ直しジョブが書き直してから戻す。
import { and, asc, desc, eq, isNotNull } from "drizzle-orm";

import { v2MemoryTombstoneTable, v2SummaryTable } from "./v2-schema";

import type { V2Db } from "./client";

export type StoredSummary = {
  level: number;
  // 履歴の先頭から何件（user/assistant メッセージ数）を吸収したか。
  coveredTo: number;
  text: string;
  // 伏せ直し待ち。1 の間は指示文に入らん（visibleSummaries が除く）。
  redactPending: boolean;
};

// 伏せ直しへ渡す墓標の本文の上限。指示文へそのまま乗るので長さを抑える。
export const FORGOTTEN_MAX_ITEMS = 50;
export const FORGOTTEN_MAX_CHARS = 2000;

export type SummaryStore = {
  list: (conversationId: string) => Promise<StoredSummary[]>;
  save: (input: {
    conversationId: string;
    level: number;
    coveredTo: number;
    text: string;
  }) => Promise<void>;
  // その会話で消された記憶の本文（墓標）。新しい要約の「書かない事柄」に使う。
  listForgotten: (conversationId: string) => Promise<string[]>;
};

// 墓標の本文を新しい順に読む。件数・合計字数の両方に上限（FORGOTTEN_*）。
// 伏せ直しジョブと summarize ノードの両方が使う。
export const listForgottenContents = async (
  db: V2Db,
  conversationId: string,
): Promise<string[]> => {
  const rows = await db
    .select({ content: v2MemoryTombstoneTable.content })
    .from(v2MemoryTombstoneTable)
    .where(
      and(
        eq(v2MemoryTombstoneTable.conversationId, conversationId),
        isNotNull(v2MemoryTombstoneTable.content),
      ),
    )
    .orderBy(desc(v2MemoryTombstoneTable.createdAt))
    .limit(FORGOTTEN_MAX_ITEMS);
  const contents: string[] = [];
  let total = 0;
  for (const row of rows) {
    if (row.content === null) continue;
    if (total + row.content.length > FORGOTTEN_MAX_CHARS) break;
    contents.push(row.content);
    total += row.content.length;
  }
  return contents;
};

// 伏せ直しジョブ用: 待ちの要約を 1 行ずつ取り出す。
export const listRedactPendingSummaries = async (
  db: V2Db,
  conversationId: string,
): Promise<{ id: string; text: string }[]> =>
  db
    .select({ id: v2SummaryTable.id, text: v2SummaryTable.text })
    .from(v2SummaryTable)
    .where(
      and(eq(v2SummaryTable.conversationId, conversationId), eq(v2SummaryTable.redactPending, 1)),
    )
    .orderBy(asc(v2SummaryTable.coveredTo), asc(v2SummaryTable.level));

export const applySummaryRedaction = async (
  db: V2Db,
  summaryId: string,
  text: string,
): Promise<void> => {
  await db
    .update(v2SummaryTable)
    .set({ text, redactPending: 0 })
    .where(eq(v2SummaryTable.id, summaryId));
};

// 伏せ直しが限度まで失敗した要約は行ごと消す（あらすじは次の summarize で作り直される）。
export const dropSummary = async (db: V2Db, summaryId: string): Promise<void> => {
  await db.delete(v2SummaryTable).where(eq(v2SummaryTable.id, summaryId));
};

export const createD1SummaryStore = (db: V2Db): SummaryStore => ({
  list: async (conversationId) => {
    const rows = await db
      .select({
        level: v2SummaryTable.level,
        coveredTo: v2SummaryTable.coveredTo,
        text: v2SummaryTable.text,
        redactPending: v2SummaryTable.redactPending,
      })
      .from(v2SummaryTable)
      .where(eq(v2SummaryTable.conversationId, conversationId))
      .orderBy(asc(v2SummaryTable.coveredTo), asc(v2SummaryTable.level));
    return rows.map((row) => ({ ...row, redactPending: row.redactPending === 1 }));
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
  listForgotten: async (conversationId) => listForgottenContents(db, conversationId),
});

export type MemorySummaryStore = SummaryStore & {
  rows: Map<string, StoredSummary[]>;
  forgotten: Map<string, string[]>;
};

// テスト用のインメモリ実装（永続化なし）。
export const createMemorySummaryStore = (): MemorySummaryStore => {
  const rows = new Map<string, StoredSummary[]>();
  const forgotten = new Map<string, string[]>();
  return {
    rows,
    forgotten,
    list: async (conversationId) => [...(rows.get(conversationId) ?? [])],
    save: async (input) => {
      const list = rows.get(input.conversationId) ?? [];
      list.push({
        level: input.level,
        coveredTo: input.coveredTo,
        text: input.text,
        redactPending: false,
      });
      rows.set(input.conversationId, list);
    },
    listForgotten: async (conversationId) => [...(forgotten.get(conversationId) ?? [])],
  };
};
