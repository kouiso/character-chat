// @vitest-environment node
// RIT-94: 論理削除（deleted_at）した記憶がどの読む道からも出ないことを、
// 記憶を読む 7 つの経路それぞれで確かめる。物理削除の前でも出ないのが要件。
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  characterTable,
  hashMemorySource,
  listConversationMemories,
  loadMemoryCandidates,
  loadOwnedMemory,
  loadPinnedMemories,
  loadRecentMemories,
  loadUnindexedMemoryJob,
  userTable,
  v2ConversationTable,
  v2MemoryJobTable,
  v2MemorySourceTable,
  v2MemoryTable,
  v2MessageTable,
} from "@v2/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { openLocalD1, type LocalD1 } from "../../../../packages/db/src/test/local-d1";

import { findRecallCue } from "./proactive-recall";

const DAY_MS = 24 * 60 * 60 * 1000;
const userId = `readers-test-${crypto.randomUUID()}`;
const characterId = crypto.randomUUID();
const conversationId = crypto.randomUUID();
const messageId = crypto.randomUUID();
const jobId = crypto.randomUUID();
const liveMemoryId = crypto.randomUUID();
const deadMemoryId = crypto.randomUUID();
const yesterdayMemoryId = crypto.randomUUID();
const now = Date.now();
const scope = { userId, characterId };

