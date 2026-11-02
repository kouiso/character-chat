import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { characterTable } from "../../../src/schema/character";
import { conversationTable } from "../../../src/schema/conversation";
import { messageTable } from "../../../src/schema/message";
import { userTable } from "../../../src/schema/user";

import { LegacyMigrationError, migrateLegacyConversations } from "./legacy-migration";
import { openLocalD1, type LocalD1 } from "./test/local-d1";
import { createD1TurnStore, readOwnedImageKey, readDisplayHistory } from "./turn-store";
import {
  v2ChunkTable,
  v2ConversationTable,
  v2GenerationTable,
  v2LedgerTable,
  v2MessageTable,
} from "./v2-schema";

const owner = `migration-test-${crypto.randomUUID()}`;
const ids = [0, 1].map((n) => `${owner}-${n}`);

describe("legacy migration", () => {
  let local: LocalD1;
  let characterId: string;
  beforeAll(async () => {
    local = await openLocalD1();
    const [character] = await local.db
      .select({ id: characterTable.id })
      .from(characterTable)
      .limit(1);
    characterId = character.id;
    await local.db
      .insert(userTable)
      .values({ id: owner, email: "test@example.invalid", createdAt: 1 });
    for (const id of ids) {
      await local.db
        .insert(conversationTable)
        .values({ id, userId: owner, characterId, title: "旧会話", createdAt: 1, updatedAt: 4 });
      for (const [index, role] of (
        ["assistant", "user", "assistant", "assistant"] as const
      ).entries()) {
        await local.db.insert(messageTable).values({
          id: `${id}-${index}`,
          conversationId: id,
          userId: owner,
          characterId,
          role,
          content: `元の発言 ${index}`,
          createdAt: index + 1,
          imageKey: index === 3 ? "preserved-image.png" : null,
        });
      }
    }
  });
  afterAll(async () => {
    await local.db.delete(v2MessageTable).where(inArray(v2MessageTable.conversationId, ids));
    await local.db.delete(v2ConversationTable).where(inArray(v2ConversationTable.id, ids));
    await local.db.delete(messageTable).where(inArray(messageTable.conversationId, ids));
    await local.db.delete(conversationTable).where(inArray(conversationTable.id, ids));
    await local.db.delete(userTable).where(eq(userTable.id, owner));
    await local.dispose();
  });

  it("途中で止めて再開・再実行しても重複せず順序と画像参照を保つ", async () => {
    const options = { sourceUserId: owner, targetUserId: owner };
    await expect(
      migrateLegacyConversations(local.db, {
        ...options,
        afterConversation: () => {
          throw new Error("interrupted");
        },
      }),
    ).rejects.toThrow("interrupted");
    const resumed = await migrateLegacyConversations(local.db, options);
    expect(resumed).toEqual({
      conversations: 2,
      messages: 8,
      insertedConversations: 1,
      insertedMessages: 4,
      updatedConversations: 0,
    });
    expect(await migrateLegacyConversations(local.db, options)).toEqual({
      conversations: 2,
      messages: 8,
      insertedConversations: 0,
      insertedMessages: 0,
      updatedConversations: 0,
    });
    const store = createD1TurnStore(local.db, {
      userId: owner,
      characterId,
      promptVersion: "test",
    });
    const loaded = await store.load(ids[0]);
    expect(loaded.turn).toBe(5);
    expect(loaded.history.map((row) => row.role)).toEqual([
      "assistant",
      "user",
      "assistant",
      "assistant",
    ]);
    expect(loaded.history.map((row) => row.content)).toEqual(
      [0, 1, 2, 3].map((n) => `元の発言 ${n}`),
    );
    const [original] = await local.db
      .select()
      .from(messageTable)
      .where(eq(messageTable.id, `${ids[0]}-3`));
    expect(original.imageKey).toBe("preserved-image.png");
    expect(await readOwnedImageKey(local.db, owner, `${ids[0]}-3`)).toBe("preserved-image.png");
    expect(await readOwnedImageKey(local.db, "another-owner", `${ids[0]}-3`)).toBeNull();
    const display = await readDisplayHistory(
      local.db,
      { userId: owner, characterId, promptVersion: "test" },
      ids[0],
    );
    expect(display.turn).toBe(loaded.turn);
    expect(display.history[3].imageKey).toBe("preserved-image.png");
  });

  it("移行後に元の本文が変わったら上書きせず拒否する", async () => {
    await local.db
      .update(messageTable)
      .set({ content: "edited later" })
      .where(eq(messageTable.id, `${ids[0]}-0`));
    await expect(
      migrateLegacyConversations(local.db, { sourceUserId: owner, targetUserId: owner }),
    ).rejects.toThrow("元で変わっている");
    const [unchanged] = await local.db
      .select()
      .from(v2MessageTable)
      .where(eq(v2MessageTable.id, `${ids[0]}-0`));
    expect(unchanged.content).toBe("元の発言 0");
  });
});

