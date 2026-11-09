import { inArray } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { characterTable } from "../../../src/schema/character";

import { openLocalD1, type LocalD1 } from "./test/local-d1";
import { ensureConversationVersion } from "./turn-store";
import {
  characterRevisionTable,
  characterVersionTable,
  v2ConversationTable,
  v2ImageGenerationTable,
  v2LedgerTable,
  v2MessageTable,
} from "./v2-schema";

import type { V2Db } from "./client";

import {
  characterContentSchema,
  completeImageGeneration,
  createCharacterWithVersion,
  createImageGeneration,
  ensureLocalUser,
  failImageGeneration,
  insertImageMessage,
  markImageTaskStarted,
  readDisplayHistory,
  readLatestLedgerJson,
  readOwnedConversation,
  readOwnedImageGeneration,
  readOwnedImageKey,
} from "./index";

const content = (name: string) =>
  characterContentSchema.parse({
    name,
    personality: "穏やか。",
    speechStyle: "簡潔。",
    greeting: "こんにちは。",
  });

const seedConversation = async (
  db: V2Db,
  opts: { userId?: string; withVersion?: boolean } = {},
): Promise<{ characterId: string; conversationId: string; versionId: string }> => {
  const userId = opts.userId ?? "local";
  const character = await createCharacterWithVersion(
    db,
    userId,
    content(`役-${crypto.randomUUID().slice(0, 6)}`),
  );
  const conversationId = crypto.randomUUID();
  const now = Date.now();
  await db.insert(v2ConversationTable).values({
    id: conversationId,
    userId,
    characterId: character.id,
    title: "",
    threadId: conversationId,
    promptVersion: "test",
    characterVersionId: opts.withVersion === false ? null : character.versionId,
    createdAt: now,
    updatedAt: now,
  });
  return { characterId: character.id, conversationId, versionId: character.versionId };
};

const generationInput = (conversationId: string) => ({
  id: crypto.randomUUID(),
  conversationId,
  model: "waiNSFWIllustrious_v90_1187991.safetensors",
  prompt: "1girl, solo",
  negativePrompt: "lowres",
  seed: null,
  width: 768,
  height: 1024,
  steps: 32,
  guidanceScale: 7,
  sampler: "DPM++ 2M SDE Karras",
  costEstimateUsd: 0.0025,
  now: Date.now(),
});

