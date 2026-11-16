// 記憶の手直しストア（RIT-92）。見る・直す・消す・固定・手で足す。
// vector index（Vectorize）への反映は env.AI が要るので apps/v2 側の API 層が担う。
// ここは D1 だけを触り、所有権の検証を全操作で行う。
import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";

import {
  v2ConversationTable,
  v2MemorySourceTable,
  v2MemoryTable,
  v2MemoryTombstoneTable,
  v2MessageTable,
  v2SummaryTable,
} from "./v2-schema";
import { hashMemorySource } from "./memory-extraction-store";

import type { V2Db } from "./client";

export type MemoryScope = { userId: string; characterId: string };

export type MemoryRow = {
  id: string;
  conversationId: string;
  kind: "fact" | "summary" | "preference";
  content: string;
  pinned: boolean;
  sourceTurn: number | null;
  createdAt: number;
  subject: string;
  supersededBy: string | null;
};

export class MemoryAccessError extends Error {
  constructor() {
    super("memory access denied");
  }
}

// 復元の期限（RIT-94 未決の既定案）。知らせの表示は 10 秒だが、サーバ側の窓は 30 秒。
export const MEMORY_RESTORE_WINDOW_MS = 30_000;

const toRow = (row: {
  id: string;
  conversationId: string;
  kind: "fact" | "summary" | "preference";
  content: string;
  pinned: number;
  sourceTurn: number | null;
  createdAt: number;
  subject: string;
  supersededBy: string | null;
}): MemoryRow => ({ ...row, pinned: row.pinned === 1 });

// キャラごとの記憶一覧（会話を跨ぐ。所有者一致の会話に限る）。
export const listCharacterMemories = async (db: V2Db, scope: MemoryScope): Promise<MemoryRow[]> => {
  const rows = await db
    .select({
      id: v2MemoryTable.id,
      conversationId: v2MemoryTable.conversationId,
      kind: v2MemoryTable.kind,
      content: v2MemoryTable.content,
      pinned: v2MemoryTable.pinned,
      sourceTurn: v2MemoryTable.sourceTurn,
      createdAt: v2MemoryTable.createdAt,
      subject: v2MemoryTable.subject,
      supersededBy: v2MemoryTable.supersededBy,
    })
    .from(v2MemoryTable)
    .innerJoin(v2ConversationTable, eq(v2ConversationTable.id, v2MemoryTable.conversationId))
    .where(
      and(
        eq(v2ConversationTable.userId, scope.userId),
        eq(v2ConversationTable.characterId, scope.characterId),
        isNull(v2MemoryTable.deletedAt),
      ),
    )
    .orderBy(desc(v2MemoryTable.createdAt))
    .limit(200);
  return rows.map(toRow);
};

// 記憶1件がこの所有者・キャラの会話に属するか。無ければ null。
// 論理削除済みは返さん — 削除・直し・固定の対象から外す（二重削除の 404 にもなる）。
export const loadOwnedMemory = async (
  db: V2Db,
  scope: MemoryScope,
  memoryId: string,
): Promise<(MemoryRow & { embedding: Uint8Array | Buffer | null }) | null> => {
  const [row] = await db
    .select({
      id: v2MemoryTable.id,
      conversationId: v2MemoryTable.conversationId,
      kind: v2MemoryTable.kind,
      content: v2MemoryTable.content,
      pinned: v2MemoryTable.pinned,
      sourceTurn: v2MemoryTable.sourceTurn,
      createdAt: v2MemoryTable.createdAt,
      subject: v2MemoryTable.subject,
      supersededBy: v2MemoryTable.supersededBy,
      embedding: v2MemoryTable.embedding,
    })
    .from(v2MemoryTable)
    .innerJoin(v2ConversationTable, eq(v2ConversationTable.id, v2MemoryTable.conversationId))
    .where(
      and(
        eq(v2MemoryTable.id, memoryId),
        eq(v2ConversationTable.userId, scope.userId),
        eq(v2ConversationTable.characterId, scope.characterId),
        isNull(v2MemoryTable.deletedAt),
      ),
    )
    .limit(1);
  return row ? { ...toRow(row), embedding: row.embedding } : null;
};

