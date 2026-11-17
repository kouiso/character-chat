// RIT-78 旧記憶メモ（memory_note、利用者+キャラの組に付く）を v2_memory（会話 1 つに付く）へ移す。
// 会話の検索は v2_memory_source と出どころの発言を内部結合して読むので、
// 記憶・出どころ・台帳の 3 行を 1 件ごとの D1 batch で確定する。
// 台帳（v2_legacy_import, legacy_table='memory_note'）が「移した・v2 で消した・まだ移していない」の
// 見分けの正本。v2 で消した・書き換えた記憶は取り込み直しで元に戻さない（UR-6）。
// 旧表は 1 行も変えない（NFR-4）。
import { and, asc, desc, eq, gt, inArray, lte, sql } from "drizzle-orm";

import { memoryNoteTable } from "../../../src/schema/memory-note";
import { ragChunkTable } from "../../../src/schema/rag-chunk";

import {
  legacyOwnerLabel,
  type LegacyImportInsert,
  type LegacyImportRow,
} from "./legacy-import-store";
import { hashMemorySource } from "./memory-extraction-store";
import {
  v2ConversationTable,
  v2LegacyImportTable,
  v2MemorySourceTable,
  v2MemoryTable,
  v2MemoryTombstoneTable,
  v2MessageTable,
} from "./v2-schema";

import type { V2Db } from "./client";

type SourceNote = typeof memoryNoteTable.$inferSelect;
type StoredMemory = typeof v2MemoryTable.$inferSelect;
type StoredConversation = typeof v2ConversationTable.$inferSelect;
type SourceMessage = Pick<
  typeof v2MessageTable.$inferSelect,
  "id" | "conversationId" | "turn" | "role" | "content" | "active"
>;

// 旧アプリが自動抽出の記憶の頭に付けた印（functions/api/lib/route-context.ts の AUTO_MEMORY_PREFIX）。
// 記憶画面にそのまま出るので写す時に剥がす。
export const LEGACY_MEMORY_AUTO_PREFIX = "[auto] ";
export const stripLegacyAutoPrefix = (content: string): string =>
  content.startsWith(LEGACY_MEMORY_AUTO_PREFIX)
    ? content.slice(LEGACY_MEMORY_AUTO_PREFIX.length)
    : content;

export const legacyMemoryId = (noteId: string): string => `legacy-mn-${noteId}`;
export const legacyRagVectorId = (chunkId: string): string => `legacy-rag-${chunkId}`;

// 出どころの重要度は 1〜5 の真ん中（未決 4 の既定案）。
const MIGRATED_MEMORY_IMPORTANCE = 3;

export type LegacyMemoryMigrationOptions = {
  sourceUserId: string;
  targetUserId: string;
  // 省略は「確認だけ」（何も書かずに計画の件数を返す）。true で書く。
  apply?: boolean;
  // ページの並びは旧 memory_note.id の昇順。cursor は前のページの最後の id。
  cursor?: string;
  limit?: number;
  // apply の時は確認だけで見た件数と照合し、違えば何も書かずに LegacyMemoryPlanChangedError。
  expected?: { insertedMemories: number };
};

export class LegacyMemoryPlanChangedError extends Error {
  readonly planned: { insertedMemories: number };
  constructor(planned: { insertedMemories: number }) {
    super("確認だけで見た件数と計画が変わっている");
    this.name = "LegacyMemoryPlanChangedError";
    this.planned = planned;
  }
}

export class LegacyCorpusPlanChangedError extends Error {
  readonly planned: { chunks: number };
  constructor(planned: { chunks: number }) {
    super("確認だけで見た件数と計画が変わっている");
    this.name = "LegacyCorpusPlanChangedError";
    this.planned = planned;
  }
}

export const LEGACY_MEMORY_FAILURE_CODES = [
  "source_changed",
  "write_failed",
  "index_failed",
] as const;
export type LegacyMemoryFailureCode = (typeof LEGACY_MEMORY_FAILURE_CODES)[number];
export type LegacyMemoryFailure = { noteId: string; code: LegacyMemoryFailureCode };

// 埋める対象（新しく入れた物・前の実行で埋められなかった物）。worker 側が 1 件ずつ
// 埋める → 検索箱に入れる → embedding を書き戻す。
export type MemoryIndexTarget = {
  noteId: string;
  memoryId: string;
  conversationId: string;
  characterId: string;
  kind: StoredMemory["kind"];
  content: string;
};

