// RIT-77 旧会話の取り込み。旧 conversation/message を同じ id で v2_conversation/v2_message に写し、
// 写した記録を台帳 v2_legacy_import に残す。台帳が「移した・v2 で消した・まだ移していない」の
// 見分けの正本で、v2_ledger（返事の台帳）は「v2 が書いた番号」の判定にだけ使う。
// 旧表は監査・画像の参照元として保存する。本文も id も書き換えない。
// 会話単位の 1 batch で確定するため、中断後は既存の行を照合して安全に続きから進められる。
// 要確認の会話はその会話だけ書かずに飛ばす。会話どうしは独立しとるので、後ろの会話まで止める理由が無い。
import { and, asc, desc, eq, gt, isNull, or, sql } from "drizzle-orm";

import { conversationTable } from "../../../src/schema/conversation";
import { messageTable } from "../../../src/schema/message";

import {
  legacyConversationHash,
  legacyMessageHash,
  type LegacyImportInsert,
  type LegacyImportRow,
} from "./legacy-import-store";
import {
  v2ConversationTable,
  v2LedgerTable,
  v2LegacyImportTable,
  v2MessageTable,
} from "./v2-schema";

import type { V2Db } from "./client";

type SourceConversation = typeof conversationTable.$inferSelect;
type SourceMessage = Pick<
  typeof messageTable.$inferSelect,
  "id" | "role" | "content" | "createdAt" | "userId" | "characterId" | "imageKey"
>;
type StoredMessage = typeof v2MessageTable.$inferSelect;
type DestinationConversation = typeof v2ConversationTable.$inferSelect;
// db.batch が受ける1文の型。生成系と更新系が混ざるので要素型だけを外に出す。
type BatchStatement = Parameters<V2Db["batch"]>[0] extends readonly (infer U)[] ? U : never;

export const LEGACY_MIGRATION_CODES = [
  "source_owner_mismatch",
  "destination_conflict",
  "source_changed",
  "source_deleted",
  "source_conversation_deleted",
  "source_owner_unknown",
  "write_failed",
] as const;
export type LegacyMigrationCode = (typeof LEGACY_MIGRATION_CODES)[number];

export type LegacyMigrationFailure = { conversationId: string; code: LegacyMigrationCode };

export type LegacyMigrationCounts = {
  insertedConversations: number;
  insertedMessages: number;
  updatedConversations: number;
  backfilledLedgerRows: number;
  backfilledImageKeys: number;
  skippedSystemMessages: number;
  skippedDeletedConversations: number;
  skippedDeletedMessages: number;
  skippedAfterV2Continue: number;
};

export type LegacyMigrationResult = LegacyMigrationCounts & {
  conversations: number;
  // 旧発言の件数（system を除く）。system の数は skippedSystemMessages に分けて出す。
  messages: number;
  failures: LegacyMigrationFailure[];
  nextCursor: string | null;
};

export type LegacyMigrationOptions = {
  sourceUserId: string;
  targetUserId: string;
  // 省略は「確認だけ」（何も書かずに計画の件数を返す）。true で書く。
  apply?: boolean;
  // ページの並びは旧 conversation.id の昇順。cursor は前のページの最後の id。
  cursor?: string;
  // 省略は全件（手元の復元コピー用）。受け口は既定 5・最大 20 に絞る。
  limit?: number;
  // apply の時は確認だけで見た件数と照合し、違えば何も書かずに LegacyPlanChangedError。
  expected?: { insertedConversations: number; insertedMessages: number };
  afterConversation?: (completed: number) => void;
};

export class LegacyPlanChangedError extends Error {
  readonly planned: { insertedConversations: number; insertedMessages: number };
  constructor(planned: { insertedConversations: number; insertedMessages: number }) {
    super("確認だけで見た件数と計画が変わっている");
    this.name = "LegacyPlanChangedError";
    this.planned = planned;
  }
}

// 会話 1 件ぶんの計画。failures には入らない分（v2 で消した・続けた後の旧発言）は
// 件数だけ数え、要確認の時は code を立てて書く物を全部捨てる。
type ConversationPlan = {
  conversationId: string;
  code: LegacyMigrationCode | null;
  sourceMessages: number;
  systemMessages: number;
  matchedMessages: number;
  skippedDeletedMessages: number;
  skippedAfterV2Continue: number;
  skippedDeletedConversations: number;
  updatedConversations: number;
  imageRefs: { source: number; v2: number };
  // 書く物
  hasV2: boolean;
  hasConversationLedger: boolean;
  existing: DestinationConversation | undefined;
  insertConversation: boolean;
  insertMessages: (typeof v2MessageTable.$inferInsert)[];
  ledgerRows: { row: LegacyImportInsert; backfill: boolean }[];
  imageKeyFills: { id: string; imageKey: string }[];
};

