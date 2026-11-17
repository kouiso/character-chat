// 話しかけの記憶読み手（RIT-89 FR-4）。loadRecentMemories は会話まで絞る、
// loadRecallCueMemories は会話をまたぐ — どちらも利用者・キャラ・枝・置き換わり・
// kind の区切りは共有。
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { hashMemorySource } from "./memory-extraction-store";
import { loadRecentMemories, loadRecallCueMemories } from "./proactive-store";
import { openLocalD1, type LocalD1 } from "./test/local-d1";

const now = Date.parse("2026-11-16T00:00:00.000Z");
const userId = `proactive-${crypto.randomUUID()}`;
const characterId = `proactive-char-${crypto.randomUUID()}`;
const otherCharacterId = `proactive-other-${crypto.randomUUID()}`;

const seedConversation = async (local: LocalD1, id: string, charId = characterId) => {
  await local.d1
    .prepare(
      "INSERT INTO v2_conversation (id, user_id, character_id, thread_id, prompt_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(id, userId, charId, id, "test", now, now)
    .run();
};

// 発言 + その発言を出どころにする記憶を植える。active=0 は眠った枝。
const seedSourcedMemory = async (
  local: LocalD1,
  input: {
    conversationId: string;
    turn: number;
    active: number;
    content: string;
    kind?: string;
    supersededBy?: string;
    deletedAt?: number;
    origin?: string;
  },
) => {
  const messageId = crypto.randomUUID();
  const memoryId = crypto.randomUUID();
  await local.d1
    .prepare(
      "INSERT INTO v2_message (id, conversation_id, turn, role, content, branch_no, active, created_at) VALUES (?, ?, ?, 'user', ?, ?, ?, ?)",
    )
    .bind(messageId, input.conversationId, input.turn, input.content, 0, input.active, now)
    .run();
  await local.d1
    .prepare(
      "INSERT INTO v2_memory (id, conversation_id, kind, content, pinned, source_turn, created_at, superseded_by, deleted_at, origin) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?)",
    )
    .bind(
      memoryId,
      input.conversationId,
      input.kind ?? "fact",
      input.content,
      input.turn,
      now,
      input.supersededBy ?? null,
      input.deletedAt ?? null,
      input.origin ?? "extracted",
    )
    .run();
  await local.d1
    .prepare(
      "INSERT INTO v2_memory_source (memory_id, source_message_id, source_content_hash, importance) VALUES (?, ?, ?, 3)",
    )
    .bind(memoryId, messageId, await hashMemorySource(input.content))
    .run();
  return memoryId;
};

describe("proactive memory readers (FR-4)", () => {
  let local: LocalD1;
  const conv1 = `proactive-conv-1-${crypto.randomUUID()}`;
  const conv2 = `proactive-conv-2-${crypto.randomUUID()}`;
  const otherCharConv = `proactive-conv-other-${crypto.randomUUID()}`;

  beforeAll(async () => {
    local = await openLocalD1();
    await local.d1
      .prepare("INSERT INTO user (id, email, created_at) VALUES (?, ?, ?)")
      .bind(userId, `${userId}@example.invalid`, now)
      .run();
    for (const id of [characterId, otherCharacterId]) {
      await local.d1
        .prepare(
          "INSERT INTO character (id, user_id, name, system_prompt, greeting, tags, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(id, userId, "想起役", "テスト用", "こんにちは", "[]", now)
        .run();
    }
    await seedConversation(local, conv1);
    await seedConversation(local, conv2);
    await seedConversation(local, otherCharConv, otherCharacterId);

    // 生きた枝・別会話・眠った枝・置き換わり・summary・削除済み・別キャラを一通り植える
    await seedSourcedMemory(local, {
      conversationId: conv1,
      turn: 1,
      active: 1,
      content: "ユーザーは紅茶が好き",
    });
    await seedSourcedMemory(local, {
      conversationId: conv1,
      turn: 2,
      active: 1,
      content: "ユーザーは犬派",
      kind: "preference",
    });
    await seedSourcedMemory(local, {
      conversationId: conv2,
      turn: 1,
      active: 1,
      content: "別会話の記憶",
    });
    await seedSourcedMemory(local, {
      conversationId: conv1,
      turn: 3,
      active: 0,
      content: "眠った枝の記憶",
    });
    await seedSourcedMemory(local, {
      conversationId: conv1,
      turn: 4,
      active: 1,
      content: "古い好み",
      supersededBy: "newer",
    });
    await seedSourcedMemory(local, {
      conversationId: conv1,
      turn: 5,
      active: 1,
      content: "要約行",
      kind: "summary",
    });
    await seedSourcedMemory(local, {
      conversationId: conv1,
      turn: 6,
      active: 1,
      content: "消した記憶",
      deletedAt: now,
    });
    await seedSourcedMemory(local, {
      conversationId: otherCharConv,
      turn: 1,
      active: 1,
      content: "別キャラの記憶",
    });
  }, 120_000);

  afterAll(async () => {
    await local?.dispose();
  });

  it("loadRecentMemories は自分の会話の生きた記憶だけ返す", async () => {
    const recent = await loadRecentMemories(
      local.db,
      { userId, characterId, conversationId: conv1 },
      20,
    );
    expect(recent).toContain("ユーザーは紅茶が好き");
    expect(recent).toContain("ユーザーは犬派");
    expect(recent).not.toContain("別会話の記憶");
    expect(recent).not.toContain("眠った枝の記憶");
    expect(recent).not.toContain("古い好み");
    expect(recent).not.toContain("要約行");
    expect(recent).not.toContain("消した記憶");
  });

  it("loadRecentMemories は別キャラ・別利用者の区切りで空を返す", async () => {
    expect(
      await loadRecentMemories(
        local.db,
        { userId, characterId: otherCharacterId, conversationId: conv1 },
        20,
      ),
    ).toEqual([]);
    expect(
      await loadRecentMemories(
        local.db,
        { userId: "someone-else", characterId, conversationId: conv1 },
        20,
      ),
    ).toEqual([]);
  });

  it("loadRecallCueMemories は会話をまたぐが利用者・キャラ・枝の区切りは守る", async () => {
    const memories = await loadRecallCueMemories(local.db, { userId, characterId }, 50);
    const contents = memories.map((memory) => memory.content);
    // 同じ利用者・同じキャラの別会話の記憶は出る（未決 1）
    expect(contents).toContain("別会話の記憶");
    expect(contents).toContain("ユーザーは紅茶が好き");
    // 眠った枝・置き換わり・summary・削除・別キャラは出ない
    expect(contents).not.toContain("眠った枝の記憶");
    expect(contents).not.toContain("古い好み");
    expect(contents).not.toContain("要約行");
    expect(contents).not.toContain("消した記憶");
    expect(contents).not.toContain("別キャラの記憶");
  });
});