// 復元専用の読み込み: 論理削除済みの行だけを拾う（deleted_at の残り窓は呼び出し側が判定）。
export const loadOwnedDeletedMemory = async (
  db: V2Db,
  scope: MemoryScope,
  memoryId: string,
): Promise<(MemoryRow & { deletedAt: number }) | null> => {
  const [row] = await db
    .select({
      id: v2MemoryTable.id,
      conversationId: v2MemoryTable.conversationId,
      kind: v2MemoryTable.kind,
      content: v2MemoryTable.content,
      pinned: v2MemoryTable.pinned,
      sourceTurn: v2MemoryTable.sourceTurn,
      createdAt: v2MemoryTable.createdAt,
      subject: v2MemoryTable.subject,
      supersededBy: v2MemoryTable.supersededBy,
      deletedAt: v2MemoryTable.deletedAt,
    })
    .from(v2MemoryTable)
    .innerJoin(v2ConversationTable, eq(v2ConversationTable.id, v2MemoryTable.conversationId))
    .where(
      and(
        eq(v2MemoryTable.id, memoryId),
        eq(v2ConversationTable.userId, scope.userId),
        eq(v2ConversationTable.characterId, scope.characterId),
        isNotNull(v2MemoryTable.deletedAt),
      ),
    )
    .limit(1);
  if (!row || row.deletedAt === null) return null;
  return { ...toRow(row), deletedAt: row.deletedAt };
};

// 内容の書き換え。embedding は内容と対応しないので必ず null に戻す（再埋め込みは API 層）。
// 旧内容は tombstone へ入れる — 直したはずの記憶が抽出の再実行で蘇らんため（RIT-94）。
// 要約も伏せ直し待ちにする: 旧本文があらすじに残っとる可能性がある（削除の③と同じ）。
// 戻り値は更新前の content（旧 vectorId の算出に必要）と会話 id（Queue 送信に必要）。
export const updateMemoryContent = async (
  db: V2Db,
  scope: MemoryScope,
  memoryId: string,
  content: string,
): Promise<{ previous: string; conversationId: string } | null> => {
  const owned = await loadOwnedMemory(db, scope, memoryId);
  if (!owned) return null;
  const previous = owned.content;
  await db.batch([
    db
      .update(v2MemoryTable)
      .set({ content, embedding: null, revision: sql`${v2MemoryTable.revision} + 1` })
      .where(eq(v2MemoryTable.id, memoryId)),
    db
      .insert(v2MemoryTombstoneTable)
      .values({
        conversationId: owned.conversationId,
        contentHash: await hashMemorySource(previous),
        content: previous,
        createdAt: Date.now(),
      })
      .onConflictDoUpdate({
        target: [v2MemoryTombstoneTable.conversationId, v2MemoryTombstoneTable.contentHash],
        set: { content: previous },
      }),
    db
      .update(v2SummaryTable)
      .set({ redactPending: 1 })
      .where(eq(v2SummaryTable.conversationId, owned.conversationId)),
  ]);
  return { previous, conversationId: owned.conversationId };
};

// 固定/解除。固定した記憶は類似度に負けず指示文へ入る（loadPinnedMemories）。
export const setMemoryPinned = async (
  db: V2Db,
  scope: MemoryScope,
  memoryId: string,
  pinned: boolean,
): Promise<boolean> => {
  const owned = await loadOwnedMemory(db, scope, memoryId);
  if (!owned) return false;
  await db
    .update(v2MemoryTable)
    .set({ pinned: pinned ? 1 : 0 })
    .where(eq(v2MemoryTable.id, memoryId));
  return true;
};

// 手直し後の埋め込みを書き戻す。content が変わっていたら書かん（同時編集の古い勝者対策）。
export const storeEditedEmbedding = async (
  db: V2Db,
  memoryId: string,
  content: string,
  vector: number[],
): Promise<void> => {
  const embedding = new Uint8Array(new Float32Array(vector).buffer);
  await db
    .update(v2MemoryTable)
    .set({ embedding: sql<Buffer>`${embedding}` })
    .where(and(eq(v2MemoryTable.id, memoryId), eq(v2MemoryTable.content, content)));
};