const newPlan = (
  conversationId: string,
  sourceMessages: number,
  systemMessages: number,
): ConversationPlan => ({
  conversationId,
  code: null,
  sourceMessages,
  systemMessages,
  matchedMessages: 0,
  skippedDeletedMessages: 0,
  skippedAfterV2Continue: 0,
  skippedDeletedConversations: 0,
  updatedConversations: 0,
  imageRefs: { source: 0, v2: 0 },
  hasV2: false,
  hasConversationLedger: false,
  existing: undefined,
  insertConversation: false,
  insertMessages: [],
  ledgerRows: [],
  imageKeyFills: [],
});

const fail = (plan: ConversationPlan, code: LegacyMigrationCode) => {
  if (plan.code === null) plan.code = code;
};

const planCounts = (plan: ConversationPlan): LegacyMigrationCounts => ({
  insertedConversations: plan.insertConversation ? 1 : 0,
  insertedMessages: plan.insertMessages.length,
  updatedConversations: plan.updatedConversations,
  backfilledLedgerRows: plan.ledgerRows.filter((entry) => entry.backfill).length,
  backfilledImageKeys: plan.imageKeyFills.length,
  skippedSystemMessages: plan.systemMessages,
  skippedDeletedConversations: plan.skippedDeletedConversations,
  skippedDeletedMessages: plan.skippedDeletedMessages,
  skippedAfterV2Continue: plan.skippedAfterV2Continue,
});

// 台帳の行の型は会話も発言も同じ。会話は legacy_table='conversation'、発言は 'message'。
// backfill は「台帳の無い頃に移した行を後から埋めた行」の印（件数の集計用。表には入らん）。
const conversationLedgerRow = async (
  conversation: SourceConversation,
  targetUserId: string,
  importedAt: number,
  backfill: boolean,
): Promise<{ row: LegacyImportInsert; backfill: boolean }> => ({
  row: {
    legacyTable: "conversation",
    legacyId: conversation.id,
    v2Id: conversation.id,
    conversationId: conversation.id,
    sourceUserId: conversation.userId,
    targetUserId,
    contentHash: await legacyConversationHash(conversation),
    importedAt,
  },
  backfill,
});

const messageLedgerRow = async (
  message: SourceMessage,
  conversationId: string,
  sourceUserId: string,
  targetUserId: string,
  importedAt: number,
  backfill: boolean,
): Promise<{ row: LegacyImportInsert; backfill: boolean }> => ({
  row: {
    legacyTable: "message",
    legacyId: message.id,
    v2Id: message.id,
    conversationId,
    sourceUserId,
    targetUserId,
    contentHash: await legacyMessageHash(message),
    importedAt,
  },
  backfill,
});

type ConversationInputs = {
  messages: SourceMessage[];
  v2: DestinationConversation | undefined;
  destination: StoredMessage[];
  ledger: LegacyImportRow[];
  v2Turns: Set<number>;
};

const readConversationInputs = async (
  db: V2Db,
  conversation: SourceConversation,
): Promise<ConversationInputs> => {
  const messages = await db
    .select({
      id: messageTable.id,
      role: messageTable.role,
      content: messageTable.content,
      createdAt: messageTable.createdAt,
      userId: messageTable.userId,
      characterId: messageTable.characterId,
      imageKey: messageTable.imageKey,
    })
    .from(messageTable)
    .where(eq(messageTable.conversationId, conversation.id))
    .orderBy(asc(messageTable.createdAt), sql`message.rowid`);
  const [v2] = await db
    .select()
    .from(v2ConversationTable)
    .where(eq(v2ConversationTable.id, conversation.id));
  const destination = await db
    .select()
    .from(v2MessageTable)
    .where(eq(v2MessageTable.conversationId, conversation.id));
  const ledger = await db
    .select()
    .from(v2LegacyImportTable)
    .where(eq(v2LegacyImportTable.conversationId, conversation.id));
  const v2Turns = new Set(
    (
      await db
        .select({ turn: v2LedgerTable.turn })
        .from(v2LedgerTable)
        .where(eq(v2LedgerTable.conversationId, conversation.id))
    ).map((row) => row.turn),
  );
  return { messages, v2, destination, ledger, v2Turns };
};

