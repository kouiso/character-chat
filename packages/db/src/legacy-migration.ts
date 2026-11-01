import { asc, desc, eq, sql } from "drizzle-orm";

import { conversationTable } from "../../../src/schema/conversation";
import { messageTable } from "../../../src/schema/message";

import { v2ConversationTable, v2LedgerTable, v2MessageTable } from "./v2-schema";

import type { V2Db } from "./client";

type SourceConversation = typeof conversationTable.$inferSelect;
type SourceMessage = Pick<
  typeof messageTable.$inferSelect,
  "id" | "role" | "content" | "createdAt" | "userId" | "characterId"
>;
type StoredMessage = typeof v2MessageTable.$inferSelect;
type MigratedMessage = typeof v2MessageTable.$inferInsert;

export type LegacyMigrationOptions = {
  sourceUserId: string;
  targetUserId: string;
  afterConversation?: (completed: number) => void;
  // 書き込みだけを飛ばし、照合と計画は本番と同じ道を通る（移行前の確認用）。
  dryRun?: boolean;
};

const validateSource = (messages: SourceMessage[], conversation: SourceConversation) => {
  if (
    messages.some(
      (message) =>
        message.role === "system" ||
        message.userId !== conversation.userId ||
        message.characterId !== conversation.characterId,
    )
  ) {
    throw new Error("移行前の確認が必要: system 役の発言か、会話と別の利用者・キャラの発言がある");
  }
};

const validateDestination = (
  existing: typeof v2ConversationTable.$inferSelect | undefined,
  conversation: SourceConversation,
  targetUserId: string,
) => {
  if (
    existing &&
    (existing.userId !== targetUserId ||
      existing.characterId !== conversation.characterId ||
      existing.promptVersion !== "legacy-import-v1")
  ) {
    throw new Error("移行先に同じIDで別の利用者・キャラ・版の会話がある");
  }
};

const validateExistingMessage = (previous: StoredMessage, message: SourceMessage, turn: number) => {
  if (
    previous.turn !== turn ||
    previous.role !== message.role ||
    previous.content !== message.content ||
    previous.createdAt !== message.createdAt
  ) {
    throw new Error("移行済みの発言が元で変わっている（要確認）");
  }
};

// v2で続けたターンは saveTurn が必ず v2_ledger を同じbatchで書く。移行は ledger を書かんので、
// ledger の無いターンの行は旧表から写したものと見なせる。
const validateNothingMissing = (
  source: SourceMessage[],
  destination: StoredMessage[],
  v2Turns: Set<number>,
) => {
  const sourceIds = new Set(source.map((message) => message.id));
  if (destination.some((message) => !v2Turns.has(message.turn) && !sourceIds.has(message.id))) {
    throw new Error("移行済みの発言が元から消えている（要確認）");
  }
};

const planMessages = (
  source: SourceMessage[],
  destination: StoredMessage[],
  conversationId: string,
  v2Turns: Set<number>,
) => {
  validateNothingMissing(source, destination, v2Turns);
  const byId = new Map(destination.map((message) => [message.id, message]));
  const turns = new Set(destination.map((message) => message.turn));
  const missing: MigratedMessage[] = [];
  for (const [index, message] of source.entries()) {
    // 挨拶や連続発言も独立した番号にし、user/assistantの組数から順序を推測しない。
    const turn = index + 1;
    const previous = byId.get(message.id);
    if (previous) {
      validateExistingMessage(previous, message, turn);
      continue;
    }
    if (turns.has(turn)) {
      throw new Error("新しい旧発言の番号が v2 で続けたターンと重なる（要確認）");
    }
    if (message.role === "system") throw new Error("system 役の発言は移行できない");
    missing.push({
      id: message.id,
      role: message.role,
      content: message.content,
      createdAt: message.createdAt,
      turn,
      conversationId,
    });
  }
  return missing;
};

type DestinationConversation = typeof v2ConversationTable.$inferSelect;
type MissingMessage = typeof v2MessageTable.$inferInsert;

// 旧アプリは作成後も題名と更新日時を書き換える。再実行で最後の差分を移す時に、それも揃える。
// 更新日時は v2 で続けた方が新しいこともあるので、新しい方を残す。
const needsRefresh = (
  existing: DestinationConversation | undefined,
  conversation: SourceConversation,
): boolean =>
  existing !== undefined &&
  (existing.title !== conversation.title || existing.updatedAt < conversation.updatedAt);

const writeConversation = async (
  db: V2Db,
  plan: {
    existing: DestinationConversation | undefined;
    conversation: SourceConversation;
    targetUserId: string;
    missing: MissingMessage[];
    refresh: boolean;
  },
) => {
  const { existing, conversation, targetUserId, missing, refresh } = plan;
  const inserts = missing.map((message) => db.insert(v2MessageTable).values(message));
  if (!existing) {
    await db.batch([
      db.insert(v2ConversationTable).values({
        id: conversation.id,
        userId: targetUserId,
        characterId: conversation.characterId,
        title: conversation.title,
        threadId: conversation.id,
        promptVersion: "legacy-import-v1",
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
      }),
      ...inserts,
    ]);
    return;
  }
  const update = db
    .update(v2ConversationTable)
    .set({
      title: conversation.title,
      updatedAt: Math.max(existing.updatedAt, conversation.updatedAt),
    })
    .where(eq(v2ConversationTable.id, conversation.id));
  if (refresh) {
    await db.batch([update, ...inserts]);
  } else if (inserts.length > 0) {
    const [first, ...rest] = inserts;
    await db.batch([first, ...rest]);
  }
};

