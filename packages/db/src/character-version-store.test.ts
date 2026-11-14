import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { count, eq, inArray } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { characterTable } from "../../../src/schema/character";
import { userTable } from "../../../src/schema/user";

import {
  characterContentSchema,
  composeSystemPrompt,
  storedCharacterContentSchema,
} from "./character-version";
import {
  CharacterConflictError,
  CharacterVersionNotFoundError,
  createCharacterWithVersion,
  deleteCharacterWithVersions,
  ensureCurrentVersion,
  listCharacterVersions,
  loadVersionedCharacter,
  readCharacterDetail,
  readCharacterVersion,
  restoreCharacterVersion,
  updateCharacterWithVersion,
} from "./character-version-store";
import { ensureLocalUser } from "./local-user";
import { FRESH_LOCAL_D1_TIMEOUT_MS, openLocalD1, type LocalD1 } from "./test/local-d1";
import { ensureConversationVersion } from "./turn-store";
import {
  characterRevisionTable,
  characterVersionTable,
  v2ConversationTable,
  v2GenerationTable,
} from "./v2-schema";

const content = (name: string) =>
  characterContentSchema.parse({
    name,
    personality: "穏やかで、好奇心旺盛。",
    speechStyle: "簡潔な日本語で話す。",
    greeting: "こんにちは。",
    privateNotes: "所有者だけが見る演出メモ。",
  });

