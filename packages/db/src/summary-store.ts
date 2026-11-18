// 巻き取り要約（RIT-72）の読み書き。engine の compose は summaryStore.listActive で
// 有効な行だけを読み、要約の係（summary-runner）が範囲の読込・保存・無効化を担う。
// 有効な要約 = invalidated_at が空 かつ to_turn が入っている行。to_turn null の旧行は
// 読まんが消さん（データ節「旧会話は次の alarm でターン番号つきの要約を作り直す」）。
// RIT-94: 記憶の削除・書き換えで触れた文があらすじに残っとる可能性があるので、
// redact_pending = 1 の間は指示文から外し、伏せ直しジョブが書き直してから戻す。
import { and, asc, desc, eq, gte, isNotNull, isNull, lte, sql } from "drizzle-orm";

import { v2MemoryTombstoneTable, v2MessageTable, v2SummaryTable } from "./v2-schema";

import type { V2Db } from "./client";
import type { BatchItem } from "drizzle-orm/batch";

// turn-store.ts の userFirst と同じ並び。要約の係・hash・compose が同じ順で読まんと
// source_hash が合わんので、循環を避けてここに置く（2 箇所で同じ式を持つ）。
const userFirst = sql`case ${v2MessageTable.role} when 'user' then 0 else 1 end`;

export type StoredSummary = {
  id: string;
  level: number;
  // 要約が覆うターン番号の範囲（両端を含む）。covered_to は新しいコードでは読まん。
  fromTurn: number;
  toTurn: number;
  // from_turn〜to_turn の有効メッセージ（ターン番号・役割・本文の並び）の SHA-256。
  sourceHash: string | null;
  text: string;
  // 伏せ直し待ち。1 の間は指示文に入らん（visibleSummaries が除く）。
  redactPending: boolean;
};

// 伏せ直しへ渡す墓標の本文の上限。指示文へそのまま乗るので長さを抑える。
export const FORGOTTEN_MAX_ITEMS = 50;
export const FORGOTTEN_MAX_CHARS = 2000;

export type SummaryStore = {
  // invalidated_at is null かつ to_turn is not null の行だけ（FR-8: compose は hash を見ん）。
  listActive: (conversationId: string) => Promise<StoredSummary[]>;
  // その会話で消された記憶の本文（墓標）。新しい要約の「書かない事柄」に使う。
  listForgotten: (conversationId: string) => Promise<string[]>;
};

// 要約の元・境目の計算に使う会話の 1 行。turn つきで、ターン番号・役割・本文だけ持つ。
export type SummarySourceRow = {
  turn: number;
  role: "user" | "assistant";
  content: string;
};

// 指定ターン範囲（両端を含む）の表示中メッセージをターン順で読む。
// 眠った枝（active=0）は読まん（UR-5: 枝替わりした出来事を要約へ入れんため）。
// 会話の全履歴は読まん（要約の係が読むのは未要約の範囲と hash を確かめる範囲だけ）。
export const loadTurnRange = async (
  db: V2Db,
  input: { conversationId: string; fromTurn: number; toTurn: number },
): Promise<SummarySourceRow[]> =>
  db
    .select({
      turn: v2MessageTable.turn,
      role: v2MessageTable.role,
      content: v2MessageTable.content,
    })
    .from(v2MessageTable)
    .where(
      and(
        eq(v2MessageTable.conversationId, input.conversationId),
        eq(v2MessageTable.active, 1),
        gte(v2MessageTable.turn, input.fromTurn),
        lte(v2MessageTable.turn, input.toTurn),
      ),
    )
    .orderBy(asc(v2MessageTable.turn), userFirst);

// 窓の境目（oldestIncludedTurn）を求めるために直近 limit 件の表示中メッセージを読む。
// 履歴全体は読まん（#181・#144 と同じ方向）。
export const loadRecentActiveMessages = async (
  db: V2Db,
  conversationId: string,
  limit: number,
): Promise<SummarySourceRow[]> => {
  const rows = await db
    .select({
      turn: v2MessageTable.turn,
      role: v2MessageTable.role,
      content: v2MessageTable.content,
    })
    .from(v2MessageTable)
    .where(and(eq(v2MessageTable.conversationId, conversationId), eq(v2MessageTable.active, 1)))
    .orderBy(desc(v2MessageTable.turn), desc(userFirst))
    .limit(limit);
  return rows.reverse();
};