const migrateConversation = async (
  db: V2Db,
  conversation: SourceConversation,
  targetUserId: string,
  dryRun: boolean,
) => {
  const messages = await db
    .select({
      id: messageTable.id,
      role: messageTable.role,
      content: messageTable.content,
      createdAt: messageTable.createdAt,
      userId: messageTable.userId,
      characterId: messageTable.characterId,
    })
    .from(messageTable)
    .where(eq(messageTable.conversationId, conversation.id))
    .orderBy(asc(messageTable.createdAt), sql`message.rowid`);
  validateSource(messages, conversation);
  const [existing] = await db
    .select()
    .from(v2ConversationTable)
    .where(eq(v2ConversationTable.id, conversation.id));
  validateDestination(existing, conversation, targetUserId);
  const destination = await db
    .select()
    .from(v2MessageTable)
    .where(eq(v2MessageTable.conversationId, conversation.id));
  const ledgers = await db
    .select({ turn: v2LedgerTable.turn })
    .from(v2LedgerTable)
    .where(eq(v2LedgerTable.conversationId, conversation.id));
  const missing = planMessages(
    messages,
    destination,
    conversation.id,
    new Set(ledgers.map((ledger) => ledger.turn)),
  );
  const refresh = needsRefresh(existing, conversation);
  if (!dryRun) {
    await writeConversation(db, { existing, conversation, targetUserId, missing, refresh });
  }
  return {
    messages: messages.length,
    insertedMessages: missing.length,
    insertedConversations: existing ? 0 : 1,
    updatedConversations: refresh ? 1 : 0,
  };
};

export type LegacyMigrationResult = {
  conversations: number;
  messages: number;
  insertedConversations: number;
  insertedMessages: number;
  updatedConversations: number;
};

export type LegacyMigrationFailure = { conversationId: string; reason: string };

// 要確認の会話が 1 件でもあれば成功扱いにはせんが、どの会話を見ればよいかと、他の会話を
// 移行した結果は返す。
export class LegacyMigrationError extends Error {
  readonly failures: LegacyMigrationFailure[];
  readonly result: LegacyMigrationResult;
  constructor(failures: LegacyMigrationFailure[], result: LegacyMigrationResult) {
    super(
      `確認が必要な旧会話が ${failures.length} 件ある: ${failures
        .map((failure) => `${failure.conversationId}（${failure.reason}）`)
        .join("、")}`,
    );
    this.name = "LegacyMigrationError";
    this.failures = failures;
    this.result = result;
  }
}

// 旧表は監査・画像・枝分かれ・記憶の参照元として保存する。本文もIDも書き換えない。
// 会話単位のbatchで確定するため、中断後は既存の行を照合して安全に続きから進められる。
// 要確認の会話はその会話だけ書かずに飛ばす。会話どうしは独立しとるので、後ろの会話まで止める理由が無い。
export const migrateLegacyConversations = async (
  db: V2Db,
  options: LegacyMigrationOptions,
): Promise<LegacyMigrationResult> => {
  const conversations = await db
    .select()
    .from(conversationTable)
    .where(eq(conversationTable.userId, options.sourceUserId))
    .orderBy(asc(conversationTable.id));
  if (!conversations.length) throw new Error("指定した利用者の旧会話が無い");
  const result: LegacyMigrationResult = {
    conversations: conversations.length,
    messages: 0,
    insertedConversations: 0,
    insertedMessages: 0,
    updatedConversations: 0,
  };
  const failures: LegacyMigrationFailure[] = [];
  for (const [index, conversation] of conversations.entries()) {
    try {
      const current = await migrateConversation(
        db,
        conversation,
        options.targetUserId,
        options.dryRun === true,
      );
      result.messages += current.messages;
      result.insertedConversations += current.insertedConversations;
      result.insertedMessages += current.insertedMessages;
      result.updatedConversations += current.updatedConversations;
    } catch (caught) {
      failures.push({
        conversationId: conversation.id,
        reason: caught instanceof Error ? caught.message : String(caught),
      });
    }
    options.afterConversation?.(index + 1);
  }
  if (failures.length > 0) throw new LegacyMigrationError(failures, result);
  return result;
};

export const listConversations = async (db: V2Db, userId: string) =>
  db
    .select({
      id: v2ConversationTable.id,
      characterId: v2ConversationTable.characterId,
      title: v2ConversationTable.title,
      updatedAt: v2ConversationTable.updatedAt,
    })
    .from(v2ConversationTable)
    .where(eq(v2ConversationTable.userId, userId))
    .orderBy(desc(v2ConversationTable.updatedAt));