describe("legacy migration の再実行で元から消えた発言", () => {
  let local: LocalD1;
  let characterId: string;
  const owners: string[] = [];

  const seed = async (count: number) => {
    const seedOwner = `migration-missing-${crypto.randomUUID()}`;
    owners.push(seedOwner);
    const conversationId = `${seedOwner}-c`;
    await local.db
      .insert(userTable)
      .values({ id: seedOwner, email: "test@example.invalid", createdAt: 1 });
    await local.db.insert(conversationTable).values({
      id: conversationId,
      userId: seedOwner,
      characterId,
      title: "旧会話",
      createdAt: 1,
      updatedAt: 1,
    });
    for (let index = 0; index < count; index += 1) {
      await local.db.insert(messageTable).values({
        id: `${conversationId}-m${index + 1}`,
        conversationId,
        userId: seedOwner,
        characterId,
        role: index % 2 === 0 ? "user" : "assistant",
        content: `発言 ${index + 1}`,
        createdAt: index + 1,
      });
    }
    return {
      seedOwner,
      conversationId,
      options: { sourceUserId: seedOwner, targetUserId: seedOwner },
    };
  };

  const v2Contents = async (conversationId: string) =>
    (
      await local.db
        .select({ content: v2MessageTable.content })
        .from(v2MessageTable)
        .where(eq(v2MessageTable.conversationId, conversationId))
    )
      .map((row) => row.content)
      .sort();

  beforeAll(async () => {
    local = await openLocalD1();
    const [character] = await local.db
      .select({ id: characterTable.id })
      .from(characterTable)
      .limit(1);
    characterId = character.id;
  });
  afterAll(async () => {
    const conversationIds = owners.map((id) => `${id}-c`);
    const messageIds = local.db
      .select({ id: v2MessageTable.id })
      .from(v2MessageTable)
      .where(inArray(v2MessageTable.conversationId, conversationIds));
    await local.db.delete(v2ChunkTable).where(inArray(v2ChunkTable.messageId, messageIds));
    await local.db
      .delete(v2MessageTable)
      .where(inArray(v2MessageTable.conversationId, conversationIds));
    await local.db
      .delete(v2LedgerTable)
      .where(inArray(v2LedgerTable.conversationId, conversationIds));
    await local.db
      .delete(v2GenerationTable)
      .where(inArray(v2GenerationTable.conversationId, conversationIds));
    await local.db
      .delete(v2ConversationTable)
      .where(inArray(v2ConversationTable.id, conversationIds));
    await local.db
      .delete(messageTable)
      .where(inArray(messageTable.conversationId, conversationIds));
    await local.db.delete(conversationTable).where(inArray(conversationTable.id, conversationIds));
    await local.db.delete(userTable).where(inArray(userTable.id, owners));
    await local.dispose();
  });

  it("末尾の発言が元から消えたら成功扱いせず拒否する", async () => {
    const { conversationId, options } = await seed(5);
    await migrateLegacyConversations(local.db, options);
    await local.db.delete(messageTable).where(eq(messageTable.id, `${conversationId}-m5`));
    await expect(migrateLegacyConversations(local.db, options)).rejects.toThrow("元から消えている");
    expect(await v2Contents(conversationId)).toEqual([1, 2, 3, 4, 5].map((n) => `発言 ${n}`));
  });

  it("旧会話ごとの削除を検出し、残る会話は移行し、別の移行元は混同しない", async () => {
    const removed = await seed(2);
    const remaining = await seed(1);
    const other = await seed(1);
    const targetUserId = `target-${crypto.randomUUID()}`;
    const options = { sourceUserId: removed.seedOwner, targetUserId };
    await migrateLegacyConversations(local.db, options);
    await migrateLegacyConversations(local.db, { sourceUserId: other.seedOwner, targetUserId });
    await local.db
      .delete(messageTable)
      .where(eq(messageTable.conversationId, removed.conversationId));
    await local.db
      .delete(conversationTable)
      .where(eq(conversationTable.id, removed.conversationId));

    for (const dryRun of [true, false]) {
      const failure: unknown = await migrateLegacyConversations(local.db, {
        ...options,
        dryRun,
      }).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(LegacyMigrationError);
      expect((failure as LegacyMigrationError).failures).toEqual([
        {
          conversationId: removed.conversationId,
          reason: expect.stringContaining("元から消えている"),
        },
      ]);
    }
    expect(await v2Contents(removed.conversationId)).toEqual(["発言 1", "発言 2"]);

    await local.db
      .update(conversationTable)
      .set({ userId: removed.seedOwner })
      .where(eq(conversationTable.id, remaining.conversationId));
    await local.db
      .update(messageTable)
      .set({ userId: removed.seedOwner })
      .where(eq(messageTable.conversationId, remaining.conversationId));
    const failure: unknown = await migrateLegacyConversations(local.db, options).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(LegacyMigrationError);
    expect((failure as LegacyMigrationError).result.insertedConversations).toBe(1);
    expect(await v2Contents(remaining.conversationId)).toEqual(["発言 1"]);
    await expect(
      migrateLegacyConversations(local.db, {
        sourceUserId: other.seedOwner,
        targetUserId,
      }),
    ).resolves.toMatchObject({ insertedConversations: 0 });
  });

  it("移行元の所有者変更を検出し、dryRunでは移行元を補完しない", async () => {
    const originalOwner = await seed(1);
    const newOwner = await seed(1);
    const targetUserId = `target-${crypto.randomUUID()}`;
    const originalOptions = { sourceUserId: originalOwner.seedOwner, targetUserId };
    await migrateLegacyConversations(local.db, originalOptions);
    const [imported] = await local.db
      .select({ legacySourceUserId: v2ConversationTable.legacySourceUserId })
      .from(v2ConversationTable)
      .where(eq(v2ConversationTable.id, originalOwner.conversationId));
    expect(imported.legacySourceUserId).toBe(originalOwner.seedOwner);

    await local.db
      .update(v2ConversationTable)
      .set({ legacySourceUserId: null })
      .where(eq(v2ConversationTable.id, originalOwner.conversationId));
    const dryRun = await migrateLegacyConversations(local.db, {
      ...originalOptions,
      dryRun: true,
    });
    expect(dryRun.updatedConversations).toBe(1);
    const [previewed] = await local.db
      .select({ legacySourceUserId: v2ConversationTable.legacySourceUserId })
      .from(v2ConversationTable)
      .where(eq(v2ConversationTable.id, originalOwner.conversationId));
    expect(previewed.legacySourceUserId).toBeNull();
    await migrateLegacyConversations(local.db, originalOptions);

    await local.db
      .update(conversationTable)
      .set({ userId: newOwner.seedOwner })
      .where(eq(conversationTable.id, originalOwner.conversationId));
    await local.db
      .update(messageTable)
      .set({ userId: newOwner.seedOwner })
      .where(eq(messageTable.conversationId, originalOwner.conversationId));
    const originalFailure: unknown = await migrateLegacyConversations(
      local.db,
      originalOptions,
    ).catch((error: unknown) => error);
    expect(originalFailure).toBeInstanceOf(LegacyMigrationError);
    expect((originalFailure as LegacyMigrationError).failures).toContainEqual({
      conversationId: originalOwner.conversationId,
      reason: expect.stringContaining("元から消えている"),
    });

    const reassigned: unknown = await migrateLegacyConversations(local.db, {
      sourceUserId: newOwner.seedOwner,
      targetUserId,
    }).catch((error: unknown) => error);
    expect(reassigned).toBeInstanceOf(LegacyMigrationError);
    expect((reassigned as LegacyMigrationError).failures).toContainEqual({
      conversationId: originalOwner.conversationId,
      reason: expect.stringContaining("別の利用者"),
    });
  });

  it("旧版で元の利用者を保存していない孤立会話も要確認にする", async () => {
    const { conversationId, options } = await seed(1);
    await migrateLegacyConversations(local.db, options);
    await local.db
      .update(v2ConversationTable)
      .set({ legacySourceUserId: null })
      .where(eq(v2ConversationTable.id, conversationId));
    await local.db.delete(messageTable).where(eq(messageTable.conversationId, conversationId));
    await local.db.delete(conversationTable).where(eq(conversationTable.id, conversationId));
    await expect(
      migrateLegacyConversations(local.db, { ...options, dryRun: true }),
    ).rejects.toThrow("元の利用者も不明");
    expect(await v2Contents(conversationId)).toEqual(["発言 1"]);
  });

  it("元の会話の発言がすべて消えても成功扱いせず拒否する", async () => {
    const { conversationId, options } = await seed(2);
    await migrateLegacyConversations(local.db, options);
    await local.db.delete(messageTable).where(eq(messageTable.conversationId, conversationId));
    await expect(migrateLegacyConversations(local.db, options)).rejects.toThrow("元から消えている");
  });

  // 1 件の要確認で後ろの会話まで止めると、どの会話を見ればよいかも分からんまま全体が進まん。
  it("要確認の会話は飛ばして会話IDと理由を返し、他の会話は移行する", async () => {
    const bad = await seed(2);
    const goodId = `${bad.seedOwner}-d`;
    await local.db.insert(conversationTable).values({
      id: goodId,
      userId: bad.seedOwner,
      characterId,
      title: "旧会話",
      createdAt: 1,
      updatedAt: 1,
    });
    await local.db.insert(messageTable).values({
      id: `${goodId}-m1`,
      conversationId: goodId,
      userId: bad.seedOwner,
      characterId,
      role: "user",
      content: "無事な発言",
      createdAt: 1,
    });
    await local.db.insert(messageTable).values({
      id: `${bad.conversationId}-sys`,
      conversationId: bad.conversationId,
      userId: bad.seedOwner,
      characterId,
      role: "system",
      content: "旧アプリの指示",
      createdAt: 9,
    });

    try {
      const failure = await migrateLegacyConversations(local.db, bad.options).catch(
        (error: unknown) => error,
      );
      expect(failure).toBeInstanceOf(LegacyMigrationError);
      const { failures, result } = failure as LegacyMigrationError;
      expect(failures).toEqual([
        { conversationId: bad.conversationId, reason: expect.stringContaining("system") },
      ]);
      expect((failure as Error).message).toContain(bad.conversationId);
      expect(result).toMatchObject({
        conversations: 2,
        insertedConversations: 1,
        insertedMessages: 1,
      });
      expect(await v2Contents(goodId)).toEqual(["無事な発言"]);
      expect(await v2Contents(bad.conversationId)).toEqual([]);
    } finally {
      await local.db.delete(v2MessageTable).where(eq(v2MessageTable.conversationId, goodId));
      await local.db.delete(v2ConversationTable).where(eq(v2ConversationTable.id, goodId));
      await local.db.delete(messageTable).where(eq(messageTable.conversationId, goodId));
      await local.db.delete(conversationTable).where(eq(conversationTable.id, goodId));
    }
  });

  it("移行後にv2で続けたターンは元に無くても欠落扱いしない", async () => {
    const { seedOwner, conversationId, options } = await seed(3);
    await migrateLegacyConversations(local.db, options);
    const store = createD1TurnStore(local.db, {
      userId: seedOwner,
      characterId,
      promptVersion: "test",
    });
    const { turn } = await store.load(conversationId);
    expect(turn).toBe(4);
    await store.saveTurn({
      conversationId,
      turn,
      userText: "v2での続き",
      events: [],
      ledger: {
        phase: "conversation",
        location: null,
        time: null,
        present: [],
        clothing: {},
        position: null,
        lastEvents: [],
      },
    });
    expect(await migrateLegacyConversations(local.db, options)).toEqual({
      conversations: 1,
      messages: 3,
      insertedConversations: 0,
      insertedMessages: 0,
      updatedConversations: 0,
    });

    await local.db.delete(messageTable).where(eq(messageTable.id, `${conversationId}-m3`));
    await expect(migrateLegacyConversations(local.db, options)).rejects.toThrow("元から消えている");
  });

  it("再実行で元の題名と更新日時の変更を移し、変更が無ければ書かない", async () => {
    const { conversationId, options } = await seed(2);
    await migrateLegacyConversations(local.db, options);
    await local.db
      .update(conversationTable)
      .set({ title: "付け直した題名", updatedAt: 50 })
      .where(eq(conversationTable.id, conversationId));

    expect(await migrateLegacyConversations(local.db, options)).toMatchObject({
      insertedMessages: 0,
      updatedConversations: 1,
    });
    const [row] = await local.db
      .select({ title: v2ConversationTable.title, updatedAt: v2ConversationTable.updatedAt })
      .from(v2ConversationTable)
      .where(eq(v2ConversationTable.id, conversationId));
    expect(row).toEqual({ title: "付け直した題名", updatedAt: 50 });
    expect(await migrateLegacyConversations(local.db, options)).toMatchObject({
      updatedConversations: 0,
    });
  });

  it("確認（dryRun）は本番と同じ照合を通し、何も書かずに件数と要確認の会話を返す", async () => {
    const { conversationId, options } = await seed(2);
    expect(await migrateLegacyConversations(local.db, { ...options, dryRun: true })).toEqual({
      conversations: 1,
      messages: 2,
      insertedConversations: 1,
      insertedMessages: 2,
      updatedConversations: 0,
    });
    expect(await v2Contents(conversationId)).toEqual([]);
    const created = await local.db
      .select({ id: v2ConversationTable.id })
      .from(v2ConversationTable)
      .where(eq(v2ConversationTable.id, conversationId));
    expect(created).toEqual([]);

    await local.db.insert(messageTable).values({
      id: `${conversationId}-system`,
      conversationId,
      userId: options.sourceUserId,
      characterId,
      role: "system",
      content: "旧アプリの指示",
      createdAt: 99,
    });
    await expect(
      migrateLegacyConversations(local.db, { ...options, dryRun: true }),
    ).rejects.toBeInstanceOf(LegacyMigrationError);
    expect(await v2Contents(conversationId)).toEqual([]);
  });
});