export type LegacyMemoryMigrationResult = {
  notes: number;
  insertedMemories: number;
  alreadyImported: number;
  skippedNoConversation: number;
  skippedNoUserMessage: number;
  skippedTombstoned: number;
  skippedDeletedInV2: number;
  failures: LegacyMemoryFailure[];
  // apply で書き込みが確定し、まだ埋めていない記憶。確認だけでは常に空。
  indexTargets: MemoryIndexTarget[];
  nextCursor: string | null;
};

type SkipCounter =
  | "skippedNoConversation"
  | "skippedNoUserMessage"
  | "skippedTombstoned"
  | "skippedDeletedInV2";

// メモ 1 件ぶんの計画。書く物は insert/update する行と index 対象の印だけ持ち、
// 実際の書き込みは apply の時に writeNotePlan が 1 batch で行う。
type NotePlan = {
  note: SourceNote;
  memoryId: string;
  // stripped は台帳の content_hash と検査の基準になる本文（[auto] 除去済み）。
  stripped: string;
  contentHash: string;
  action:
    | { type: "insert"; conversationId: string; characterId: string; source: SourceMessage }
    | {
        type: "backfill";
        stored: StoredMemory;
        conversationId: string;
        characterId: string;
        source: SourceMessage | null;
        needsSourceRow: boolean;
        needsSourceTurn: boolean;
        needsStrip: boolean;
      }
    | { type: "already"; stored: StoredMemory; indexTarget: MemoryIndexTarget | null }
    | { type: "skip"; counter: SkipCounter }
    | { type: "failure"; code: "source_changed" };
};

type ConversationPick = Pick<StoredConversation, "id" | "userId" | "characterId">;

const readNotePage = async (
  db: V2Db,
  sourceUserId: string,
  cursor: string | undefined,
  limit: number | undefined,
): Promise<SourceNote[]> => {
  const where = cursor
    ? and(eq(memoryNoteTable.userId, sourceUserId), gt(memoryNoteTable.id, cursor))
    : eq(memoryNoteTable.userId, sourceUserId);
  const query = db.select().from(memoryNoteTable).where(where).orderBy(asc(memoryNoteTable.id));
  return limit === undefined ? query : query.limit(limit + 1);
};

// 会話の中で最新の自分の発言（人が記憶を足す時と同じ決め方。memory-crud-store.insertManualMemory）。
const latestUserMessage = async (
  db: V2Db,
  conversationId: string,
): Promise<SourceMessage | undefined> => {
  const [row] = await db
    .select({
      id: v2MessageTable.id,
      conversationId: v2MessageTable.conversationId,
      turn: v2MessageTable.turn,
      role: v2MessageTable.role,
      content: v2MessageTable.content,
      active: v2MessageTable.active,
    })
    .from(v2MessageTable)
    .where(and(eq(v2MessageTable.conversationId, conversationId), eq(v2MessageTable.role, "user")))
    .orderBy(desc(v2MessageTable.turn), desc(v2MessageTable.createdAt))
    .limit(1);
  return row;
};

// 写す先が決まった時の出どころ: 発言が assistant なら番号がそれ以下の起きている自分の発言の
// うち番号が最大の物、user ならその発言。無ければ undefined。
const sourceForMessage = async (
  db: V2Db,
  message: SourceMessage,
): Promise<SourceMessage | undefined> => {
  if (message.role === "user") return message;
  const [row] = await db
    .select({
      id: v2MessageTable.id,
      conversationId: v2MessageTable.conversationId,
      turn: v2MessageTable.turn,
      role: v2MessageTable.role,
      content: v2MessageTable.content,
      active: v2MessageTable.active,
    })
    .from(v2MessageTable)
    .where(
      and(
        eq(v2MessageTable.conversationId, message.conversationId),
        eq(v2MessageTable.role, "user"),
        eq(v2MessageTable.active, 1),
        lte(v2MessageTable.turn, message.turn),
      ),
    )
    .orderBy(desc(v2MessageTable.turn))
    .limit(1);
  return row;
};