describe("v2 image generation store", () => {
  let local: LocalD1;
  const conversationIds: string[] = [];
  const characterIds: string[] = [];

  beforeAll(async () => {
    local = await openLocalD1();
    await ensureLocalUser(local.db);
  });

  const seed = async (opts: { userId?: string; withVersion?: boolean } = {}) => {
    const seeded = await seedConversation(local.db, opts);
    conversationIds.push(seeded.conversationId);
    characterIds.push(seeded.characterId);
    return seeded;
  };

  afterEach(async () => {
    const conversations = conversationIds.splice(0);
    const characters = characterIds.splice(0);
    if (conversations.length > 0) {
      await local.db
        .delete(v2ImageGenerationTable)
        .where(inArray(v2ImageGenerationTable.conversationId, conversations));
      await local.db
        .delete(v2LedgerTable)
        .where(inArray(v2LedgerTable.conversationId, conversations));
      await local.db
        .delete(v2MessageTable)
        .where(inArray(v2MessageTable.conversationId, conversations));
      await local.db
        .delete(v2ConversationTable)
        .where(inArray(v2ConversationTable.id, conversations));
    }
    if (characters.length > 0) {
      await local.db
        .delete(characterRevisionTable)
        .where(inArray(characterRevisionTable.characterId, characters));
      await local.db
        .delete(characterVersionTable)
        .where(inArray(characterVersionTable.characterId, characters));
      await local.db.delete(characterTable).where(inArray(characterTable.id, characters));
    }
  });

  afterAll(async () => {
    await local.dispose();
  });

  it("生成記録を起票→taskId 記録→所有権つきで読める", async () => {
    const { conversationId } = await seed();
    const input = generationInput(conversationId);
    await createImageGeneration(local.db, input);
    await markImageTaskStarted(local.db, input.id, "task-1");

    const row = await readOwnedImageGeneration(local.db, "local", input.id);
    expect(row?.status).toBe("running");
    expect(row?.taskId).toBe("task-1");
    expect(row?.costEstimateUsd).toBeCloseTo(0.0025);
    // 他人の所有としては読めん
    expect(await readOwnedImageGeneration(local.db, "other-user", input.id)).toBeNull();
  });

  it("画像メッセージは専用ターン（max+1）へ入り、失敗ターンを蘇らせん", async () => {
    const { characterId, conversationId } = await seed();
    const now = Date.now();
    // 失敗ターン（user + 空 assistant）を残す
    await local.db.insert(v2MessageTable).values([
      {
        id: crypto.randomUUID(),
        conversationId,
        turn: 1,
        role: "user",
        content: "ねえ",
        createdAt: now,
      },
      {
        id: crypto.randomUUID(),
        conversationId,
        turn: 1,
        role: "assistant",
        content: "",
        createdAt: now + 1,
      },
    ]);
    const message = await insertImageMessage(local.db, {
      conversationId,
      content: "（画像を生成した）",
      imageKey: "images/deadbeef-0000-4000-8000-000000000001.png",
      now: now + 2,
    });
    expect(message.turn).toBe(2);

    const display = await readDisplayHistory(
      local.db,
      { userId: "local", characterId, promptVersion: "test" },
      conversationId,
    );
    // 失敗ターンは伏せられ、画像メッセージだけが生きて見える
    expect(display.history).toHaveLength(1);
    expect(display.history[0].imageKey).toBe("images/deadbeef-0000-4000-8000-000000000001.png");
    expect(display.turn).toBe(3);
  });

  it("完了・失敗の状態遷移と画像キーの所有権読込", async () => {
    const { conversationId } = await seed();
    const input = generationInput(conversationId);
    await createImageGeneration(local.db, input);

    const message = await insertImageMessage(local.db, {
      conversationId,
      content: "（画像を生成した）",
      imageKey: "images/deadbeef-0000-4000-8000-000000000002.png",
      now: Date.now(),
    });
    await completeImageGeneration(local.db, {
      id: input.id,
      r2Key: "images/deadbeef-0000-4000-8000-000000000002.png",
      messageId: message.id,
      now: Date.now(),
    });
    const done = await readOwnedImageGeneration(local.db, "local", input.id);
    expect(done?.status).toBe("succeeded");
    expect(done?.messageId).toBe(message.id);

    // 所有者はキーを引ける・他人は引けん
    expect(await readOwnedImageKey(local.db, "local", message.id)).toBe(
      "images/deadbeef-0000-4000-8000-000000000002.png",
    );
    expect(await readOwnedImageKey(local.db, "other-user", message.id)).toBeNull();

    const failed = generationInput(conversationId);
    await createImageGeneration(local.db, failed);
    await failImageGeneration(local.db, {
      id: failed.id,
      failureJson: JSON.stringify({ reason: "upstream_failed" }),
      now: Date.now(),
    });
    const failedRow = await readOwnedImageGeneration(local.db, "local", failed.id);
    expect(failedRow?.status).toBe("failed");
    expect(failedRow?.failureJson).toContain("upstream_failed");
  });

  it("会話の所有権と台帳の読込", async () => {
    const { characterId, conversationId } = await seed();
    expect(await readOwnedConversation(local.db, "local", conversationId)).toEqual({
      characterId,
      characterVersionId: expect.any(String),
    });
    expect(await readOwnedConversation(local.db, "other-user", conversationId)).toBeNull();
    expect(await readOwnedConversation(local.db, "local", "missing")).toBeNull();

    expect(await readLatestLedgerJson(local.db, conversationId)).toBeNull();
    await local.db.insert(v2LedgerTable).values({
      conversationId,
      turn: 1,
      ledgerJson: JSON.stringify({
        phase: "conversation",
        location: "部屋",
        time: null,
        present: [],
        clothing: {},
        position: null,
        lastEvents: ["窓際で話した"],
      }),
      createdAt: Date.now(),
    });
    expect(await readLatestLedgerJson(local.db, conversationId)).toContain("部屋");
  });

  it("版未 pin の会話は ensureConversationVersion で pin される", async () => {
    const { characterId, conversationId, versionId } = await seed({ withVersion: false });
    const pinned = await ensureConversationVersion(local.db, {
      conversationId,
      userId: "local",
      characterId,
      promptVersion: "test",
      versionId,
    });
    expect(pinned).toBe(versionId);
    const conversation = await readOwnedConversation(local.db, "local", conversationId);
    expect(conversation?.characterVersionId).toBe(versionId);
  });
});
