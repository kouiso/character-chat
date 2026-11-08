// 記憶の手直しストア（RIT-92）。見る・直す・消す・固定・手で足す。
// vector index（Vectorize）への反映は env.AI が要るので apps/v2 側の API 層が担う。
// ここは D1 だけを触り、所有権の検証を全操作で行う。
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";

import {
  v2ConversationTable,
  v2MemorySourceTable,
  v2MemoryTable,
  v2MemoryTombstoneTable,
  v2MessageTable,
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
};

export class MemoryAccessError extends Error {
  constructor() {
    super("memory access denied");
  }
}

const toRow = (row: {
  id: string;
  conversationId: string;
  kind: "fact" | "summary" | "preference";
  content: string;
  pinned: number;
  sourceTurn: number | null;
  createdAt: number;
}): MemoryRow => ({ ...row, pinned: row.pinned === 1 });

// キャラごとの記憶一覧（会話を跨ぐ。所有者一致の会話に限る）。
export const listCharacterMemories = async (
  db: V2Db,
  scope: MemoryScope,
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
    })
    .from(v2MemoryTable)
    .innerJoin(
      v2ConversationTable,
      eq(v2ConversationTable.id, v2MemoryTable.conversationId),
    )
    .where(
      and(
        eq(v2ConversationTable.userId, scope.userId),
        eq(v2ConversationTable.characterId, scope.characterId),
      ),
    )
    .orderBy(desc(v2MemoryTable.createdAt))
    .limit(200);
  return rows.map(toRow);
};

// 記憶1件がこの所有者・キャラの会話に属するか。無ければ null。
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
      embedding: v2MemoryTable.embedding,
    })
    .from(v2MemoryTable)
    .innerJoin(
      v2ConversationTable,
      eq(v2ConversationTable.id, v2MemoryTable.conversationId),
    )
    .where(
      and(
        eq(v2MemoryTable.id, memoryId),
        eq(v2ConversationTable.userId, scope.userId),
        eq(v2ConversationTable.characterId, scope.characterId),
      ),
    )
    .limit(1);
  return row ? { ...toRow(row), embedding: row.embedding } : null;
};

// 内容の書き換え。embedding は内容と対応しないので必ず null に戻す（再埋め込みは API 層）。
// 旧内容は tombstone へ入れる — 直したはずの記憶が抽出の再実行で蘇らんため（RIT-94）。
// 戻り値は更新前の content（旧 vectorId の算出に必要）。
export const updateMemoryContent = async (
  db: V2Db,
  scope: MemoryScope,
  memoryId: string,
  content: string,
): Promise<string | null> => {
  const owned = await loadOwnedMemory(db, scope, memoryId);
  if (!owned) return null;
  const previous = owned.content;
  await db.batch([
    db
      .update(v2MemoryTable)
      .set({ content, embedding: null })
      .where(eq(v2MemoryTable.id, memoryId)),
    db
      .insert(v2MemoryTombstoneTable)
      .values({
        conversationId: owned.conversationId,
        contentHash: await hashMemorySource(previous),
        createdAt: Date.now(),
      })
      .onConflictDoNothing(),
  ]);
  return previous;
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

// 記憶の削除（RIT-94）。3か所から消すための D1 側の仕事:
//   1) 本体行（source は FK cascade） 2) tombstone — 抽出の再実行で蘇らせない
//   3) 要約 — その記憶のターン以降に作られた同一会話の summary 記憶は
//      内容を含みうるので一緒に消す（作り直す機構が無い今は掃討が上限）。
// 戻り値は消えた全行（vector 側の除去は呼び出し側が担う）。
export const deleteMemory = async (
  db: V2Db,
  scope: MemoryScope,
  memoryId: string,
): Promise<{ id: string; content: string }[] | null> => {
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
        owned.sourceTurn === null
          ? undefined
          : gte(v2MemoryTable.sourceTurn, owned.sourceTurn),
      ),
    );
  await db.batch([
    db
      .insert(v2MemoryTombstoneTable)
      .values({
        conversationId: owned.conversationId,
        contentHash: await hashMemorySource(owned.content),
        createdAt: Date.now(),
      })
      .onConflictDoNothing(),
    db.delete(v2MemoryTable).where(
      inArray(
        v2MemoryTable.id,
        [memoryId, ...swept.map((row) => row.id)],
      ),
    ),
  ]);
  return [{ id: owned.id, content: owned.content }, ...swept];
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
      and(
        eq(v2MessageTable.conversationId, scope.conversationId),
        eq(v2MessageTable.role, "user"),
      ),
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
    })
    .from(v2MemoryTable)
    .innerJoin(
      v2ConversationTable,
      eq(v2ConversationTable.id, v2MemoryTable.conversationId),
    )
    .where(
      and(
        eq(v2MemoryTable.conversationId, scope.conversationId),
        eq(v2ConversationTable.userId, scope.userId),
        eq(v2ConversationTable.characterId, scope.characterId),
        eq(v2MemoryTable.pinned, 1),
      ),
    )
    .orderBy(desc(v2MemoryTable.createdAt))
    .limit(20);
  return rows
    .filter((row) => row.kind === "fact" || row.kind === "preference")
    .map(toRow);
};