// 会話の候補に出どころを付ける。自分の発言が 1 つも無ければ null。
const withSource = async (
  db: V2Db,
  conversation: ConversationPick,
): Promise<{ conversation: ConversationPick; source: SourceMessage } | null> => {
  const source = await latestUserMessage(db, conversation.id);
  return source ? { conversation, source } : null;
};

// 写す先の決め方（How「写す先の決め方」の順）。利用者が targetUserId・キャラがメモと同じ物に限る。
const resolveTarget = async (
  db: V2Db,
  note: SourceNote,
  opts: Pick<LegacyMemoryMigrationOptions, "sourceUserId" | "targetUserId">,
): Promise<{ conversation: ConversationPick; source: SourceMessage | null } | null> => {
  // 1. source_message_id が v2_message に在り、その会話が条件を満たす → その会話。
  if (note.sourceMessageId) {
    const [message] = await db
      .select({
        id: v2MessageTable.id,
        conversationId: v2MessageTable.conversationId,
        turn: v2MessageTable.turn,
        role: v2MessageTable.role,
        content: v2MessageTable.content,
        active: v2MessageTable.active,
      })
      .from(v2MessageTable)
      .where(eq(v2MessageTable.id, note.sourceMessageId))
      .limit(1);
    if (message) {
      const [conversation] = await db
        .select({
          id: v2ConversationTable.id,
          userId: v2ConversationTable.userId,
          characterId: v2ConversationTable.characterId,
        })
        .from(v2ConversationTable)
        .where(
          and(
            eq(v2ConversationTable.id, message.conversationId),
            eq(v2ConversationTable.userId, opts.targetUserId),
            eq(v2ConversationTable.characterId, note.characterId),
          ),
        )
        .limit(1);
      if (conversation) {
        return { conversation, source: (await sourceForMessage(db, message)) ?? null };
      }
    }
  }
  // 2. 移行元の利用者と同じ legacy_source_user_id の会話のうち updated_at が最大の物。
  // 3. それも無ければ同じキャラの会話のうち最大の物。出どころは最新の自分の発言。
  const latest = async (extra: Parameters<typeof and>[0] | undefined) => {
    const [conversation] = await db
      .select({
        id: v2ConversationTable.id,
        userId: v2ConversationTable.userId,
        characterId: v2ConversationTable.characterId,
      })
      .from(v2ConversationTable)
      .where(
        and(
          eq(v2ConversationTable.userId, opts.targetUserId),
          eq(v2ConversationTable.characterId, note.characterId),
          extra,
        ),
      )
      .orderBy(desc(v2ConversationTable.updatedAt))
      .limit(1);
    if (!conversation) return null;
    const picked = await withSource(db, conversation);
    return picked
      ? picked
      : // 会話は決まったが自分の発言が無い印。呼び出し側は skippedNoUserMessage に数える。
        { conversation, source: null };
  };
  return (
    (await latest(eq(v2ConversationTable.legacySourceUserId, opts.sourceUserId))) ??
    (await latest(undefined))
  );
};

// 同じ会話で同じ本文を消した印（v2_memory_tombstone）。取り込み直しで蘇らせない。
const isTombstoned = async (
  db: V2Db,
  conversationId: string,
  contentHash: string,
): Promise<boolean> => {
  const [row] = await db
    .select({ conversationId: v2MemoryTombstoneTable.conversationId })
    .from(v2MemoryTombstoneTable)
    .where(
      and(
        eq(v2MemoryTombstoneTable.conversationId, conversationId),
        eq(v2MemoryTombstoneTable.contentHash, contentHash),
      ),
    )
    .limit(1);
  return row !== undefined;
};

const memoryIndexTarget = async (
  db: V2Db,
  noteId: string,
  memoryId: string,
  conversationId: string,
): Promise<MemoryIndexTarget | null> => {
  const [row] = await db
    .select({
      id: v2MemoryTable.id,
      kind: v2MemoryTable.kind,
      content: v2MemoryTable.content,
      characterId: v2ConversationTable.characterId,
    })
    .from(v2MemoryTable)
    .innerJoin(v2ConversationTable, eq(v2ConversationTable.id, v2MemoryTable.conversationId))
    .where(eq(v2MemoryTable.id, memoryId))
    .limit(1);
  return row
    ? {
        noteId,
        memoryId: row.id,
        conversationId,
        characterId: row.characterId,
        kind: row.kind,
        content: row.content,
      }
    : null;
};

