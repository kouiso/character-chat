import { and, asc, desc, eq, inArray } from "drizzle-orm";

import {
  v2GroupMemberTable,
  v2GroupMemoryTable,
  v2GroupMessageTable,
  v2GroupTable,
} from "./v2-schema";

import type { V2Db } from "./client";

export type GroupMember = { characterId: string; position: number };
export type GroupMessage = {
  turn: number;
  speakerCharacterId: string | null;
  content: string;
  voiceMismatch: number | null;
  provider?: string | null;
};

export const createGroup = async (
  db: V2Db,
  input: { userId: string; title: string; promptVersion: string; now: number },
): Promise<string> => {
  const id = crypto.randomUUID();
  await db.insert(v2GroupTable).values({
    id,
    userId: input.userId,
    title: input.title,
    promptVersion: input.promptVersion,
    createdAt: input.now,
    updatedAt: input.now,
  });
  return id;
};

export const addGroupMember = async (
  db: V2Db,
  input: { groupId: string; characterId: string; position: number; now: number },
): Promise<void> => {
  await db.insert(v2GroupMemberTable).values({
    id: crypto.randomUUID(),
    groupId: input.groupId,
    characterId: input.characterId,
    position: input.position,
    createdAt: input.now,
  });
};

export type GroupRow = { id: string; title: string; createdAt: number; memberIds: string[] };

// ユーザーの場一覧（新しい順）。メンバーIDをまとめて返し、名前解決は呼び出し側で行う。
export const listGroups = async (db: V2Db, userId: string): Promise<GroupRow[]> => {
  const groups = await db
    .select({ id: v2GroupTable.id, title: v2GroupTable.title, createdAt: v2GroupTable.createdAt })
    .from(v2GroupTable)
    .where(eq(v2GroupTable.userId, userId))
    .orderBy(desc(v2GroupTable.createdAt));
  if (groups.length === 0) return [];
  const members = await db
    .select({ groupId: v2GroupMemberTable.groupId, characterId: v2GroupMemberTable.characterId })
    .from(v2GroupMemberTable)
    .where(inArray(v2GroupMemberTable.groupId, groups.map((g) => g.id)))
    .orderBy(asc(v2GroupMemberTable.position));
  const byGroup = new Map<string, string[]>();
  for (const m of members) {
    byGroup.set(m.groupId, [...(byGroup.get(m.groupId) ?? []), m.characterId]);
  }
  return groups.map((g) => ({ ...g, memberIds: byGroup.get(g.id) ?? [] }));
};

export const listGroupMembers = async (db: V2Db, groupId: string): Promise<GroupMember[]> =>
  db
    .select({ characterId: v2GroupMemberTable.characterId, position: v2GroupMemberTable.position })
    .from(v2GroupMemberTable)
    .where(eq(v2GroupMemberTable.groupId, groupId))
    .orderBy(asc(v2GroupMemberTable.position));

export const saveGroupMessage = async (
  db: V2Db,
  input: {
    groupId: string;
    speakerCharacterId: string | null;
    content: string;
    voiceMismatch?: number;
    generationId?: string;
    provider?: string | null;
    now: number;
  },
): Promise<{ turn: number; id: string }> => {
  const rows = await db
    .select({ turn: v2GroupMessageTable.turn })
    .from(v2GroupMessageTable)
    .where(eq(v2GroupMessageTable.groupId, input.groupId))
    .orderBy(asc(v2GroupMessageTable.turn));
  const turn = (rows[rows.length - 1]?.turn ?? 0) + 1;
  const id = crypto.randomUUID();
  await db.insert(v2GroupMessageTable).values({
    id,
    groupId: input.groupId,
    turn,
    speakerCharacterId: input.speakerCharacterId,
    content: input.content,
    voiceMismatch: input.voiceMismatch ?? null,
    generationId: input.generationId ?? null,
    provider: input.provider ?? null,
    createdAt: input.now,
  });
  return { turn, id };
};

// 即時 lookup で引けんかった実行先を後から書き戻す（RIT-100 の遅延解決）。
export const updateGroupMessageProvider = async (
  db: V2Db,
  id: string,
  provider: string,
): Promise<void> => {
  await db.update(v2GroupMessageTable).set({ provider }).where(eq(v2GroupMessageTable.id, id));
};

export const listGroupHistory = async (
  db: V2Db,
  groupId: string,
  limit?: number,
): Promise<GroupMessage[]> => {
  const rows = await db
    .select({
      turn: v2GroupMessageTable.turn,
      speakerCharacterId: v2GroupMessageTable.speakerCharacterId,
      content: v2GroupMessageTable.content,
      voiceMismatch: v2GroupMessageTable.voiceMismatch,
      provider: v2GroupMessageTable.provider,
    })
    .from(v2GroupMessageTable)
    .where(eq(v2GroupMessageTable.groupId, groupId))
    .orderBy(asc(v2GroupMessageTable.turn));
  return limit === undefined ? rows : rows.slice(-limit);
};

// 場の出来事は場にいた全員の記憶へ同じ文面で入れる（決まりは単純な方が検査しやすい）。
export const rememberGroupEvent = async (
  db: V2Db,
  input: { groupId: string; characterIds: string[]; content: string; now: number },
): Promise<void> => {
  if (input.characterIds.length === 0) return;
  await db.insert(v2GroupMemoryTable).values(
    input.characterIds.map((characterId) => ({
      id: crypto.randomUUID(),
      groupId: input.groupId,
      characterId,
      content: input.content,
      createdAt: input.now,
    })),
  );
};

export const listGroupMemories = async (
  db: V2Db,
  input: { groupId: string; characterId: string; limit?: number },
): Promise<string[]> =>
  (
    await db
      .select({ content: v2GroupMemoryTable.content })
      .from(v2GroupMemoryTable)
      .where(
        and(
          eq(v2GroupMemoryTable.groupId, input.groupId),
          eq(v2GroupMemoryTable.characterId, input.characterId),
        ),
      )
      .orderBy(asc(v2GroupMemoryTable.createdAt))
  )
    .map((row) => row.content)
    .slice(-(input.limit ?? 20));
