// @vitest-environment node
import { characterTable, userTable, v2ConversationTable } from "@v2/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { listOwnerIds, LOCAL_USER_ID, resolveEditorUserId } from "./identity";

import { openLocalD1, type LocalD1 } from "../../../../packages/db/src/test/local-d1";

describe("listOwnerIds / resolveEditorUserId", () => {
  let local: LocalD1;
  const legacyOwner = `legacy-owner-${crypto.randomUUID().slice(0, 8)}`;
  const legacyCharId = `char-legacy-${crypto.randomUUID().slice(0, 8)}`;
  const convId = `conv-${crypto.randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    local = await openLocalD1();
    await local.db.insert(userTable).values({
      id: legacyOwner,
      email: `${legacyOwner}@example.invalid`,
      createdAt: Date.now(),
    });
    await local.db.insert(characterTable).values({
      id: legacyCharId,
      userId: legacyOwner,
      name: "旧名義キャラ",
      systemPrompt: "設定",
      greeting: "こんにちは",
      tags: [],
      createdAt: Date.now(),
    });
    // legacy_source_user_id を持つ移行済み会話が 1 行在れば、その名義は集合に入る。
    await local.db.insert(v2ConversationTable).values({
      id: convId,
      userId: LOCAL_USER_ID,
      legacySourceUserId: legacyOwner,
      characterId: legacyCharId,
      threadId: convId,
      promptVersion: "test",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });

  afterAll(async () => {
    await local.db.delete(v2ConversationTable).where(eq(v2ConversationTable.id, convId));
    await local.db.delete(characterTable).where(eq(characterTable.id, legacyCharId));
    await local.db.delete(userTable).where(eq(userTable.id, legacyOwner));
    await local.dispose();
  });

  it("local と移行元の名義を全部返し、重複は片づける", async () => {
    const owners = await listOwnerIds(local.db);
    expect(owners[0]).toBe(LOCAL_USER_ID);
    expect(owners).toContain(legacyOwner);
    expect(new Set(owners).size).toBe(owners.length);
  });

  it("集合に入る名義のキャラはその名義を返す（旧名義のキャラを本人が直せる）", async () => {
    await expect(resolveEditorUserId(local.db, legacyCharId)).resolves.toBe(legacyOwner);
  });

  it("集合に無い名義のキャラ・無い行は local に倒す", async () => {
    const strangerOwner = `stranger-${crypto.randomUUID().slice(0, 8)}`;
    const strangerCharId = `char-stranger-${crypto.randomUUID().slice(0, 8)}`;
    await local.db.insert(userTable).values({
      id: strangerOwner,
      email: `${strangerOwner}@example.invalid`,
      createdAt: Date.now(),
    });
    await local.db.insert(characterTable).values({
      id: strangerCharId,
      userId: strangerOwner,
      name: "他人のキャラ",
      systemPrompt: "設定",
      greeting: "こんにちは",
      tags: [],
      createdAt: Date.now(),
    });
    try {
      await expect(resolveEditorUserId(local.db, strangerCharId)).resolves.toBe(LOCAL_USER_ID);
      await expect(resolveEditorUserId(local.db, "char-not-exists")).resolves.toBe(LOCAL_USER_ID);
    } finally {
      await local.db.delete(characterTable).where(eq(characterTable.id, strangerCharId));
      await local.db.delete(userTable).where(eq(userTable.id, strangerOwner));
    }
  });
});