// 台帳に在るメモの計画: v2 で消した → skippedDeletedInV2、旧の本文が変わった → source_changed、
// それ以外は alreadyImported（v2 で書き換えられていても上書きしない）。埋めていなければ埋める対象へ。
const planLedgered = async (
  db: V2Db,
  base: Pick<NotePlan, "note" | "memoryId" | "stripped" | "contentHash">,
  ledger: LegacyImportRow,
  stored: StoredMemory | undefined,
): Promise<NotePlan> => {
  if (stored === undefined) {
    return { ...base, action: { type: "skip", counter: "skippedDeletedInV2" } };
  }
  if (ledger.contentHash !== base.contentHash) {
    return { ...base, action: { type: "failure", code: "source_changed" } };
  }
  // 論理削除済みの記憶は埋め直さない（消した物を検索箱へ戻さない。削除は復元窓つきの
  // deleted_at で先に効く。memory-crud-store.deleteMemory）。
  const indexTarget =
    stored.embedding === null && stored.deletedAt === null
      ? await memoryIndexTarget(db, base.note.id, base.memoryId, stored.conversationId)
      : null;
  return { ...base, action: { type: "already", stored, indexTarget } };
};

// 台帳の無い頃に写したメモの計画: 台帳の行と、無ければ出どころの行を足す。
// source_turn が空なら埋め、[auto] が残っていれば除く。
const planBackfill = async (
  db: V2Db,
  base: Pick<NotePlan, "note" | "memoryId" | "stripped" | "contentHash">,
  stored: StoredMemory,
): Promise<NotePlan> => {
  const [conversation] = await db
    .select({
      id: v2ConversationTable.id,
      userId: v2ConversationTable.userId,
      characterId: v2ConversationTable.characterId,
    })
    .from(v2ConversationTable)
    .where(eq(v2ConversationTable.id, stored.conversationId))
    .limit(1);
  if (!conversation) {
    return { ...base, action: { type: "skip", counter: "skippedNoConversation" } };
  }
  const [sourceRow] = await db
    .select({ sourceMessageId: v2MemorySourceTable.sourceMessageId })
    .from(v2MemorySourceTable)
    .where(eq(v2MemorySourceTable.memoryId, base.memoryId))
    .limit(1);
  const needsSourceRow = sourceRow === undefined;
  // 出どころの行が無ければその会話の最新の自分の発言を出どころにする。行が在って
  // source_turn が空なら、その発言の番号で埋める（取り込みの番号と食い違わせない）。
  let source: SourceMessage | null = null;
  if (needsSourceRow) {
    source = (await latestUserMessage(db, conversation.id)) ?? null;
    if (!source) {
      return { ...base, action: { type: "skip", counter: "skippedNoUserMessage" } };
    }
  } else if (stored.sourceTurn === null) {
    const [message] = await db
      .select({
        id: v2MessageTable.id,
        conversationId: v2MessageTable.conversationId,
        turn: v2MessageTable.turn,
        role: v2MessageTable.role,
        content: v2MessageTable.content,
        active: v2MessageTable.active,
      })
      .from(v2MessageTable)
      .where(eq(v2MessageTable.id, sourceRow.sourceMessageId))
      .limit(1);
    source = message ?? null;
  }
  return {
    ...base,
    action: {
      type: "backfill",
      stored,
      conversationId: conversation.id,
      characterId: conversation.characterId,
      source,
      needsSourceRow,
      needsSourceTurn: stored.sourceTurn === null && source !== null,
      needsStrip: stored.content.startsWith(LEGACY_MEMORY_AUTO_PREFIX),
    },
  };
};

// どちらにも無いメモの計画: 写す先を決め、消した印が無ければ 3 行を入れる。
const planInsert = async (
  db: V2Db,
  base: Pick<NotePlan, "note" | "memoryId" | "stripped" | "contentHash">,
  opts: Pick<LegacyMemoryMigrationOptions, "sourceUserId" | "targetUserId">,
): Promise<NotePlan> => {
  const target = await resolveTarget(db, base.note, opts);
  if (!target) return { ...base, action: { type: "skip", counter: "skippedNoConversation" } };
  if (!target.source) {
    return { ...base, action: { type: "skip", counter: "skippedNoUserMessage" } };
  }
  if (await isTombstoned(db, target.conversation.id, base.contentHash)) {
    return { ...base, action: { type: "skip", counter: "skippedTombstoned" } };
  }
  return {
    ...base,
    action: {
      type: "insert",
      conversationId: target.conversation.id,
      characterId: target.conversation.characterId,
      source: target.source,
    },
  };
};

