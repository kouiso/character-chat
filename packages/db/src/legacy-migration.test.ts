import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { characterTable } from "../../../src/schema/character";
import { conversationTable } from "../../../src/schema/conversation";
import { messageTable } from "../../../src/schema/message";
import { userTable } from "../../../src/schema/user";

import { migrateLegacyConversations } from "./legacy-migration";
import { openLocalD1, type LocalD1 } from "./test/local-d1";
import { createD1TurnStore, readOwnedImageKey, readDisplayHistory } from "./turn-store";
import { v2ConversationTable, v2MessageTable } from "./v2-schema";

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
    });
    expect(await migrateLegacyConversations(local.db, options)).toEqual({
      conversations: 2,
      messages: 8,
      insertedConversations: 0,
      insertedMessages: 0,
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
    expect(display[3].imageKey).toBe("preserved-image.png");
  });

  it("移行後に元の本文が変わったら上書きせず拒否する", async () => {
    await local.db
      .update(messageTable)
      .set({ content: "edited later" })
      .where(eq(messageTable.id, `${ids[0]}-0`));
    await expect(
      migrateLegacyConversations(local.db, { sourceUserId: owner, targetUserId: owner }),
    ).rejects.toThrow("changed");
    const [unchanged] = await local.db
      .select()
      .from(v2MessageTable)
      .where(eq(v2MessageTable.id, `${ids[0]}-0`));
    expect(unchanged.content).toBe("元の発言 0");
  });
});