const hasSourceOwnerMismatch = (
  messages: SourceMessage[],
  conversation: SourceConversation,
): boolean =>
  messages.some(
    (message) =>
      message.userId !== conversation.userId || message.characterId !== conversation.characterId,
  );

const hasDestinationConflict = (
  existing: DestinationConversation,
  conversation: SourceConversation,
  targetUserId: string,
): boolean =>
  existing.userId !== targetUserId ||
  existing.characterId !== conversation.characterId ||
  (existing.legacySourceUserId !== null && existing.legacySourceUserId !== conversation.userId) ||
  existing.promptVersion !== "legacy-import-v1";

// 移行済みの発言は番号・役・本文・日時が全部元と同じでなければ source_changed。
const isStoredMatch = (stored: StoredMessage, message: SourceMessage, turn: number): boolean =>
  stored.turn === turn &&
  stored.role === message.role &&
  stored.content === message.content &&
  stored.createdAt === message.createdAt;

// 旧アプリは作成後も題名と更新日時を書き換える。再実行で最後の差分を移す時に、それも揃える。
// 更新日時は v2 で続けた方が新しいこともあるので、新しい方を残す。
const needsRefresh = (
  existing: DestinationConversation,
  conversation: SourceConversation,
): boolean =>
  existing.title !== conversation.title ||
  existing.updatedAt < conversation.updatedAt ||
  existing.legacySourceUserId === null;

type ClassificationInput = {
  plan: ConversationPlan;
  conversation: SourceConversation;
  targetUserId: string;
  importedAt: number;
  inputs: ConversationInputs;
  // 台帳の無い頃に移した会話だけ N が立つ（それ以外は null → 台帳の決まりで見る）。
  preLedgerLimit: number | null;
};

// 台帳の無い頃に移した会話の N。元と id が一致する行の番号の最大に、v2 が旧発言の
// 番号（|M| 以下）を作り直した番号も足す: 作り直しは行ごと消して新しい id で入れ直すので、
// その番号より前の「D に無い旧発言」は作り直し・削除で消えた物と見分ける。
const preLedgerLimit = (inputs: ConversationInputs, sourceCount: number): number => {
  const sourceIds = new Set(inputs.messages.map((message) => message.id));
  const matched = inputs.destination
    .filter((message) => sourceIds.has(message.id))
    .map((message) => message.turn);
  const rewritten = [...inputs.v2Turns].filter((turn) => turn <= sourceCount);
  return Math.max(0, ...matched, ...rewritten);
};

const classifyMessage = async (
  message: SourceMessage,
  index: number,
  ctx: ClassificationCtx,
): Promise<void> => {
  const { plan, inputs, importedAt, targetUserId, conversation, preLedgerLimit: limit } = ctx;
  const turn = index + 1;
  const stored = inputs.destination.find((row) => row.id === message.id);
  const inLedger = inputs.ledger.some(
    (row) => row.legacyTable === "message" && row.legacyId === message.id,
  );
  if (stored) {
    if (!isStoredMatch(stored, message, turn)) {
      fail(plan, "source_changed");
      return;
    }
    plan.matchedMessages += 1;
    // 台帳の無い頃に移した行は台帳の行だけを足す（v2_id は旧の id）。
    if (!inLedger) {
      plan.ledgerRows.push(
        await messageLedgerRow(
          message,
          conversation.id,
          conversation.userId,
          targetUserId,
          importedAt,
          true,
        ),
      );
    }
    // 前に移した行で image_key が空の物は取り込み直しで埋める。
    if (stored.imageKey === null && message.imageKey !== null) {
      plan.imageKeyFills.push({ id: stored.id, imageKey: message.imageKey });
    }
    return;
  }
  // v2 で消した発言（台帳に行が在るのに v2 の行が無い）。
  if (inLedger) {
    plan.skippedDeletedMessages += 1;
    return;
  }
  // 台帳の無い頃に移した会話だけの決まり: 番号が N 以下で D に無い旧発言は
  // v2 で消した物と見なし、台帳の行だけを足す（次の実行からは台帳の決まりで飛ぶ）。
  if (limit !== null && turn <= limit) {
    plan.skippedDeletedMessages += 1;
    plan.ledgerRows.push(
      await messageLedgerRow(
        message,
        conversation.id,
        conversation.userId,
        targetUserId,
        importedAt,
        true,
      ),
    );
    return;
  }
  ctx.newSourceMessages.push({ message, turn });
};