// メモ 1 件の計画（How「旧記憶メモ 1 件の計画」）。
const planNote = async (
  db: V2Db,
  note: SourceNote,
  opts: Pick<LegacyMemoryMigrationOptions, "sourceUserId" | "targetUserId">,
): Promise<NotePlan> => {
  const stripped = stripLegacyAutoPrefix(note.content);
  const base = {
    note,
    memoryId: legacyMemoryId(note.id),
    stripped,
    contentHash: await hashMemorySource(stripped),
  };
  const [ledger] = await db
    .select()
    .from(v2LegacyImportTable)
    .where(
      and(
        eq(v2LegacyImportTable.legacyTable, "memory_note"),
        eq(v2LegacyImportTable.legacyId, note.id),
      ),
    )
    .limit(1);
  const [stored] = await db
    .select()
    .from(v2MemoryTable)
    .where(eq(v2MemoryTable.id, base.memoryId))
    .limit(1);
  if (ledger) return planLedgered(db, base, ledger, stored);
  if (stored) return planBackfill(db, base, stored);
  return planInsert(db, base, opts);
};

const ledgerRow = (
  plan: NotePlan,
  conversationId: string,
  opts: Pick<LegacyMemoryMigrationOptions, "sourceUserId" | "targetUserId">,
  importedAt: number,
): LegacyImportInsert => ({
  legacyTable: "memory_note",
  legacyId: plan.note.id,
  v2Id: plan.memoryId,
  conversationId,
  sourceUserId: opts.sourceUserId,
  targetUserId: opts.targetUserId,
  contentHash: plan.contentHash,
  importedAt,
});

type BatchStatement = Parameters<V2Db["batch"]>[0] extends readonly (infer U)[] ? U : never;

const insertStatements = async (
  db: V2Db,
  plan: NotePlan,
  action: Extract<NotePlan["action"], { type: "insert" }>,
  opts: Pick<LegacyMemoryMigrationOptions, "sourceUserId" | "targetUserId">,
  importedAt: number,
): Promise<BatchStatement[]> => [
  db
    .insert(v2MemoryTable)
    .values({
      id: plan.memoryId,
      conversationId: action.conversationId,
      kind: "fact",
      content: plan.stripped,
      pinned: 0,
      sourceTurn: action.source.turn,
      createdAt: plan.note.createdAt,
    })
    .onConflictDoNothing(),
  db
    .insert(v2MemorySourceTable)
    .values({
      memoryId: plan.memoryId,
      sourceMessageId: action.source.id,
      sourceContentHash: await hashMemorySource(action.source.content),
      importance: MIGRATED_MEMORY_IMPORTANCE,
    })
    .onConflictDoNothing(),
  db
    .insert(v2LegacyImportTable)
    .values(ledgerRow(plan, action.conversationId, opts, importedAt))
    .onConflictDoNothing(),
];

const backfillStatements = async (
  db: V2Db,
  plan: NotePlan,
  action: Extract<NotePlan["action"], { type: "backfill" }>,
  opts: Pick<LegacyMemoryMigrationOptions, "sourceUserId" | "targetUserId">,
  importedAt: number,
): Promise<BatchStatement[]> => {
  const statements: BatchStatement[] = [];
  if (action.needsStrip || action.needsSourceTurn) {
    statements.push(
      db
        .update(v2MemoryTable)
        .set({
          ...(action.needsStrip ? { content: plan.stripped } : {}),
          ...(action.needsSourceTurn && action.source ? { sourceTurn: action.source.turn } : {}),
        })
        .where(eq(v2MemoryTable.id, plan.memoryId)),
    );
  }
  if (action.needsSourceRow && action.source) {
    statements.push(
      db
        .insert(v2MemorySourceTable)
        .values({
          memoryId: plan.memoryId,
          sourceMessageId: action.source.id,
          sourceContentHash: await hashMemorySource(action.source.content),
          importance: MIGRATED_MEMORY_IMPORTANCE,
        })
        .onConflictDoNothing(),
    );
  }
  statements.push(
    db
      .insert(v2LegacyImportTable)
      .values(ledgerRow(plan, action.conversationId, opts, importedAt))
      .onConflictDoNothing(),
  );
  return statements;
};

