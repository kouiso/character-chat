// RIT-77 台帳まわりの単体試験。札の作り方・内容ハッシュ・台帳の読み書き・移行元一覧。
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { characterTable } from "../../../src/schema/character";
import { conversationTable } from "../../../src/schema/conversation";
import { messageTable } from "../../../src/schema/message";
import { userTable } from "../../../src/schema/user";

import {
  legacyConversationHash,
  legacyMessageHash,
  legacyOwnerLabel,
  listLegacyConversationUserIds,
  listLegacyImportRows,
  listLegacySources,
  resolveLegacySourceOwner,
} from "./legacy-import-store";
import { hashMemorySource } from "./memory-extraction-store";
import { openLocalD1, type LocalD1 } from "./test/local-d1";
import { v2ConversationTable, v2LegacyImportTable } from "./v2-schema";

describe("legacy import store", () => {
  let local: LocalD1;
  let characterId: string;
  const owner = `import-store-${crypto.randomUUID()}`;
  const other = `import-store-${crypto.randomUUID()}`;
  const conversationId = `${owner}-conv`;

  beforeAll(async () => {
    local = await openLocalD1();
    const [character] = await local.db
      .select({ id: characterTable.id })
      .from(characterTable)
      .limit(1);
    characterId = character.id;
    for (const [userId, count] of [
      [owner, 2],
      [other, 1],
    ] as const) {
      await local.db
        .insert(userTable)
        .values({ id: userId, email: `${userId}@example.invalid`, createdAt: 1 });
      for (let index = 0; index < count; index += 1) {
        const id = `${userId}-c${index}`;
        await local.db.insert(conversationTable).values({
          id,
          userId,
          characterId,
          title: "t",
          createdAt: 1,
          updatedAt: 1,
        });
        await local.db.insert(messageTable).values({
          id: `${id}-m`,
          conversationId: id,
          userId,
          characterId,
          role: "user",
          content: "x",
          createdAt: 1,
        });
      }
    }
  });
  afterAll(async () => {
    await local.db
      .delete(v2LegacyImportTable)
      .where(inArray(v2LegacyImportTable.sourceUserId, [owner, other]));
    await local.db.delete(messageTable).where(inArray(messageTable.userId, [owner, other]));
    await local.db
      .delete(conversationTable)
      .where(inArray(conversationTable.userId, [owner, other]));
    await local.db
      .delete(v2ConversationTable)
      .where(inArray(v2ConversationTable.legacySourceUserId, [owner, other]));
    await local.db.delete(userTable).where(inArray(userTable.id, [owner, other]));
    await local.dispose();
  });

  it("札は local をそのまま、ほかは owner-<SHA-256 の先頭 8 桁>", async () => {
    expect(await legacyOwnerLabel("local")).toBe("local");
    const label = await legacyOwnerLabel(owner);
    const expected = `owner-${(await hashMemorySource(owner)).slice(0, 8)}`;
    expect(label).toBe(expected);
    expect(label).toMatch(/^owner-[0-9a-f]{8}$/);
    expect(label).not.toContain(owner);
  });

  it("内容ハッシュは [character_id, created_at] / [role, created_at, content] の SHA-256", async () => {
    const conv = { characterId: "char-1", createdAt: 42 };
    expect(await legacyConversationHash(conv)).toBe(
      await hashMemorySource(JSON.stringify(["char-1", 42])),
    );
    const message = { role: "user", createdAt: 7, content: "hello" };
    expect(await legacyMessageHash(message)).toBe(
      await hashMemorySource(JSON.stringify(["user", 7, "hello"])),
    );
  });

  it("台帳の行を会話ごとに読める", async () => {
    await local.db.insert(v2LegacyImportTable).values([
      {
        legacyTable: "conversation",
        legacyId: conversationId,
        v2Id: conversationId,
        conversationId,
        sourceUserId: owner,
        targetUserId: "local",
        contentHash: "h0",
        importedAt: 1,
      },
      {
        legacyTable: "message",
        legacyId: `${conversationId}-m`,
        v2Id: `${conversationId}-m`,
        conversationId,
        sourceUserId: owner,
        targetUserId: "local",
        contentHash: "h1",
        importedAt: 1,
      },
    ]);
    const rows = await listLegacyImportRows(local.db, conversationId);
    expect(rows.map((row) => row.legacyTable)).toEqual(["conversation", "message"]);
    // 別の会話の行は混ざらん。
    const none = await listLegacyImportRows(local.db, "no-such-conversation");
    expect(none).toEqual([]);
  });

  it("台帳の主キー (legacy_table, legacy_id) の重複は弾く", async () => {
    await expect(
      local.db.insert(v2LegacyImportTable).values({
        legacyTable: "conversation",
        legacyId: conversationId,
        v2Id: "x",
        conversationId: "x",
        sourceUserId: owner,
        targetUserId: "local",
        contentHash: "h9",
        importedAt: 2,
      }),
    ).rejects.toThrow();
  });

  it("利用者 ID の一覧と札→ID の引き当て", async () => {
    const userIds = await listLegacyConversationUserIds(local.db);
    expect(userIds).toContain(owner);
    expect(userIds).toContain(other);
    const label = await legacyOwnerLabel(owner);
    expect(await resolveLegacySourceOwner(local.db, label)).toBe(owner);
    expect(await resolveLegacySourceOwner(local.db, "owner-ffffffff")).toBeNull();
    // `local` は user_id='local' の旧会話がある時だけ引き当たる（無ければ null）。
    const localHit = await resolveLegacySourceOwner(local.db, "local");
    expect(localHit === null || localHit === "local").toBe(true);
  });

  it("sources 一覧は利用者ごとの旧会話・旧発言・移行済み件数を数える", async () => {
    // owner の 1 会話を「移行済み」にする（v2 側 + 台帳）。
    const migrated = `${owner}-c0`;
    await local.db.insert(v2ConversationTable).values({
      id: migrated,
      userId: "local",
      legacySourceUserId: owner,
      characterId,
      threadId: migrated,
      promptVersion: "legacy-import-v1",
      createdAt: 1,
      updatedAt: 1,
    });
    const sources = await listLegacySources(local.db);
    const row = sources.find((entry) => entry.sourceUserId === owner);
    expect(row).toMatchObject({ conversations: 2, messages: 2, importedConversations: 1 });
    const otherRow = sources.find((entry) => entry.sourceUserId === other);
    expect(otherRow).toMatchObject({ conversations: 1, importedConversations: 0 });
  });
});