type ClassificationCtx = ClassificationInput & {
  newSourceMessages: { message: SourceMessage; turn: number }[];
};

// 「L に在る発言の行のうち、M に無く、D には在る物」は元から消えたが v2 に残る発言。
// D にも無い物は v2 で消した発言として残るので要確認にしない。
const checkLedgerOrphans = (ctx: ClassificationCtx): void => {
  const sourceIds = new Set(ctx.inputs.messages.map((message) => message.id));
  const destinationIds = new Set(ctx.inputs.destination.map((row) => row.id));
  for (const row of ctx.inputs.ledger) {
    if (row.legacyTable !== "message") continue;
    if (!sourceIds.has(row.legacyId) && destinationIds.has(row.v2Id)) {
      fail(ctx.plan, "source_deleted");
      return;
    }
  }
};

// 台帳の無い頃に移した会話: D に在って M に無い行のうち番号が N 以下の物は、
// その番号が v2 が書いた番号なら作り直しの行、そうでなければ source_deleted。
// 番号が N より大きい物は v2 で足した発言（返事・話しかけ・画像）で、要確認にしない。
const checkPreLedgerOrphans = (ctx: ClassificationCtx): void => {
  const sourceIds = new Set(ctx.inputs.messages.map((message) => message.id));
  for (const row of ctx.inputs.destination) {
    if (sourceIds.has(row.id)) continue;
    if (
      ctx.preLedgerLimit !== null &&
      row.turn <= ctx.preLedgerLimit &&
      !ctx.inputs.v2Turns.has(row.turn)
    ) {
      fail(ctx.plan, "source_deleted");
      return;
    }
  }
};

// 新しい旧発言は、最も若い番号が D の番号の最大以下なら「v2 で続けた後の旧発言」。
// 写さず・台帳も書かず・件数だけ数える（要確認にも終了コードにも効かせない）。
const settleNewSourceMessages = async (ctx: ClassificationCtx): Promise<void> => {
  const { plan, inputs, importedAt, targetUserId, conversation } = ctx;
  const found = ctx.newSourceMessages;
  if (found.length === 0) return;
  const first = Math.min(...found.map((entry) => entry.turn));
  const maxDestinationTurn = Math.max(0, ...inputs.destination.map((row) => row.turn));
  if (first <= maxDestinationTurn) {
    plan.skippedAfterV2Continue += found.length;
    return;
  }
  for (const { message, turn } of found) {
    plan.insertMessages.push({
      id: message.id,
      conversationId: conversation.id,
      turn,
      role: message.role === "user" ? "user" : "assistant",
      content: message.content,
      imageKey: message.imageKey,
      createdAt: message.createdAt,
    });
    plan.ledgerRows.push(
      await messageLedgerRow(
        message,
        conversation.id,
        conversation.userId,
        targetUserId,
        importedAt,
        false,
      ),
    );
  }
};