// 記憶の論理削除（RIT-94）。3か所から消すための D1 側の仕事を 1 バッチで:
//   1) 本体行に deleted_at + revision 繰り上げ（物理削除は復元窓の経過後、removeMemories）
//   2) tombstone — 本文つきで。抽出の再実行で蘇らせない＋伏せ直しの「書かない事柄」
//   3) その会話の v2_summary を全て伏せ直し待ち（redact_pending = 1）
//   4) 旧データの kind = 'summary' の記憶行（現状の掃討条件そのまま）にも deleted_at
// 戻り値は論理削除された全行（vector 側の除去は呼び出し側が担う）と会話 id・deleted_at。
export const deleteMemory = async (
  db: V2Db,
  scope: MemoryScope,
  memoryId: string,
  now = Date.now(),
): Promise<{
  conversationId: string;
  deletedAt: number;
  rows: { id: string; content: string }[];
} | null> => {
  const owned = await loadOwnedMemory(db, scope, memoryId);
  if (!owned) return null;
  // 消す対象より後の要約はその事実を含みうる。sourceTurn が無い記憶は時点不明なので全要約を消す。
  const swept = await db
    .select({ id: v2MemoryTable.id, content: v2MemoryTable.content })
    .from(v2MemoryTable)
    .where(
      and(
        eq(v2MemoryTable.conversationId, owned.conversationId),
        eq(v2MemoryTable.kind, "summary"),
        isNull(v2MemoryTable.deletedAt),
        owned.sourceTurn === null ? undefined : gte(v2MemoryTable.sourceTurn, owned.sourceTurn),
      ),
    );
  const ids = [memoryId, ...swept.map((row) => row.id)];
  await db.batch([
    db
      .update(v2MemoryTable)
      .set({ deletedAt: now, revision: sql`${v2MemoryTable.revision} + 1` })
      .where(and(inArray(v2MemoryTable.id, ids), isNull(v2MemoryTable.deletedAt))),
    db
      .insert(v2MemoryTombstoneTable)
      .values({
        conversationId: owned.conversationId,
        contentHash: await hashMemorySource(owned.content),
        content: owned.content,
        createdAt: now,
      })
      .onConflictDoUpdate({
        target: [v2MemoryTombstoneTable.conversationId, v2MemoryTombstoneTable.contentHash],
        set: { content: owned.content },
      }),
    db
      .update(v2SummaryTable)
      .set({ redactPending: 1 })
      .where(eq(v2SummaryTable.conversationId, owned.conversationId)),
  ]);
  return {
    conversationId: owned.conversationId,
    deletedAt: now,
    rows: [{ id: owned.id, content: owned.content }, ...swept],
  };
};

// 復元（RIT-94）。削除から MEMORY_RESTORE_WINDOW_MS 以内なら deleted_at を外し、
// その本文の tombstone を消す（手で足し直したのと同じ扱い）。伏せ直した要約は戻さん。
// "expired" = 行は残っとるが窓切れ（呼び出し側が物理削除して 410 を返す）。
export const restoreMemory = async (
  db: V2Db,
  scope: MemoryScope,
  memoryId: string,
  now = Date.now(),
): Promise<MemoryRow | "expired" | null> => {
  const deleted = await loadOwnedDeletedMemory(db, scope, memoryId);
  if (!deleted) return null;
  if (now - deleted.deletedAt > MEMORY_RESTORE_WINDOW_MS) return "expired";
  const contentHash = await hashMemorySource(deleted.content);
  await db.batch([
    db
      .update(v2MemoryTable)
      .set({ deletedAt: null, revision: sql`${v2MemoryTable.revision} + 1` })
      .where(and(eq(v2MemoryTable.id, memoryId), isNotNull(v2MemoryTable.deletedAt))),
    db
      .delete(v2MemoryTombstoneTable)
      .where(
        and(
          eq(v2MemoryTombstoneTable.conversationId, deleted.conversationId),
          eq(v2MemoryTombstoneTable.contentHash, contentHash),
        ),
      ),
  ]);
  return deleted;
};

// 復元窓を過ぎた論理削除行を拾う。物理削除は呼び出し側（removeMemories）が行う。
// filter は会話単位か、キャラ＋所有者（記憶 API はキャラ単位なので全会話を掃く）。
export const loadExpiredMemories = async (
  db: V2Db,
  filter: { conversationId: string } | MemoryScope,
  olderThan: number,
): Promise<{ id: string; content: string; conversationId: string }[]> => {
  if ("conversationId" in filter) {
    return db
      .select({
        id: v2MemoryTable.id,
        content: v2MemoryTable.content,
        conversationId: v2MemoryTable.conversationId,
      })
      .from(v2MemoryTable)
      .where(
        and(
          eq(v2MemoryTable.conversationId, filter.conversationId),
          isNotNull(v2MemoryTable.deletedAt),
          lt(v2MemoryTable.deletedAt, olderThan),
        ),
      );
  }
  return db
    .select({
      id: v2MemoryTable.id,
      content: v2MemoryTable.content,
      conversationId: v2MemoryTable.conversationId,
    })
    .from(v2MemoryTable)
    .innerJoin(v2ConversationTable, eq(v2ConversationTable.id, v2MemoryTable.conversationId))
    .where(
      and(
        eq(v2ConversationTable.userId, filter.userId),
        eq(v2ConversationTable.characterId, filter.characterId),
        isNotNull(v2MemoryTable.deletedAt),
        lt(v2MemoryTable.deletedAt, olderThan),
      ),
    );
};

// 物理削除。source は FK cascade 宣言があるが D1 の foreign_keys 既定では効かん
// 可能性があるので明示削除する（memory-reset.ts と同じ順）。
export const removeMemories = async (db: V2Db, ids: string[]): Promise<void> => {
  if (ids.length === 0) return;
  await db.batch([
    db.delete(v2MemorySourceTable).where(inArray(v2MemorySourceTable.memoryId, ids)),
    db.delete(v2MemoryTable).where(inArray(v2MemoryTable.id, ids)),
  ]);
};

