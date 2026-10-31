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
    throw new Error("Legacy conversation requires review before migration");
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
    throw new Error("Migration destination conflicts with an existing conversation");
  }
};

const validateExistingMessage = (previous: StoredMessage, message: SourceMessage, turn: number) => {
  if (
    previous.turn !== turn ||
    previous.role !== message.role ||
    previous.content !== message.content ||
    previous.createdAt !== message.createdAt
  ) {
    throw new Error("Previously migrated message changed; review required");
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
    throw new Error("Previously migrated message missing from source; review required");
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
    if (turns.has(turn)) throw new Error("New legacy messages overlap a v2 turn; review required");
    if (message.role === "system") throw new Error("Unsupported message role");
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

const migrateConversation = async (
  db: V2Db,
  conversation: SourceConversation,
  targetUserId: string,
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
      ...missing.map((message) => db.insert(v2MessageTable).values(message)),
    ]);
  } else if (missing.length) {
    const [first, ...rest] = missing;
    await db.batch([
      db.insert(v2MessageTable).values(first),
      ...rest.map((message) => db.insert(v2MessageTable).values(message)),
    ]);
  }
  return {
    messages: messages.length,
    insertedMessages: missing.length,
    insertedConversations: existing ? 0 : 1,
  };
};

// 旧表は監査・画像・枝分かれ・記憶の参照元として保存する。本文もIDも書き換えない。
// 会話単位のbatchで確定するため、中断後は既存の行を照合して安全に続きから進められる。
export const migrateLegacyConversations = async (db: V2Db, options: LegacyMigrationOptions) => {
  const conversations = await db
    .select()
    .from(conversationTable)
    .where(eq(conversationTable.userId, options.sourceUserId))
    .orderBy(asc(conversationTable.id));
  if (!conversations.length) throw new Error("No legacy conversations for the selected owner");
  const result = {
    conversations: conversations.length,
    messages: 0,
    insertedConversations: 0,
    insertedMessages: 0,
  };
  for (const [index, conversation] of conversations.entries()) {
    const current = await migrateConversation(db, conversation, options.targetUserId);
    result.messages += current.messages;
    result.insertedConversations += current.insertedConversations;
    result.insertedMessages += current.insertedMessages;
    options.afterConversation?.(index + 1);
  }
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