// 会話 1 件の計画（要求定義の「処理の流れ」）。書き込みは apply の時だけ writeConversationPlan が
// 1 つの batch で行う。
const planConversation = async (
  db: V2Db,
  conversation: SourceConversation,
  targetUserId: string,
  importedAt: number,
): Promise<ConversationPlan> => {
  const inputs = await readConversationInputs(db, conversation);
  // 番号は system を除いて数える。除いた数は skippedSystemMessages に出す。
  const filtered = inputs.messages.filter((message) => message.role !== "system");
  const plan = newPlan(conversation.id, filtered.length, inputs.messages.length - filtered.length);
  plan.hasV2 = inputs.v2 !== undefined;
  plan.existing = inputs.v2;
  plan.hasConversationLedger = inputs.ledger.some((row) => row.legacyTable === "conversation");
  if (hasSourceOwnerMismatch(filtered, conversation)) {
    fail(plan, "source_owner_mismatch");
    return plan;
  }
  // 台帳に会話の行が在って v2 の行が無い = v2 で消した会話。戻さない。
  if (plan.hasConversationLedger && !inputs.v2) {
    plan.skippedDeletedConversations = 1;
    plan.skippedDeletedMessages = filtered.length;
    return plan;
  }
  if (inputs.v2 && hasDestinationConflict(inputs.v2, conversation, targetUserId)) {
    fail(plan, "destination_conflict");
    return plan;
  }
  const ctx: ClassificationCtx = {
    plan,
    conversation,
    targetUserId,
    importedAt,
    inputs: { ...inputs, messages: filtered },
    preLedgerLimit:
      inputs.v2 && !plan.hasConversationLedger ? preLedgerLimit(inputs, filtered.length) : null,
    newSourceMessages: [],
  };
  if (inputs.v2 && !plan.hasConversationLedger) {
    // 台帳の無い頃に移した会話は、会話の台帳の行を後から足す。
    plan.ledgerRows.push(await conversationLedgerRow(conversation, targetUserId, importedAt, true));
    checkPreLedgerOrphans(ctx);
  } else if (!inputs.v2) {
    plan.insertConversation = true;
    plan.ledgerRows.push(
      await conversationLedgerRow(conversation, targetUserId, importedAt, false),
    );
  }
  for (const [index, message] of filtered.entries()) {
    await classifyMessage(message, index, ctx);
  }
  checkLedgerOrphans(ctx);
  await settleNewSourceMessages(ctx);
  plan.imageRefs = {
    source: filtered.filter((message) => message.imageKey !== null).length,
    v2: filtered.filter(
      (message) =>
        message.imageKey !== null && inputs.destination.some((row) => row.id === message.id),
    ).length,
  };
  if (inputs.v2 && needsRefresh(inputs.v2, conversation)) plan.updatedConversations = 1;
  if (plan.code !== null) {
    plan.insertConversation = false;
    plan.insertMessages = [];
    plan.ledgerRows = [];
    plan.imageKeyFills = [];
    plan.updatedConversations = 0;
  }
  return plan;
};

// 書く（apply の時だけ）。会話 1 件を 1 つの batch で: 会話の行（無い時）／発言の行／
// 台帳の行（onConflictDoNothing）／image_key の埋め／題・更新日時・移行元の合わせ直し。
const writeConversationPlan = async (
  db: V2Db,
  conversation: SourceConversation,
  plan: ConversationPlan,
  targetUserId: string,
): Promise<void> => {
  const statements: BatchStatement[] = [];
  const existing = plan.existing;
  if (plan.insertConversation) {
    statements.push(
      db.insert(v2ConversationTable).values({
        id: conversation.id,
        userId: targetUserId,
        legacySourceUserId: conversation.userId,
        characterId: conversation.characterId,
        title: conversation.title,
        threadId: conversation.id,
        promptVersion: "legacy-import-v1",
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
      }),
    );
  } else if (existing && plan.updatedConversations === 1) {
    statements.push(
      db
        .update(v2ConversationTable)
        .set({
          title: conversation.title,
          legacySourceUserId: conversation.userId,
          updatedAt: Math.max(existing.updatedAt, conversation.updatedAt),
        })
        .where(eq(v2ConversationTable.id, conversation.id)),
    );
  }
  for (const message of plan.insertMessages) {
    statements.push(db.insert(v2MessageTable).values(message));
  }
  for (const { row } of plan.ledgerRows) {
    statements.push(db.insert(v2LegacyImportTable).values(row).onConflictDoNothing());
  }
  for (const fill of plan.imageKeyFills) {
    statements.push(
      db
        .update(v2MessageTable)
        .set({ imageKey: fill.imageKey })
        .where(and(eq(v2MessageTable.id, fill.id), isNull(v2MessageTable.imageKey))),
    );
  }
  // batch は空を受け付けないので、書く物がある時だけ先頭を取り出して実行する。
  const [first, ...rest] = statements;
  if (first !== undefined) await db.batch([first, ...rest]);
};

const addCounts = (into: LegacyMigrationCounts, counts: LegacyMigrationCounts): void => {
  for (const key of Object.keys(into) as (keyof LegacyMigrationCounts)[]) {
    into[key] += counts[key];
  }
};

const emptyCounts = (): LegacyMigrationCounts => ({
  insertedConversations: 0,
  insertedMessages: 0,
  updatedConversations: 0,
  backfilledLedgerRows: 0,
  backfilledImageKeys: 0,
  skippedSystemMessages: 0,
  skippedDeletedConversations: 0,
  skippedDeletedMessages: 0,
  skippedAfterV2Continue: 0,
});

