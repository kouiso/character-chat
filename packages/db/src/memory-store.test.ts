import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { characterTable } from "../../../src/schema/character";

import { memoryRecordSchema } from "./memory-contract";
import {
  addMemory,
  changeMemory,
  listMemories,
  MemoryConflictError,
  readManualMemories,
  removeMemory,
  type MemoryScope,
} from "./memory-store";
import { openLocalD1, type LocalD1 } from "./test/local-d1";
import { ConversationAccessError } from "./turn-store";
import { v2ConversationTable, v2MemoryTable } from "./v2-schema";

describe("会話の記憶", () => {
  let local: LocalD1;
  let scope: MemoryScope;
  const conversationIds = [crypto.randomUUID(), crypto.randomUUID()];
  const input = (content = "集合場所は図書館") => ({
    id: crypto.randomUUID(),
    content,
    kind: "fact" as const,
    pinned: false,
  });

  beforeAll(async () => {
    local = await openLocalD1();
    const [character] = await local.db
      .select({ id: characterTable.id })
      .from(characterTable)
      .limit(1);
    if (!character) throw new Error("ローカルの最小seedが必要です");
    scope = {
      characterId: character.id,
      userId: "memory-test",
      conversationId: conversationIds[0],
    };
    await local.db.insert(v2ConversationTable).values(
      conversationIds.map((id) => ({
        id,
        userId: scope.userId,
        characterId: scope.characterId,
        threadId: id,
        promptVersion: "v0001",
        createdAt: 1,
        updatedAt: 1,
      })),
    );
  });
  afterAll(async () => {
    if (!local) return;
    await local.db
      .delete(v2MemoryTable)
      .where(inArray(v2MemoryTable.conversationId, conversationIds));
    await local.db
      .delete(v2ConversationTable)
      .where(inArray(v2ConversationTable.id, conversationIds));
    await local.dispose();
  });

  it("追加再試行は重複せず、編集はrevisionを進め古いembeddingを破棄する", async () => {
    const value = input();
    const first = await addMemory(local.db, scope, value);
    expect(await addMemory(local.db, scope, value)).toEqual(first);
    await local.db.run(sql`UPDATE v2_memory SET embedding = X'0102' WHERE id = ${first.id}`);
    const changed = await changeMemory(local.db, scope, {
      ...first,
      content: "集合は駅前",
      pinned: true,
    });
    expect(changed).toMatchObject({ revision: 1, content: "集合は駅前", pinned: true });
    const [row] = await local.db.select().from(v2MemoryTable).where(eq(v2MemoryTable.id, first.id));
    expect(row.embedding).toBeNull();
    expect((await readManualMemories(local.db, scope))[0]?.content).toBe("集合は駅前");
    await removeMemory(local.db, scope, changed);
    expect(await readManualMemories(local.db, scope)).not.toContainEqual(
      expect.objectContaining({ content: "集合は駅前" }),
    );
  });

  it("二つの画面の同じrevisionからの保存は一方だけ成功し、古い削除を拒否する", async () => {
    const original = await addMemory(local.db, scope, input());
    const outcomes = await Promise.allSettled([
      changeMemory(local.db, scope, { ...original, content: "第一画面" }),
      changeMemory(local.db, scope, { ...original, content: "第二画面" }),
    ]);
    expect(outcomes.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((item) => item.status === "rejected")).toHaveLength(1);
    await expect(removeMemory(local.db, scope, original)).rejects.toBeInstanceOf(
      MemoryConflictError,
    );
    const current = (await listMemories(local.db, scope)).find((row) => row.id === original.id);
    expect(current?.revision).toBe(1);
  });

  it("別利用者・別キャラ・別会話の記憶を読まず書き換えない", async () => {
    const memory = await addMemory(local.db, scope, input("非共有の予定"));
    for (const wrong of [
      { ...scope, userId: "someone-else" },
      { ...scope, characterId: "another-character" },
    ]) {
      await expect(listMemories(local.db, wrong)).rejects.toBeInstanceOf(ConversationAccessError);
      await expect(
        changeMemory(local.db, wrong, { ...memory, content: "上書き" }),
      ).rejects.toBeInstanceOf(ConversationAccessError);
      expect(await readManualMemories(local.db, wrong)).toEqual([]);
    }
    const another = { ...scope, conversationId: conversationIds[1] };
    expect(await listMemories(local.db, another)).toEqual([]);
    await expect(changeMemory(local.db, another, memory)).rejects.toBeInstanceOf(
      MemoryConflictError,
    );
    await expect(removeMemory(local.db, another, memory)).rejects.toBeInstanceOf(
      MemoryConflictError,
    );
    expect(
      await readManualMemories(local.db, { ...scope, conversationId: "not-saved-yet" }),
    ).toEqual([]);
  });

  it("空と長過ぎる新規入力を拒否し、既存の長文は一覧で読める", async () => {
    for (const content of ["", " \n ", "長".repeat(1_001)]) {
      await expect(addMemory(local.db, scope, input(content))).rejects.toThrow();
    }
    const legacy = {
      ...input("長".repeat(2_000)),
      conversationId: scope.conversationId,
      createdAt: 1,
    };
    await local.db.insert(v2MemoryTable).values(legacy);
    const row = (await listMemories(local.db, scope)).find((memory) => memory.id === legacy.id);
    expect(memoryRecordSchema.safeParse(row).success).toBe(true);
  });
});