// 書き込み確定後の埋める対象。埋め済みの物を埋め直すと検索箱の新旧ベクトルが両方残るので、
// embedding 済み・消された記憶は返さない（埋める対象は「まだ埋めていない・消されていない」物だけ）。
const indexTargetAfterWrite = (plan: NotePlan): MemoryIndexTarget | null => {
  if (plan.action.type !== "insert" && plan.action.type !== "backfill") return null;
  if (plan.action.type === "backfill") {
    const stored = plan.action.stored;
    if (stored.embedding !== null || stored.deletedAt !== null) return null;
  }
  return {
    noteId: plan.note.id,
    memoryId: plan.memoryId,
    conversationId: plan.action.conversationId,
    characterId: plan.action.characterId,
    kind: plan.action.type === "backfill" ? plan.action.stored.kind : "fact",
    content:
      plan.action.type === "backfill" && !plan.action.needsStrip
        ? plan.action.stored.content
        : plan.stripped,
  };
};

// 書く（apply の時だけ）。1 件を 1 つの batch で: 記憶の行（無い時）／出どころの行／台帳の行。
// 全部 onConflictDoNothing で、同じ要求が 2 度来ても行は増えない。
const writeNotePlan = async (
  db: V2Db,
  plan: NotePlan,
  opts: Pick<LegacyMemoryMigrationOptions, "sourceUserId" | "targetUserId">,
  importedAt: number,
): Promise<MemoryIndexTarget | null> => {
  if (plan.action.type === "already") return plan.action.indexTarget;
  if (plan.action.type !== "insert" && plan.action.type !== "backfill") return null;
  const statements =
    plan.action.type === "insert"
      ? await insertStatements(db, plan, plan.action, opts, importedAt)
      : await backfillStatements(db, plan, plan.action, opts, importedAt);
  const [first, ...rest] = statements;
  if (first !== undefined) await db.batch([first, ...rest]);
  return indexTargetAfterWrite(plan);
};

const countPlan = (
  plan: NotePlan,
  counts: Omit<LegacyMemoryMigrationResult, "notes" | "failures" | "indexTargets" | "nextCursor">,
): void => {
  if (plan.action.type === "insert") counts.insertedMemories += 1;
  else if (plan.action.type === "already" || plan.action.type === "backfill")
    counts.alreadyImported += 1;
  else if (plan.action.type === "skip") counts[plan.action.counter] += 1;
};

const emptyCounts = () => ({
  insertedMemories: 0,
  alreadyImported: 0,
  skippedNoConversation: 0,
  skippedNoUserMessage: 0,
  skippedTombstoned: 0,
  skippedDeletedInV2: 0,
});

// 確定した計画を 1 メモ 1 batch で書く。失敗した計画は failures に残して次へ進む。
const applyPlans = async (
  db: V2Db,
  plans: NotePlan[],
  options: LegacyMemoryMigrationOptions,
  importedAt: number,
) => {
  const counts = emptyCounts();
  const failures: LegacyMemoryFailure[] = [];
  const indexTargets: MemoryIndexTarget[] = [];
  for (const plan of plans) {
    if (plan.action.type === "failure") {
      failures.push({ noteId: plan.note.id, code: plan.action.code });
      continue;
    }
    try {
      const target = await writeNotePlan(db, plan, options, importedAt);
      countPlan(plan, counts);
      if (target) indexTargets.push(target);
    } catch {
      failures.push({ noteId: plan.note.id, code: "write_failed" });
    }
  }
  return { ...counts, failures, indexTargets };
};

// 確認だけの集計（何も書かない）。
const countOnly = (plans: NotePlan[]) => {
  const counts = emptyCounts();
  const failures: LegacyMemoryFailure[] = [];
  for (const plan of plans) {
    if (plan.action.type === "failure") {
      failures.push({ noteId: plan.note.id, code: plan.action.code });
    } else {
      countPlan(plan, counts);
    }
  }
  return { ...counts, failures, indexTargets: [] as MemoryIndexTarget[] };
};

