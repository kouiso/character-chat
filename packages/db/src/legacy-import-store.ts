// RIT-77 台帳（v2_legacy_import）の読み書きと、利用者の札・内容ハッシュ。
// 札は利用者 ID を応答やログへ出さないための呼び名（RIT-68 と同じ作り方）。
import { and, asc, count, eq, sql } from "drizzle-orm";

import { conversationTable } from "../../../src/schema/conversation";
import { messageTable } from "../../../src/schema/message";

import { hashMemorySource } from "./memory-extraction-store";
import { v2ConversationTable, v2LegacyImportTable } from "./v2-schema";

import type { V2Db } from "./client";

export type LegacyImportRow = typeof v2LegacyImportTable.$inferSelect;
export type LegacyImportInsert = typeof v2LegacyImportTable.$inferInsert;

// `local` はそのまま、ほかは `owner-<ID の SHA-256 の先頭 8 桁>`。
export const legacyOwnerLabel = async (userId: string): Promise<string> =>
  userId === "local" ? "local" : `owner-${(await hashMemorySource(userId)).slice(0, 8)}`;

// 会話行のハッシュは [character_id, created_at]、発言行は [role, created_at, content]。
export const legacyConversationHash = (conversation: {
  characterId: string;
  createdAt: number;
}): Promise<string> =>
  hashMemorySource(JSON.stringify([conversation.characterId, conversation.createdAt]));

export const legacyMessageHash = (message: {
  role: string;
  createdAt: number;
  content: string;
}): Promise<string> =>
  hashMemorySource(JSON.stringify([message.role, message.createdAt, message.content]));

// 会話ごとの台帳の行を全部読む（計画の入力 L）。
export const listLegacyImportRows = async (
  db: V2Db,
  conversationId: string,
): Promise<LegacyImportRow[]> =>
  db
    .select()
    .from(v2LegacyImportTable)
    .where(eq(v2LegacyImportTable.conversationId, conversationId))
    .orderBy(asc(v2LegacyImportTable.legacyTable), asc(v2LegacyImportTable.legacyId));

// 旧 conversation.user_id の全種類。札から利用者の ID を引く時はこれを全部札に直して突き合わせる。
export const listLegacyConversationUserIds = async (db: V2Db): Promise<string[]> => {
  const rows = await db
    .selectDistinct({ userId: conversationTable.userId })
    .from(conversationTable);
  return rows.map((row) => row.userId);
};

// 札から移行元の利用者の ID を引く。当たる利用者が無ければ null（受け口は 404 にする）。
// 複数の利用者を自動で合わせないので、札が 1 人に当たる時だけ返す。
export const resolveLegacySourceOwner = async (db: V2Db, label: string): Promise<string | null> => {
  for (const userId of await listLegacyConversationUserIds(db)) {
    if ((await legacyOwnerLabel(userId)) === label) return userId;
  }
  return null;
};

export type LegacySourceSummary = {
  sourceOwner: string;
  sourceUserId: string;
  conversations: number;
  messages: number;
  importedConversations: number;
};

// `sources` モードの一覧。利用者の札ごとの旧会話・旧発言・v2 に在る移行済み会話の件数。
// importedConversations は legacy_source_user_id か台帳の source_user_id が
// その利用者を指す行の数（台帳の無い頃に移した行も拾う）。
export const listLegacySources = async (db: V2Db): Promise<LegacySourceSummary[]> => {
  const conversationCounts = await db
    .select({ userId: conversationTable.userId, n: count() })
    .from(conversationTable)
    .groupBy(conversationTable.userId)
    .orderBy(asc(conversationTable.userId));
  const messageCounts = new Map(
    (
      await db
        .select({ userId: messageTable.userId, n: count() })
        .from(messageTable)
        .groupBy(messageTable.userId)
    ).map((row) => [row.userId, row.n]),
  );
  const importedRows = await db
    .select({
      sourceUserId: v2ConversationTable.legacySourceUserId,
      ledgerSourceUserId: v2LegacyImportTable.sourceUserId,
    })
    .from(v2ConversationTable)
    .leftJoin(
      v2LegacyImportTable,
      and(
        eq(v2LegacyImportTable.legacyTable, "conversation"),
        eq(v2LegacyImportTable.legacyId, v2ConversationTable.id),
      ),
    )
    .where(
      sql`${v2ConversationTable.legacySourceUserId} is not null or ${v2LegacyImportTable.sourceUserId} is not null`,
    );
  const importedCounts = new Map<string, number>();
  for (const row of importedRows) {
    const effective = row.sourceUserId ?? row.ledgerSourceUserId;
    if (effective) importedCounts.set(effective, (importedCounts.get(effective) ?? 0) + 1);
  }
  return Promise.all(
    conversationCounts.map(async (row) => ({
      sourceOwner: await legacyOwnerLabel(row.userId),
      sourceUserId: row.userId,
      conversations: row.n,
      messages: messageCounts.get(row.userId) ?? 0,
      importedConversations: importedCounts.get(row.userId) ?? 0,
    })),
  );
};