const readSourceConversations = async (
  db: V2Db,
  sourceUserId: string,
  cursor: string | undefined,
  limit: number | undefined,
): Promise<SourceConversation[]> => {
  const where = cursor
    ? and(eq(conversationTable.userId, sourceUserId), gt(conversationTable.id, cursor))
    : eq(conversationTable.userId, sourceUserId);
  const query = db.select().from(conversationTable).where(where).orderBy(asc(conversationTable.id));
  return limit === undefined ? query : query.limit(limit + 1);
};

// cursor が無いページだけ、v2 に在って旧に無い会話を探す。
// 台帳の行が在れば元の利用者は台帳から分かるので、由来が分かる物は source_conversation_deleted、
// 元の利用者も分からん物は source_owner_unknown。
const findMissingConversations = async (
  db: V2Db,
  sourceUserId: string,
  targetUserId: string,
): Promise<LegacyMigrationFailure[]> => {
  const imported = await db
    .select({
      id: v2ConversationTable.id,
      legacySourceUserId: v2ConversationTable.legacySourceUserId,
      ledgerSourceUserId: v2LegacyImportTable.sourceUserId,
      currentSourceUserId: conversationTable.userId,
    })
    .from(v2ConversationTable)
    .leftJoin(conversationTable, eq(conversationTable.id, v2ConversationTable.id))
    .leftJoin(
      v2LegacyImportTable,
      and(
        eq(v2LegacyImportTable.legacyTable, "conversation"),
        eq(v2LegacyImportTable.legacyId, v2ConversationTable.id),
      ),
    )
    .where(
      and(
        eq(v2ConversationTable.userId, targetUserId),
        eq(v2ConversationTable.promptVersion, "legacy-import-v1"),
      ),
    )
    .orderBy(asc(v2ConversationTable.id));
  const failures: LegacyMigrationFailure[] = [];
  for (const row of imported) {
    const effectiveSource = row.legacySourceUserId ?? row.ledgerSourceUserId;
    if (effectiveSource !== null && effectiveSource !== sourceUserId) continue;
    if (effectiveSource === sourceUserId) {
      if (row.currentSourceUserId !== sourceUserId) {
        failures.push({ conversationId: row.id, code: "source_conversation_deleted" });
      }
    } else if (row.currentSourceUserId === null) {
      failures.push({ conversationId: row.id, code: "source_owner_unknown" });
    }
  }
  return failures;
};

// 旧会話を id の昇順に limit 件ずつ計画する。apply が偽なら計画の件数だけを返し、
// 真なら計画が expected と一致する時だけ 1 会話 1 batch で書く。
export const migrateLegacyConversations = async (
  db: V2Db,
  options: LegacyMigrationOptions,
): Promise<LegacyMigrationResult> => {
  const fetched = await readSourceConversations(
    db,
    options.sourceUserId,
    options.cursor,
    options.limit,
  );
  const hasMore = options.limit !== undefined && fetched.length > options.limit;
  const conversations = fetched.slice(0, options.limit ?? fetched.length);
  const nextCursor = hasMore ? conversations[conversations.length - 1].id : null;
  const apply = options.apply === true;
  const importedAt = Date.now();
  const plans: { conversation: SourceConversation; plan: ConversationPlan }[] = [];
  for (const conversation of conversations) {
    plans.push({
      conversation,
      plan: await planConversation(db, conversation, options.targetUserId, importedAt),
    });
  }
  const planned = plans.reduce((acc, { plan }) => {
    addCounts(acc, planCounts(plan));
    return acc;
  }, emptyCounts());
  if (
    apply &&
    options.expected !== undefined &&
    (planned.insertedConversations !== options.expected.insertedConversations ||
      planned.insertedMessages !== options.expected.insertedMessages)
  ) {
    throw new LegacyPlanChangedError({
      insertedConversations: planned.insertedConversations,
      insertedMessages: planned.insertedMessages,
    });
  }
  const counts = emptyCounts();
  const failures: LegacyMigrationFailure[] = options.cursor
    ? []
    : await findMissingConversations(db, options.sourceUserId, options.targetUserId);
  for (const [index, { conversation, plan }] of plans.entries()) {
    if (plan.code !== null) {
      failures.push({ conversationId: conversation.id, code: plan.code });
    } else if (apply) {
      try {
        await writeConversationPlan(db, conversation, plan, options.targetUserId);
        addCounts(counts, planCounts(plan));
      } catch {
        failures.push({ conversationId: conversation.id, code: "write_failed" });
      }
    } else {
      addCounts(counts, planCounts(plan));
    }
    options.afterConversation?.(index + 1);
  }
  return {
    conversations: conversations.length,
    messages: plans.reduce((acc, { plan }) => acc + plan.sourceMessages, 0),
    ...counts,
    failures,
    nextCursor,
  };
};