describe("memory delete readers (RIT-94)", () => {
  let local: LocalD1;
  let persistRoot: string | undefined;

  beforeAll(async () => {
    persistRoot = await mkdtemp(join(tmpdir(), "v2-delete-readers-"));
    local = await openLocalD1({ persistRoot });
    await local.db.insert(userTable).values({
      id: userId,
      email: `${userId}@example.invalid`,
      createdAt: now,
    });
    await local.db.insert(characterTable).values({
      id: characterId,
      userId,
      name: "読む道役",
      systemPrompt: "テスト用。",
      greeting: "こんにちは。",
      tags: [],
      createdAt: now,
    });
    const sourceHash = await hashMemorySource("出どころの発言");
    await local.db.batch([
      local.db.insert(v2ConversationTable).values({
        id: conversationId,
        userId,
        characterId,
        threadId: conversationId,
        promptVersion: "test",
        createdAt: now,
        updatedAt: now,
      }),
      local.db.insert(v2MessageTable).values({
        id: messageId,
        conversationId,
        turn: 1,
        role: "user",
        content: "出どころの発言",
        createdAt: now,
      }),
      // 生きとる記憶（読む道に出るべきもの）
      local.db.insert(v2MemoryTable).values({
        id: liveMemoryId,
        conversationId,
        kind: "fact",
        content: "生きた記憶",
        pinned: 0,
        sourceTurn: 1,
        createdAt: now,
      }),
      // 論理削除済みの記憶（読む道から消えるべきもの）。固定あり・要約ありの両方を混ぜる。
      local.db.insert(v2MemoryTable).values({
        id: deadMemoryId,
        conversationId,
        kind: "preference",
        content: "消した記憶",
        pinned: 1,
        sourceTurn: 1,
        createdAt: now - 1,
        deletedAt: now - 1,
      }),
      // 昨日つくられた生きた記憶（recall のキュー用）
      local.db.insert(v2MemoryTable).values({
        id: yesterdayMemoryId,
        conversationId,
        kind: "fact",
        content: "昨日の記憶",
        pinned: 0,
        sourceTurn: 1,
        createdAt: now - DAY_MS,
      }),
      local.db.insert(v2MemorySourceTable).values({
        memoryId: liveMemoryId,
        sourceMessageId: messageId,
        sourceContentHash: sourceHash,
        importance: 1,
      }),
      local.db.insert(v2MemorySourceTable).values({
        memoryId: deadMemoryId,
        sourceMessageId: messageId,
        sourceContentHash: sourceHash,
        importance: 1,
      }),
      local.db.insert(v2MemorySourceTable).values({
        memoryId: yesterdayMemoryId,
        sourceMessageId: messageId,
        sourceContentHash: sourceHash,
        importance: 1,
      }),
      local.db.insert(v2MemoryJobTable).values({
        id: jobId,
        sourceMessageId: messageId,
        sourceTurn: 1,
        conversationId,
        userId,
        characterId,
        state: "completed",
        createdAt: now,
        updatedAt: now,
      }),
    ]);
  }, 120_000);

  afterAll(async () => {
    if (local) {
      await local.d1.exec(
        `DELETE FROM v2_memory_source WHERE memory_id IN (SELECT id FROM v2_memory WHERE conversation_id = '${conversationId}')`,
      );
      for (const table of ["v2_memory", "v2_memory_job", "v2_message"]) {
        await local.d1
          .prepare(`DELETE FROM ${table} WHERE conversation_id = ?`)
          .bind(conversationId)
          .run();
      }
      await local.d1.prepare("DELETE FROM v2_conversation WHERE id = ?").bind(conversationId).run();
      await local.d1.prepare("DELETE FROM character WHERE id = ?").bind(characterId).run();
      await local.d1.prepare("DELETE FROM user WHERE id = ?").bind(userId).run();
      await local.dispose();
    }
    if (persistRoot) await rm(persistRoot, { recursive: true, force: true });
  });

  it("1. 会話の記憶一覧（listConversationMemories・RIT-92 で会話単位へ）", async () => {
    const list = await listConversationMemories(local.db, { ...scope, conversationId });
    const ids = list.map((row) => row.id);
    expect(ids).toContain(liveMemoryId);
    expect(ids).not.toContain(deadMemoryId);
    expect(list.map((row) => row.content)).not.toContain("消した記憶");
  });

  it("2. 所有記憶の読み込み（loadOwnedMemory）", async () => {
    expect(await loadOwnedMemory(local.db, scope, liveMemoryId)).not.toBeNull();
    // 論理削除済みは操作対象から外れる（二重削除・固定・書き換えは 404）
    expect(await loadOwnedMemory(local.db, scope, deadMemoryId)).toBeNull();
  });

  it("3. 固定記憶の経路（loadPinnedMemories）", async () => {
    const pinned = await loadPinnedMemories(local.db, { ...scope, conversationId });
    expect(pinned.map((row) => row.id)).not.toContain(deadMemoryId);
    expect(pinned.map((row) => row.content)).not.toContain("消した記憶");
  });

  it("4. 埋め込み待ちの読み込み（loadUnindexedMemoryJob）", async () => {
    const jobs = await loadUnindexedMemoryJob(local.db, jobId);
    expect(jobs.map((row) => row.id)).toContain(liveMemoryId);
    // 論理削除行は索引へ載せん
    expect(jobs.map((row) => row.id)).not.toContain(deadMemoryId);
  });

  it("5. 検索候補の読み込み（loadMemoryCandidates）", async () => {
    const candidates = await loadMemoryCandidates(local.db, { ...scope, conversationId }, [
      liveMemoryId,
      deadMemoryId,
    ]);
    expect(candidates.map((row) => row.id)).toEqual([liveMemoryId]);
  });

  it("6. 話しかけ用の最近の記憶（loadRecentMemories）", async () => {
    const recent = await loadRecentMemories(local.db, { ...scope, conversationId }, 20);
    expect(recent).toContain("生きた記憶");
    expect(recent).not.toContain("消した記憶");
  });

  it("7. 能動想起のキュー選び（findRecallCue の raw SQL）", async () => {
    const cue = await findRecallCue(local.d1, { userId, characterId, now });
    // 昨日の記憶がキューになるが、消した記憶は絶対にキューにならん
    expect(cue).not.toBeNull();
    expect(cue?.content).toBe("昨日の記憶");
    expect(cue?.content).not.toBe("消した記憶");

    // 生きた記憶を消すと会話の記憶は全部論理削除 → キューは無し
    await local.d1
      .prepare("UPDATE v2_memory SET deleted_at = ? WHERE conversation_id = ?")
      .bind(now, conversationId)
      .run();
    const empty = await findRecallCue(local.d1, { userId, characterId, now });
    expect(empty).toBeNull();
    // 後の掃除（afterAll）に影響せんよう戻す
    await local.d1
      .prepare("UPDATE v2_memory SET deleted_at = NULL WHERE conversation_id = ? AND id != ?")
      .bind(conversationId, deadMemoryId)
      .run();
  });
});