// FR-8: ターン番号・役割・本文の並びの SHA-256（16 進）。確かめる側と作る側で
// 同じ並び・同じ形にせんと合わんので、直列化はここ 1 箇所に閉じる。
export const summarySourceHash = async (rows: readonly SummarySourceRow[]): Promise<string> => {
  const payload = rows.map((row) => [row.turn, row.role, row.content]);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

// compose・hash 確認のどちらもこの選び方を通す（有効な行だけ・from_turn 順）。
export const listActiveSummaries = async (
  db: V2Db,
  conversationId: string,
): Promise<StoredSummary[]> => {
  const rows = await db
    .select({
      id: v2SummaryTable.id,
      level: v2SummaryTable.level,
      fromTurn: v2SummaryTable.fromTurn,
      toTurn: v2SummaryTable.toTurn,
      sourceHash: v2SummaryTable.sourceHash,
      text: v2SummaryTable.text,
      redactPending: v2SummaryTable.redactPending,
    })
    .from(v2SummaryTable)
    .where(
      and(
        eq(v2SummaryTable.conversationId, conversationId),
        isNull(v2SummaryTable.invalidatedAt),
        isNotNull(v2SummaryTable.fromTurn),
        isNotNull(v2SummaryTable.toTurn),
      ),
    )
    .orderBy(asc(v2SummaryTable.fromTurn), asc(v2SummaryTable.level));
  return rows.map((row) => ({
    id: row.id,
    level: row.level,
    // WHERE が null を除くのでここは絶対入る。型の上だけの絞り込み。
    fromTurn: row.fromTurn ?? 0,
    toTurn: row.toTurn ?? 0,
    sourceHash: row.sourceHash,
    text: row.text,
    redactPending: row.redactPending === 1,
  }));
};

// FR-6: (conversation_id, level, from_turn, to_turn, source_hash) の冪等キーで保存する。
// 置き換えで無効化された後に同じ元・同じ範囲の要約が出来た時（同じ文を選び直した枝等）は、
// 無効のまま残すと覆いが永久に欠けるので、同じキーの古い行を有効へ戻す（行は消さん）。
export const saveSummaryRange = async (
  db: V2Db,
  input: {
    conversationId: string;
    level: number;
    fromTurn: number;
    toTurn: number;
    sourceHash: string;
    text: string;
  },
): Promise<void> => {
  const now = Date.now();
  await db
    .insert(v2SummaryTable)
    .values({
      id: crypto.randomUUID(),
      conversationId: input.conversationId,
      level: input.level,
      // covered_to は not null の旧列。新しいコードは読まんが、互換のため to_turn を入れる。
      coveredTo: input.toTurn,
      fromTurn: input.fromTurn,
      toTurn: input.toTurn,
      sourceHash: input.sourceHash,
      text: input.text,
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: [
        v2SummaryTable.conversationId,
        v2SummaryTable.level,
        v2SummaryTable.fromTurn,
        v2SummaryTable.toTurn,
        v2SummaryTable.sourceHash,
      ],
      set: { text: input.text, invalidatedAt: null },
    });
};

// FR-7: ターン N 以降が置き換わった時、to_turn >= N の要約を全部無効にする文。
// 行は消さず invalidated_at に時刻を入れるだけ。covered_to を使った消し方は使わん。
export const invalidateSummariesFromStatement = (
  db: V2Db,
  conversationId: string,
  fromTurn: number,
): BatchItem<"sqlite"> =>
  db
    .update(v2SummaryTable)
    .set({ invalidatedAt: Date.now() })
    .where(
      and(
        eq(v2SummaryTable.conversationId, conversationId),
        isNull(v2SummaryTable.invalidatedAt),
        gte(v2SummaryTable.toTurn, fromTurn),
      ),
    );

export const invalidateSummariesFrom = async (
  db: V2Db,
  conversationId: string,
  fromTurn: number,
): Promise<void> => {
  await invalidateSummariesFromStatement(db, conversationId, fromTurn);
};

// FR-8: hash が合わなかった 1 行だけを無効にする（範囲ではなく行指定）。
export const invalidateSummaryById = async (db: V2Db, summaryId: string): Promise<void> => {
  await db
    .update(v2SummaryTable)
    .set({ invalidatedAt: Date.now() })
    .where(and(eq(v2SummaryTable.id, summaryId), isNull(v2SummaryTable.invalidatedAt)));
};

// 墓標の本文を新しい順に読む。件数・合計字数の両方に上限（FORGOTTEN_*）。
// 伏せ直しジョブと要約の係の両方が使う。
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

// 伏せ直しが限度まで失敗した要約は行ごと消す（あらすじは次の要約で作り直される）。
export const dropSummary = async (db: V2Db, summaryId: string): Promise<void> => {
  await db.delete(v2SummaryTable).where(eq(v2SummaryTable.id, summaryId));
};

export const createD1SummaryStore = (db: V2Db): SummaryStore => ({
  listActive: async (conversationId) => listActiveSummaries(db, conversationId),
  listForgotten: async (conversationId) => listForgottenContents(db, conversationId),
});

export type MemorySummaryStore = SummaryStore & {
  rows: Map<string, StoredSummary[]>;
  forgotten: Map<string, string[]>;
  // 試験の植え付け用。D1 実装と同じく、無効化された行は listActive へ出さん。
  save: (input: {
    conversationId: string;
    level: number;
    fromTurn: number;
    toTurn: number;
    sourceHash?: string | null;
    text: string;
    redactPending?: boolean;
    invalidated?: boolean;
  }) => Promise<void>;
};

// テスト用のインメモリ実装（永続化なし）。
export const createMemorySummaryStore = (): MemorySummaryStore => {
  const rows = new Map<string, StoredSummary[]>();
  const hidden = new Map<string, StoredSummary[]>();
  const forgotten = new Map<string, string[]>();
  return {
    rows,
    forgotten,
    listActive: async (conversationId) => [...(rows.get(conversationId) ?? [])],
    save: async (input) => {
      const entry: StoredSummary = {
        id: `mem-${rows.size}-${input.level}-${input.fromTurn}-${input.toTurn}`,
        level: input.level,
        fromTurn: input.fromTurn,
        toTurn: input.toTurn,
        sourceHash: input.sourceHash ?? null,
        text: input.text,
        redactPending: input.redactPending ?? false,
      };
      const target = input.invalidated ? hidden : rows;
      target.set(input.conversationId, [...(target.get(input.conversationId) ?? []), entry]);
    },
    listForgotten: async (conversationId) => [...(forgotten.get(conversationId) ?? [])],
  };
};