// 旧記憶メモを id の昇順に limit 件ずつ計画する。apply が偽なら計画の件数だけを返し、
// 真なら計画が expected と一致する時だけ 1 メモ 1 batch で書く。
export const migrateLegacyMemoryNotes = async (
  db: V2Db,
  options: LegacyMemoryMigrationOptions,
): Promise<LegacyMemoryMigrationResult> => {
  const fetched = await readNotePage(db, options.sourceUserId, options.cursor, options.limit);
  const hasMore = options.limit !== undefined && fetched.length > options.limit;
  const notes = fetched.slice(0, options.limit ?? fetched.length);
  const nextCursor = hasMore ? notes[notes.length - 1].id : null;
  // 計画は 1 件ずつ読む（RIT-77 と同じくページ内は直列。行動の見通しを優先する）。
  const plans: NotePlan[] = [];
  for (const note of notes) plans.push(await planNote(db, note, options));

  const plannedInserts = plans.filter((plan) => plan.action.type === "insert").length;
  if (
    options.apply === true &&
    options.expected !== undefined &&
    plannedInserts !== options.expected.insertedMemories
  ) {
    throw new LegacyMemoryPlanChangedError({ insertedMemories: plannedInserts });
  }

  const applied =
    options.apply === true ? await applyPlans(db, plans, options, Date.now()) : countOnly(plans);
  return { notes: notes.length, ...applied, nextCursor };
};

export const VERIFY_MEMORY_STATUSES = [
  "match",
  "edited_in_v2",
  "deleted_in_v2",
  "not_imported",
  "skipped",
  "source_changed",
  "not_indexed",
] as const;
export type VerifyMemoryStatus = (typeof VERIFY_MEMORY_STATUSES)[number];

export type VerifyMemoryItem = {
  noteId: string;
  status: VerifyMemoryStatus;
  // match の時だけ埋める内部用フィールド（応答には出さない）。
  memoryId?: string;
  conversationId?: string;
  characterId?: string;
  content?: string;
};

export type VerifyMemoryResult = {
  notes: number;
  items: VerifyMemoryItem[];
  nextCursor: string | null;
};

// 本文が一致する記憶の最後の検査: 埋め込みと出どころの行が揃っていれば match、
// 無ければ not_indexed。
const verifyIndexed = async (
  db: V2Db,
  noteId: string,
  memoryId: string,
  stored: StoredMemory,
): Promise<VerifyMemoryItem> => {
  const [sourceRow] = await db
    .select({ memoryId: v2MemorySourceTable.memoryId })
    .from(v2MemorySourceTable)
    .where(eq(v2MemorySourceTable.memoryId, memoryId))
    .limit(1);
  if (stored.embedding === null || !sourceRow) {
    return { noteId, status: "not_indexed" };
  }
  const [conversation] = await db
    .select({ characterId: v2ConversationTable.characterId })
    .from(v2ConversationTable)
    .where(eq(v2ConversationTable.id, stored.conversationId))
    .limit(1);
  return {
    noteId,
    status: "match",
    memoryId,
    conversationId: stored.conversationId,
    characterId: conversation?.characterId,
    content: stored.content,
  };
};

// 台帳にも v2_memory にも無いメモ: 写す先が決まるなら not_imported、決まらなければ skipped。
const verifyMissing = async (
  db: V2Db,
  note: SourceNote,
  opts: Pick<LegacyMemoryMigrationOptions, "sourceUserId" | "targetUserId">,
): Promise<VerifyMemoryItem> => {
  const target = await resolveTarget(db, note, opts);
  return { noteId: note.id, status: target?.source ? "not_imported" : "skipped" };
};