export type LegacyVerifyItem = {
  conversationId: string;
  status: "match" | "not_imported" | "deleted_in_v2" | "mismatch";
  code?: LegacyMigrationCode;
  matchedMessages: number;
  deletedMessagesInV2: number;
  skippedAfterV2Continue: number;
};

export type LegacyVerifyResult = {
  conversations: number;
  messages: number;
  items: LegacyVerifyItem[];
  imageRefs: { source: number; v2: number };
  nextCursor: string | null;
};

// `verify-conversations`: 旧会話と v2 の行を 1 件ずつ比べ、状態を 4 つのどれかで返す。何も書かない。
// match は、写すべき旧発言が全部一致し、残りが v2 で消した発言か v2 で続けた後の旧発言である事。
export const verifyLegacyConversations = async (
  db: V2Db,
  options: { sourceUserId: string; targetUserId: string; cursor?: string; limit?: number },
): Promise<LegacyVerifyResult> => {
  const fetched = await readSourceConversations(
    db,
    options.sourceUserId,
    options.cursor,
    options.limit,
  );
  const hasMore = options.limit !== undefined && fetched.length > options.limit;
  const conversations = fetched.slice(0, options.limit ?? fetched.length);
  const nextCursor = hasMore ? conversations[conversations.length - 1].id : null;
  const items: LegacyVerifyItem[] = [];
  const imageRefs = { source: 0, v2: 0 };
  let messages = 0;
  for (const conversation of conversations) {
    const plan = await planConversation(db, conversation, options.targetUserId, Date.now());
    messages += plan.sourceMessages;
    imageRefs.source += plan.imageRefs.source;
    imageRefs.v2 += plan.imageRefs.v2;
    let status: LegacyVerifyItem["status"];
    if (!plan.hasV2 && plan.hasConversationLedger) status = "deleted_in_v2";
    else if (!plan.hasV2) status = "not_imported";
    else if (plan.code !== null) status = "mismatch";
    else if (plan.insertMessages.length > 0) status = "not_imported";
    else status = "match";
    items.push({
      conversationId: conversation.id,
      status,
      ...(plan.code !== null ? { code: plan.code } : {}),
      matchedMessages: plan.matchedMessages,
      deletedMessagesInV2: plan.skippedDeletedMessages,
      skippedAfterV2Continue: plan.skippedAfterV2Continue,
    });
  }
  return { conversations: conversations.length, messages, items, imageRefs, nextCursor };
};

export type ConversationSummaryRow = {
  id: string;
  characterId: string;
  title: string;
  updatedAt: number;
  lastMessage: string | null;
};

export const listConversations = async (db: V2Db, userId: string) =>
  db
    .select({
      id: v2ConversationTable.id,
      characterId: v2ConversationTable.characterId,
      title: v2ConversationTable.title,
      updatedAt: v2ConversationTable.updatedAt,
      // RIT-30 ギャップ（Saylo 会話一覧の AI 応答プレビュー）: 直近の相手の発話を
      // 一覧へ出す。枝分かれの inactive 行は出さん。
      // select 句内の sql 片では drizzle がカラムのテーブル修飾を落とすため、
      // 相関サブクエリは下の exists と同じくリテラル名で書く。
      lastMessage: sql<string | null>`(
        select content from v2_message
        where v2_message.conversation_id = v2_conversation.id
          and v2_message.role = 'assistant'
          and v2_message.active = 1
        order by v2_message.turn desc
        limit 1
      )`,
    })
    .from(v2ConversationTable)
    .where(
      and(
        eq(v2ConversationTable.userId, userId),
        or(
          sql`${v2ConversationTable.legacySourceUserId} is not null`,
          sql`exists (
            select 1 from v2_message
            where v2_message.conversation_id = v2_conversation.id
          )`,
        ),
      ),
    )
    .orderBy(desc(v2ConversationTable.updatedAt));