// そのキャラとの直近会話。手で足す時の紐付け先の既定値。無ければ null。
export const findLatestConversationId = async (
  db: V2Db,
  scope: MemoryScope,
): Promise<string | null> => {
  const [row] = await db
    .select({ id: v2ConversationTable.id })
    .from(v2ConversationTable)
    .where(
      and(
        eq(v2ConversationTable.userId, scope.userId),
        eq(v2ConversationTable.characterId, scope.characterId),
      ),
    )
    .orderBy(desc(v2ConversationTable.updatedAt))
    .limit(1);
  return row?.id ?? null;
};

// 手で足す: 会話の最新ユーザー発言を出どころに据える（source は FK で実メッセージ必須）。
// 手で植えた事実は「必ず出したい」意図なので pinned=1 が既定。会話に発言が無い時は null。
export const insertManualMemory = async (
  db: V2Db,
  scope: MemoryScope & { conversationId: string },
  input: {
    content: string;
    kind: "fact" | "preference";
    pinned?: boolean;
  },
): Promise<MemoryRow | null> => {
  const [conversation] = await db
    .select({ id: v2ConversationTable.id })
    .from(v2ConversationTable)
    .where(
      and(
        eq(v2ConversationTable.id, scope.conversationId),
        eq(v2ConversationTable.userId, scope.userId),
        eq(v2ConversationTable.characterId, scope.characterId),
      ),
    )
    .limit(1);
  if (!conversation) throw new MemoryAccessError();

  const [source] = await db
    .select({
      id: v2MessageTable.id,
      turn: v2MessageTable.turn,
      content: v2MessageTable.content,
    })
    .from(v2MessageTable)
    .where(
      and(eq(v2MessageTable.conversationId, scope.conversationId), eq(v2MessageTable.role, "user")),
    )
    .orderBy(desc(v2MessageTable.turn), desc(v2MessageTable.createdAt))
    .limit(1);
  if (!source) return null;

  const id = crypto.randomUUID();
  const now = Date.now();
  const sourceContentHash = await hashMemorySource(source.content);
  const contentHash = await hashMemorySource(input.content);
  await db.batch([
    // 以前に手で消した同じ内容を明示的に足し直す場合は帳から外す（RIT-94）
    db
      .delete(v2MemoryTombstoneTable)
      .where(
        and(
          eq(v2MemoryTombstoneTable.conversationId, scope.conversationId),
          eq(v2MemoryTombstoneTable.contentHash, contentHash),
        ),
      ),
    db.insert(v2MemoryTable).values({
      id,
      conversationId: scope.conversationId,
      kind: input.kind,
      content: input.content,
      pinned: input.pinned === false ? 0 : 1,
      sourceTurn: source.turn,
      createdAt: now,
    }),
    db.insert(v2MemorySourceTable).values({
      memoryId: id,
      sourceMessageId: source.id,
      sourceContentHash,
      importance: 1,
    }),
  ]);
  return {
    id,
    conversationId: scope.conversationId,
    kind: input.kind,
    content: input.content,
    pinned: input.pinned !== false,
    sourceTurn: source.turn,
    createdAt: now,
    // 手で足した記憶に主題は付けん — 抽出の置き換え印の対象外にするため
    subject: "",
    supersededBy: null,
  };
};

// 固定済みの記憶を vector 検索を通らずに返す（類似度に負けないための経路）。
// kind は fact/preference に限る（retrieveMemories のフィルタと同じ）。
export const loadPinnedMemories = async (
  db: V2Db,
  scope: MemoryScope & { conversationId: string },
): Promise<MemoryRow[]> => {
  const rows = await db
    .select({
      id: v2MemoryTable.id,
      conversationId: v2MemoryTable.conversationId,
      kind: v2MemoryTable.kind,
      content: v2MemoryTable.content,
      pinned: v2MemoryTable.pinned,
      sourceTurn: v2MemoryTable.sourceTurn,
      createdAt: v2MemoryTable.createdAt,
      subject: v2MemoryTable.subject,
      supersededBy: v2MemoryTable.supersededBy,
    })
    .from(v2MemoryTable)
    .innerJoin(v2ConversationTable, eq(v2ConversationTable.id, v2MemoryTable.conversationId))
    .where(
      and(
        eq(v2MemoryTable.conversationId, scope.conversationId),
        eq(v2ConversationTable.userId, scope.userId),
        eq(v2ConversationTable.characterId, scope.characterId),
        eq(v2MemoryTable.pinned, 1),
        isNull(v2MemoryTable.deletedAt),
        // 置き換わった記憶は固定されとっても出さん（RIT-86 の食い違いは新しい方が勝つ）
        isNull(v2MemoryTable.supersededBy),
      ),
    )
    .orderBy(desc(v2MemoryTable.createdAt))
    .limit(20);
  return rows.filter((row) => row.kind === "fact" || row.kind === "preference").map(toRow);
};