// verify-memory の状態の決め方（How「verify-memory の状態の決め方」）。
const verifyOneNote = async (
  db: V2Db,
  note: SourceNote,
  opts: Pick<LegacyMemoryMigrationOptions, "sourceUserId" | "targetUserId">,
): Promise<VerifyMemoryItem> => {
  const memoryId = legacyMemoryId(note.id);
  const stripped = stripLegacyAutoPrefix(note.content);
  const [ledger] = await db
    .select()
    .from(v2LegacyImportTable)
    .where(
      and(
        eq(v2LegacyImportTable.legacyTable, "memory_note"),
        eq(v2LegacyImportTable.legacyId, note.id),
      ),
    )
    .limit(1);
  const [stored] = await db
    .select()
    .from(v2MemoryTable)
    .where(eq(v2MemoryTable.id, memoryId))
    .limit(1);
  if (!ledger && !stored) return verifyMissing(db, note, opts);
  if (!stored) return { noteId: note.id, status: "deleted_in_v2" };
  // 台帳が無い頃に写した物は台帳の替わりに旧の本文を基準にする（次の memory で台帳が埋まる）。
  const sourceHash = await hashMemorySource(stripped);
  if (ledger && ledger.contentHash !== sourceHash) {
    return { noteId: note.id, status: "source_changed" };
  }
  if ((await hashMemorySource(stored.content)) !== (ledger?.contentHash ?? sourceHash)) {
    return { noteId: note.id, status: "edited_in_v2" };
  }
  return verifyIndexed(db, note.id, memoryId, stored);
};

// `verify-memory`: 旧記憶メモ 1 件ずつの状態を返す。何も書かない。
export const verifyLegacyMemoryNotes = async (
  db: V2Db,
  options: Pick<LegacyMemoryMigrationOptions, "sourceUserId" | "targetUserId" | "cursor" | "limit">,
): Promise<VerifyMemoryResult> => {
  const fetched = await readNotePage(db, options.sourceUserId, options.cursor, options.limit);
  const hasMore = options.limit !== undefined && fetched.length > options.limit;
  const notes = fetched.slice(0, options.limit ?? fetched.length);
  const nextCursor = hasMore ? notes[notes.length - 1].id : null;
  const items: VerifyMemoryItem[] = [];
  for (const note of notes) items.push(await verifyOneNote(db, note, options));
  return { notes: notes.length, items, nextCursor };
};

// memory_note に現れる user_id の一覧（sourceOwner の札を利用者 ID へ解く入力）。
export const listLegacyMemoryUserIds = async (db: V2Db): Promise<string[]> => {
  const rows = await db.selectDistinct({ userId: memoryNoteTable.userId }).from(memoryNoteTable);
  return rows.map((row) => row.userId);
};

// 札から移行元の利用者の ID を引く。当たる利用者が無ければ null（受け口は 404 にする）。
export const resolveLegacyMemoryOwner = async (db: V2Db, label: string): Promise<string | null> => {
  for (const userId of await listLegacyMemoryUserIds(db)) {
    if ((await legacyOwnerLabel(userId)) === label) return userId;
  }
  return null;
};

// 移行済みメモが紐づく会話→キャラの逆引き（Vectorize namespace 決定用）。
export const loadConversationCharacterMap = async (
  db: V2Db,
  conversationIds: string[],
): Promise<Map<string, string>> => {
  if (conversationIds.length === 0) return new Map();
  const rows = await db
    .select({ id: v2ConversationTable.id, characterId: v2ConversationTable.characterId })
    .from(v2ConversationTable)
    .where(inArray(v2ConversationTable.id, conversationIds));
  return new Map(rows.map((row) => [row.id, row.characterId]));
};

// 移行したメモに埋め込みを書き戻す（float32 を little-endian の生バイトで）。
export const saveMigratedEmbedding = async (
  db: V2Db,
  memoryId: string,
  values: number[],
): Promise<void> => {
  await db
    .update(v2MemoryTable)
    .set({ embedding: sql<Buffer>`${new Uint8Array(new Float32Array(values).buffer)}` })
    .where(eq(v2MemoryTable.id, memoryId));
};

// 移行対象の rag_chunk（共有コーパス）を id 昇順のページで返す。
export const loadRagChunks = async (db: V2Db, opts: { cursor?: string; limit?: number } = {}) => {
  const where = opts.cursor ? gt(ragChunkTable.id, opts.cursor) : undefined;
  const query = db
    .select({
      id: ragChunkTable.id,
      type: ragChunkTable.type,
      phase: ragChunkTable.phase,
      characterId: ragChunkTable.characterId,
      text: ragChunkTable.text,
    })
    .from(ragChunkTable)
    .where(where)
    .orderBy(asc(ragChunkTable.id));
  return opts.limit === undefined ? query : query.limit(opts.limit);
};