describe("immutable character version store", () => {
  let local: LocalD1;
  const characterIds: string[] = [];
  const userIds: string[] = [];
  const conversationIds: string[] = [];

  beforeAll(async () => {
    local = await openLocalD1();
    await ensureLocalUser(local.db);
  });

  afterEach(async () => {
    const conversations = conversationIds.splice(0);
    if (conversations.length > 0) {
      await local.db
        .delete(v2GenerationTable)
        .where(inArray(v2GenerationTable.conversationId, conversations));
    }
    for (const id of characterIds.splice(0)) {
      await local.db.batch([
        local.db.delete(v2ConversationTable).where(eq(v2ConversationTable.characterId, id)),
        local.db.delete(characterRevisionTable).where(eq(characterRevisionTable.characterId, id)),
        local.db.delete(characterVersionTable).where(eq(characterVersionTable.characterId, id)),
        local.db.delete(characterTable).where(eq(characterTable.id, id)),
      ]);
    }
    for (const id of userIds.splice(0)) {
      await local.db.delete(userTable).where(eq(userTable.id, id));
    }
  });

  afterAll(async () => {
    await local.dispose();
  });

  const insertLegacyCharacter = async (systemPrompt = "旧設定。") => {
    const id = crypto.randomUUID();
    const userId = crypto.randomUUID();
    characterIds.push(id);
    userIds.push(userId);
    await local.db.insert(userTable).values({
      id: userId,
      email: `${userId}@example.invalid`,
      createdAt: Date.now(),
    });
    await local.db.insert(characterTable).values({
      id,
      userId,
      name: "旧キャラクター",
      systemPrompt,
      greeting: "ようこそ。",
      tags: ["legacy"],
      createdAt: Date.now(),
      revision: 0,
      currentVersionId: null,
    });
    return { id, userId };
  };

  it("creates parent, immutable version, pointer, and history atomically", async () => {
    const result = await createCharacterWithVersion(local.db, "local", content("新規キャラ"));
    characterIds.push(result.id);
    const [parent] = await local.db
      .select({
        userId: characterTable.userId,
        currentVersionId: characterTable.currentVersionId,
        revision: characterTable.revision,
      })
      .from(characterTable)
      .where(eq(characterTable.id, result.id));
    const [version] = await local.db
      .select()
      .from(characterVersionTable)
      .where(eq(characterVersionTable.id, result.versionId));
    const [history] = await local.db
      .select()
      .from(characterRevisionTable)
      .where(eq(characterRevisionTable.characterId, result.id));
    expect(parent).toMatchObject({
      userId: "local",
      currentVersionId: result.versionId,
      revision: 1,
    });
    expect(version?.characterId).toBe(result.id);
    expect(history).toMatchObject({
      revision: 1,
      versionId: result.versionId,
      action: "create",
    });
  });

  it(
    "recreates a missing local owner without overwriting an existing email",
    { timeout: FRESH_LOCAL_D1_TIMEOUT_MS },
    async () => {
      const persistRoot = await mkdtemp(join(tmpdir(), "character-version-store-"));
      let isolated: LocalD1 | undefined;
      try {
        isolated = await openLocalD1({ persistRoot });
        const isolatedDb = isolated.db;
        const [before] = await isolatedDb.select().from(userTable).where(eq(userTable.id, "local"));
        if (before) await isolatedDb.delete(userTable).where(eq(userTable.id, "local"));
        await ensureLocalUser(isolatedDb);
        const [created] = await isolatedDb
          .select()
          .from(userTable)
          .where(eq(userTable.id, "local"));
        expect(created?.email).toBe("local@example.invalid");
        const result = await createCharacterWithVersion(
          isolatedDb,
          "local",
          content("local owner"),
        );

        const [character] = await isolatedDb
          .select({ userId: characterTable.userId })
          .from(characterTable)
          .where(eq(characterTable.id, result.id));
        expect(character?.userId).toBe("local");

        await isolatedDb
          .update(userTable)
          .set({ email: "preserved@example.invalid" })
          .where(eq(userTable.id, "local"));
        await ensureLocalUser(isolatedDb);
        const [preserved] = await isolatedDb
          .select()
          .from(userTable)
          .where(eq(userTable.id, "local"));
        expect(preserved?.email).toBe("preserved@example.invalid");
      } finally {
        try {
          await isolated?.dispose();
        } finally {
          await rm(persistRoot, { recursive: true, force: true });
        }
      }
    },
  );

  it("keeps the in-use result if a conversation disappears after the guarded batch", async () => {
    const created = await createCharacterWithVersion(local.db, "local", content("会話中"));
    characterIds.push(created.id);
    const conversationId = crypto.randomUUID();
    await local.db.insert(v2ConversationTable).values({
      id: conversationId,
      userId: "local",
      characterId: created.id,
      threadId: conversationId,
      promptVersion: "test",
      characterVersionId: created.versionId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const batch = local.db.batch.bind(local.db);
    vi.spyOn(local.db, "batch").mockImplementation(async (statements) => {
      const result = await batch(statements);
      await local.db.delete(v2ConversationTable).where(eq(v2ConversationTable.id, conversationId));
      return result;
    });
    try {
      await expect(
        deleteCharacterWithVersions(local.db, { id: created.id, userId: "local" }),
      ).resolves.toBe("in-use");
    } finally {
      vi.restoreAllMocks();
    }

    const [remaining] = await local.db
      .select({ id: characterTable.id })
      .from(characterTable)
      .where(eq(characterTable.id, created.id));
    expect(remaining).toBeDefined();
  });

  it("rolls the entire create batch back when a later statement fails", async () => {
    const trigger = `fail_revision_${crypto.randomUUID().replaceAll("-", "")}`;
    const before = await local.db.select({ total: count() }).from(characterTable);
    await local.d1
      .prepare(
        `CREATE TRIGGER "${trigger}" BEFORE INSERT ON character_revision
       BEGIN SELECT RAISE(ABORT, 'test transaction rollback'); END`,
      )
      .run();
    try {
      await expect(
        createCharacterWithVersion(local.db, "local", content("rollback")),
      ).rejects.toThrow();
    } finally {
      await local.d1.prepare(`DROP TRIGGER IF EXISTS "${trigger}"`).run();
    }
    const after = await local.db.select({ total: count() }).from(characterTable);
    expect(after[0].total).toBe(before[0].total);
  });

  it("rolls back the new version and character CAS when history insertion fails", async () => {
    const created = await createCharacterWithVersion(local.db, "local", content("変更前"));
    characterIds.push(created.id);
    const trigger = `fail_update_history_${crypto.randomUUID().replaceAll("-", "")}`;
    await local.d1
      .prepare(
        `CREATE TRIGGER "${trigger}" BEFORE INSERT ON character_revision
       WHEN NEW.revision = 2
       BEGIN SELECT RAISE(ABORT, 'test update rollback'); END`,
      )
      .run();
    try {
      await expect(
        updateCharacterWithVersion(local.db, {
          id: created.id,
          userId: "local",
          expectedRevision: 1,
          content: content("変更後"),
        }),
      ).rejects.toThrow();
    } finally {
      await local.d1.prepare(`DROP TRIGGER IF EXISTS "${trigger}"`).run();
    }
    const [parent] = await local.db
      .select({
        revision: characterTable.revision,
        currentVersionId: characterTable.currentVersionId,
      })
      .from(characterTable)
      .where(eq(characterTable.id, created.id));
    const versions = await local.db
      .select({ id: characterVersionTable.id })
      .from(characterVersionTable)
      .where(eq(characterVersionTable.characterId, created.id));
    const history = await local.db
      .select({ revision: characterRevisionTable.revision })
      .from(characterRevisionTable)
      .where(eq(characterRevisionTable.characterId, created.id));
    expect(parent).toMatchObject({ revision: 1, currentVersionId: created.versionId });
    expect(versions.map(({ id }) => id)).toEqual([created.versionId]);
    expect(history.map(({ revision }) => revision)).toEqual([1]);
  });

  it("checks stale revisions before same-content no-op handling", async () => {
    const created = await createCharacterWithVersion(local.db, "local", content("同じ内容"));
    characterIds.push(created.id);
    await expect(
      updateCharacterWithVersion(local.db, {
        id: created.id,
        userId: "local",
        expectedRevision: 0,
        content: content("同じ内容"),
      }),
    ).rejects.toBeInstanceOf(CharacterConflictError);
    await expect(
      updateCharacterWithVersion(local.db, {
        id: created.id,
        userId: "local",
        expectedRevision: 1,
        content: content("同じ内容"),
      }),
    ).resolves.toEqual({ revision: 1, versionId: created.versionId, changed: false });
    const versions = await local.db
      .select({ id: characterVersionTable.id })
      .from(characterVersionTable)
      .where(eq(characterVersionTable.characterId, created.id));
    expect(versions).toHaveLength(1);
  });

  it("allows one concurrent CAS winner without orphaning or deleting versions", async () => {
    const created = await createCharacterWithVersion(local.db, "local", content("初期"));
    characterIds.push(created.id);
    const results = await Promise.allSettled([
      updateCharacterWithVersion(local.db, {
        id: created.id,
        userId: "local",
        expectedRevision: 1,
        content: content("変更A"),
      }),
      updateCharacterWithVersion(local.db, {
        id: created.id,
        userId: "local",
        expectedRevision: 1,
        content: content("変更B"),
      }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const [parent] = await local.db
      .select({
        revision: characterTable.revision,
        currentVersionId: characterTable.currentVersionId,
      })
      .from(characterTable)
      .where(eq(characterTable.id, created.id));
    const versions = await local.db
      .select({ id: characterVersionTable.id })
      .from(characterVersionTable)
      .where(eq(characterVersionTable.characterId, created.id));
    const histories = await local.db
      .select({ versionId: characterRevisionTable.versionId })
      .from(characterRevisionTable)
      .where(eq(characterRevisionTable.characterId, created.id));
    expect(parent.revision).toBe(2);
    expect(versions).toHaveLength(2);
    expect(versions.map(({ id }) => id)).toContain(parent.currentVersionId);
    expect(histories.map(({ versionId }) => versionId)).toContain(parent.currentVersionId);
  });

  it("restores an existing immutable version and records history", async () => {
    const created = await createCharacterWithVersion(local.db, "local", content("初期"));
    characterIds.push(created.id);
    const updated = await updateCharacterWithVersion(local.db, {
      id: created.id,
      userId: "local",
      expectedRevision: 1,
      content: content("変更後"),
    });
    expect(updated?.changed).toBe(true);
    await expect(
      restoreCharacterVersion(local.db, {
        id: created.id,
        userId: "local",
        versionId: created.versionId,
        expectedRevision: 2,
      }),
    ).resolves.toEqual({ revision: 3, versionId: created.versionId });
    await expect(
      restoreCharacterVersion(local.db, {
        id: created.id,
        userId: "local",
        versionId: created.versionId,
        expectedRevision: 3,
      }),
    ).resolves.toEqual({ revision: 3, versionId: created.versionId });
    const listing = await listCharacterVersions(local.db, created.id, "local");
    expect(listing?.versions).toHaveLength(2);
    expect(listing?.currentVersionId).toBe(created.versionId);
    expect(listing?.history.map(({ action }) => action)).toEqual(["restore", "update", "create"]);
  });

  it("returns its own committed pointer when another update wins before the caller resumes", async () => {
    const created = await createCharacterWithVersion(local.db, "local", content("初期"));
    characterIds.push(created.id);
    const originalBatch = local.db.batch.bind(local.db);
    let batchCount = 0;
    let laterVersionId: string | undefined;
    vi.spyOn(local.db, "batch").mockImplementation(async (statements) => {
      const result = await originalBatch(statements);
      batchCount += 1;
      if (batchCount === 2) {
        const laterUpdate = await updateCharacterWithVersion(local.db, {
          id: created.id,
          userId: "local",
          expectedRevision: 2,
          content: content("後続更新"),
        });
        laterVersionId = laterUpdate?.versionId;
      }
      return result;
    });
    try {
      const earlierUpdate = await updateCharacterWithVersion(local.db, {
        id: created.id,
        userId: "local",
        expectedRevision: 1,
        content: content("先行更新"),
      });
      expect(earlierUpdate).toMatchObject({ revision: 2, changed: true });
      expect(earlierUpdate?.versionId).not.toBe(laterVersionId);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("does not accept a stale same-content retry after a concurrent update", async () => {
    const created = await createCharacterWithVersion(local.db, "local", content("初期"));
    characterIds.push(created.id);
    let resumeHash: (() => void) | undefined;
    let reachedHash: (() => void) | undefined;
    const hashEntered = new Promise<void>((resolve) => {
      reachedHash = resolve;
    });
    const hashGate = new Promise<void>((resolve) => {
      resumeHash = resolve;
    });
    const originalDigest = crypto.subtle.digest.bind(crypto.subtle);
    let paused = false;
    const digest = vi.spyOn(crypto.subtle, "digest").mockImplementation(async (algorithm, data) => {
      if (!paused) {
        paused = true;
        reachedHash?.();
        await hashGate;
      }
      return originalDigest(algorithm, data);
    });
    try {
      const staleRetry = updateCharacterWithVersion(local.db, {
        id: created.id,
        userId: "local",
        expectedRevision: 1,
        content: content("初期"),
      });
      await hashEntered;
      await updateCharacterWithVersion(local.db, {
        id: created.id,
        userId: "local",
        expectedRevision: 1,
        content: content("別更新"),
      });
      resumeHash?.();
      await expect(staleRetry).rejects.toBeInstanceOf(CharacterConflictError);
    } finally {
      resumeHash?.();
      digest.mockRestore();
    }
  });

  it("reconstructs legacy content byte-for-byte and pins old conversations before an edit", async () => {
    const prompt = `旧人格設定\n${"長い設定。".repeat(900)}`;
    const { id, userId } = await insertLegacyCharacter(prompt);
    const conversationId = crypto.randomUUID();
    conversationIds.push(conversationId);
    await local.db.insert(v2ConversationTable).values({
      id: conversationId,
      userId,
      characterId: id,
      title: "旧会話",
      threadId: conversationId,
      promptVersion: "v1",
      characterVersionId: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await local.db.insert(v2GenerationTable).values({
      id: crypto.randomUUID(),
      conversationId,
      turn: 1,
      model: "test",
      promptVersion: "v1",
      systemPrompt: "生成時に保存された設定。",
      requestJson: "{}",
      rawOutput: null,
      usageJson: null,
      latencyMs: null,
      status: "ok",
      error: null,
      createdAt: Date.now(),
    });

    const updated = await updateCharacterWithVersion(local.db, {
      id,
      userId,
      expectedRevision: 0,
      content: content("編集後"),
    });
    expect(updated?.revision).toBe(1);
    const [conversation] = await local.db
      .select({
        characterVersionId: v2ConversationTable.characterVersionId,
        promptVersion: v2ConversationTable.promptVersion,
      })
      .from(v2ConversationTable)
      .where(eq(v2ConversationTable.id, conversationId));
    const [generation] = await local.db
      .select({
        promptVersion: v2GenerationTable.promptVersion,
        systemPrompt: v2GenerationTable.systemPrompt,
      })
      .from(v2GenerationTable)
      .where(eq(v2GenerationTable.conversationId, conversationId));
    expect(conversation.promptVersion).toBe("v1");
    expect(generation).toEqual({
      promptVersion: "v1",
      systemPrompt: "生成時に保存された設定。",
    });
    const legacyVersion = await readCharacterVersion(local.db, {
      characterId: id,
      versionId: conversation.characterVersionId ?? "",
      userId,
    });
    expect(legacyVersion?.content.legacyReconstructed).toBe(true);
    expect(legacyVersion?.content.personality).toBe(prompt);
    expect(legacyVersion ? composeSystemPrompt(legacyVersion.content) : "").toBe(prompt);
    const parsed = storedCharacterContentSchema.safeParse(legacyVersion?.content);
    expect(parsed.success).toBe(true);
    const [parent] = await local.db
      .select({ currentVersionId: characterTable.currentVersionId })
      .from(characterTable)
      .where(eq(characterTable.id, id));
    expect(parent.currentVersionId).toBe(updated?.versionId);
    expect(conversation.characterVersionId).not.toBe(parent.currentVersionId);
    expect(
      await local.db
        .select()
        .from(characterRevisionTable)
        .where(eq(characterRevisionTable.characterId, id)),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ revision: 0, action: "legacy" }),
        expect.objectContaining({ revision: 1, action: "update" }),
      ]),
    );
  });

  it("scopes character and version reads to the owner and character", async () => {
    const created = await createCharacterWithVersion(local.db, "local", content("所有者"));
    const other = await createCharacterWithVersion(local.db, "local", content("別キャラ"));
    characterIds.push(created.id, other.id);
    await expect(readCharacterDetail(local.db, created.id, "other-user")).resolves.toBeNull();
    await expect(
      readCharacterVersion(local.db, {
        characterId: other.id,
        versionId: created.versionId,
        userId: "local",
      }),
    ).resolves.toBeNull();
    await expect(
      loadVersionedCharacter(local.db, {
        characterId: other.id,
        versionId: created.versionId,
        userId: "local",
      }),
    ).resolves.toBeNull();
    await expect(
      restoreCharacterVersion(local.db, {
        id: other.id,
        userId: "local",
        versionId: created.versionId,
        expectedRevision: 1,
      }),
    ).rejects.toBeInstanceOf(CharacterVersionNotFoundError);
    const detail = await readCharacterDetail(local.db, created.id, "local");
    expect(detail?.content.privateNotes).toBe("所有者だけが見る演出メモ。");
  });

  it("does not let an official character owned by someone else initialize during edits", async () => {
    const { id } = await insertLegacyCharacter();
    await local.db
      .update(characterTable)
      .set({ isOfficial: true })
      .where(eq(characterTable.id, id));

    await expect(
      updateCharacterWithVersion(local.db, {
        id,
        userId: "local",
        expectedRevision: 0,
        content: content("不正な編集"),
      }),
    ).resolves.toBeNull();
    await expect(
      restoreCharacterVersion(local.db, {
        id,
        userId: "local",
        versionId: "missing-version",
        expectedRevision: 0,
      }),
    ).rejects.toBeInstanceOf(CharacterVersionNotFoundError);

    const [parent] = await local.db
      .select({
        revision: characterTable.revision,
        currentVersionId: characterTable.currentVersionId,
      })
      .from(characterTable)
      .where(eq(characterTable.id, id));
    const versions = await local.db
      .select()
      .from(characterVersionTable)
      .where(eq(characterVersionTable.characterId, id));
    const history = await local.db
      .select()
      .from(characterRevisionTable)
      .where(eq(characterRevisionTable.characterId, id));
    expect(parent).toMatchObject({ revision: 0, currentVersionId: null });
    expect(versions).toHaveLength(0);
    expect(history).toHaveLength(0);
  });

  it("rejects version rows whose owner does not match the parent character", async () => {
    const { id, userId } = await insertLegacyCharacter();
    await local.db
      .update(characterTable)
      .set({ isOfficial: true })
      .where(eq(characterTable.id, id));
    const ensured = await ensureCurrentVersion(local.db, id, userId);
    expect(ensured).not.toBeNull();
    await local.db
      .update(characterVersionTable)
      .set({ ownerUserId: "local" })
      .where(eq(characterVersionTable.id, ensured?.versionId ?? ""));

    await expect(
      readCharacterVersion(local.db, {
        characterId: id,
        versionId: ensured?.versionId ?? "",
        userId: "local",
      }),
    ).resolves.toBeNull();
    await expect(
      loadVersionedCharacter(local.db, {
        characterId: id,
        versionId: ensured?.versionId ?? "",
        userId: "local",
      }),
    ).resolves.toBeNull();
  });

  it("pins a new conversation once and keeps its first version", async () => {
    const created = await createCharacterWithVersion(local.db, "local", content("会話開始"));
    characterIds.push(created.id);
    const conversationId = crypto.randomUUID();
    conversationIds.push(conversationId);
    const first = await ensureConversationVersion(local.db, {
      conversationId,
      userId: "local",
      characterId: created.id,
      promptVersion: "test-v1",
      versionId: created.versionId,
    });
    const second = await ensureConversationVersion(local.db, {
      conversationId,
      userId: "local",
      characterId: created.id,
      promptVersion: "test-v1",
      versionId: "later-version",
    });
    expect(first).toBe(created.versionId);
    expect(second).toBe(created.versionId);
    const [conversation] = await local.db
      .select({ characterVersionId: v2ConversationTable.characterVersionId })
      .from(v2ConversationTable)
      .where(eq(v2ConversationTable.id, conversationId));
    expect(conversation.characterVersionId).toBe(created.versionId);
  });

  it("does not leave unreferenced versions after a stale concurrent update", async () => {
    const created = await createCharacterWithVersion(local.db, "local", content("初期"));
    characterIds.push(created.id);
    await updateCharacterWithVersion(local.db, {
      id: created.id,
      userId: "local",
      expectedRevision: 1,
      content: content("先行"),
    });
    await expect(
      updateCharacterWithVersion(local.db, {
        id: created.id,
        userId: "local",
        expectedRevision: 1,
        content: content("遅延"),
      }),
    ).rejects.toBeInstanceOf(CharacterConflictError);
    const versions = await local.db
      .select({ id: characterVersionTable.id })
      .from(characterVersionTable)
      .where(eq(characterVersionTable.characterId, created.id));
    const history = await local.db
      .select({ versionId: characterRevisionTable.versionId })
      .from(characterRevisionTable)
      .where(eq(characterRevisionTable.characterId, created.id));
    expect(versions.map(({ id }) => id).sort()).toEqual(
      history.map(({ versionId }) => versionId).sort(),
    );
  });
});
