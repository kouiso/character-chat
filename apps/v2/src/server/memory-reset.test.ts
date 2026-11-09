// RIT-196: 記憶リセットの確かめ — 会話/キャラ単位で v2_memory・source・job・
// summary と Vectorize ベクトルが消え、他会話の記憶は残ることを実 D1 で見る。
// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { openLocalD1, type LocalD1 } from "../../../../packages/db/src/test/local-d1";

import { resetConversationMemory } from "./memory-reset";

const platform = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
vi.mock("./platform", () => ({ getPlatform: async () => platform }));

const { handleMemoryResetRequest } = await import("./api-memory");

let local: LocalD1;
// API ハンドラは LOCAL_USER_ID 固定で所有者を見るため、シードのユーザーも同じにする。
const owner = "local";
const characterId = crypto.randomUUID();
const otherCharacterId = crypto.randomUUID();
const now = Date.now();

// 会話1件＋記憶系3層＋ジョブを生 SQL で最小シードする。
const seedConversation = async (convCharId: string): Promise<string> => {
  const conversationId = crypto.randomUUID();
  const messageId = crypto.randomUUID();
  const memoryId = crypto.randomUUID();
  await local.d1
    .prepare(
      "INSERT INTO v2_conversation (id, user_id, character_id, thread_id, prompt_version, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
    )
    .bind(conversationId, owner, convCharId, conversationId, "test", now, now)
    .run();
  await local.d1
    .prepare(
      "INSERT INTO v2_message (id, conversation_id, turn, role, content, created_at) VALUES (?,?,?,?,?,?)",
    )
    .bind(messageId, conversationId, 1, "user", "好きな飲み物は珈琲", now)
    .run();
  await local.d1
    .prepare(
      "INSERT INTO v2_memory (id, conversation_id, kind, content, pinned, created_at, subject) VALUES (?,?,?,?,?,?,?)",
    )
    .bind(memoryId, conversationId, "preference", "珈琲が好き", 1, now, "飲み物")
    .run();
  await local.d1
    .prepare(
      "INSERT INTO v2_memory_source (memory_id, source_message_id, source_content_hash, importance, valid_from, valid_until) VALUES (?,?,?,?,?,?)",
    )
    .bind(memoryId, messageId, "hash", 3, null, null)
    .run();
  await local.d1
    .prepare(
      "INSERT INTO v2_memory_job (id, conversation_id, user_id, character_id, source_message_id, source_turn, state, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
    )
    .bind(
      crypto.randomUUID(),
      conversationId,
      owner,
      convCharId,
      messageId,
      1,
      "completed",
      now,
      now,
    )
    .run();
  await local.d1
    .prepare(
      "INSERT INTO v2_summary (id, conversation_id, level, covered_to, text, created_at) VALUES (?,?,?,?,?,?)",
    )
    .bind(crypto.randomUUID(), conversationId, 1, 1, "これまでの要約", now)
    .run();
  return conversationId;
};

const newCharacter = async (): Promise<string> => {
  const id = crypto.randomUUID();
  await local.d1
    .prepare(
      "INSERT INTO character (id, user_id, name, system_prompt, greeting, tags, created_at) VALUES (?,?,?,?,?,?,?)",
    )
    .bind(id, owner, "案内役", "テスト用", "こんにちは", "[]", now)
    .run();
  return id;
};

const counts = async (conversationId: string) => {
  const one = async (table: string): Promise<number> => {
    const row = await local.d1
      .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE conversation_id = ?`)
      .bind(conversationId)
      .first<{ n: number }>();
    return Number(row?.n ?? 0);
  };
  return {
    memory: await one("v2_memory"),
    job: await one("v2_memory_job"),
    summary: await one("v2_summary"),
  };
};

beforeAll(async () => {
  local = await openLocalD1();
  await local.d1
    .prepare("INSERT OR IGNORE INTO user (id, email, created_at) VALUES (?,?,?)")
    .bind(owner, `${owner}@example.invalid`, now)
    .run();
  for (const id of [characterId, otherCharacterId]) {
    await local.d1
      .prepare(
        "INSERT INTO character (id, user_id, name, system_prompt, greeting, tags, created_at) VALUES (?,?,?,?,?,?,?)",
      )
      .bind(id, owner, "案内役", "テスト用", "こんにちは", "[]", now)
      .run();
  }
  platform.env = { DB: local.d1 };
}, 60_000);

afterAll(async () => {
  await local?.dispose();
});

describe("resetConversationMemory", () => {
  it("会話指定で記憶3層が消え、messages は残る", async () => {
    const conversationId = await seedConversation(characterId);
    const result = await resetConversationMemory(local.d1, {}, conversationId);
    expect(result.memories).toBe(1);
    expect(result.jobs).toBe(1);
    expect(result.summaries).toBe(1);
    const after = await counts(conversationId);
    expect(after).toEqual({ memory: 0, job: 0, summary: 0 });
    const source = await local.d1
      .prepare(
        "SELECT COUNT(*) AS n FROM v2_memory_source s JOIN v2_message m ON m.id = s.source_message_id WHERE m.conversation_id = ?",
      )
      .bind(conversationId)
      .first<{ n: number }>();
    expect(Number(source?.n ?? 0)).toBe(0);
    const message = await local.d1
      .prepare("SELECT COUNT(*) AS n FROM v2_message WHERE conversation_id = ?")
      .bind(conversationId)
      .first<{ n: number }>();
    expect(Number(message?.n ?? 0)).toBe(1);
  });

  it("キャラ指定で全会話が消え、他キャラの記憶は残る", async () => {
    const own = await newCharacter();
    const convA = await seedConversation(own);
    const convB = await seedConversation(own);
    const other = await seedConversation(otherCharacterId);
    const result = await resetConversationMemory(local.d1, {}, convA, "character");
    expect(result.conversations).toBe(2);
    expect(result.memories).toBe(2);
    expect((await counts(convA)).memory).toBe(0);
    expect((await counts(convB)).memory).toBe(0);
    expect((await counts(other)).memory).toBe(1);
  });

  it("vector 環境があると deleteByIds に memory のベクトルIDが渡る", async () => {
    const conversationId = await seedConversation(characterId);
    const deleteByIds = vi.fn().mockResolvedValue(undefined);
    const env = {
      V2_RAG_ENABLED: "1",
      AI: { run: vi.fn() },
      MEMORY_INDEX: { upsert: vi.fn(), query: vi.fn(), deleteByIds },
    };
    const result = await resetConversationMemory(local.d1, env, conversationId);
    expect(result.vectorsDeleted).toBe(1);
    expect(deleteByIds).toHaveBeenCalledTimes(1);
    const ids = deleteByIds.mock.calls[0][0] as string[];
    expect(ids).toHaveLength(1);
    expect(typeof ids[0]).toBe("string");
  });
});

describe("handleMemoryResetRequest", () => {
  it("?conversationId で会話だけ消す", async () => {
    const target = await seedConversation(characterId);
    const keep = await seedConversation(characterId);
    const response = await handleMemoryResetRequest(
      characterId,
      new Request(`https://example.com/api/chat/${characterId}/memory?conversationId=${target}`, {
        method: "DELETE",
      }),
    );
    expect(response.status).toBe(200);
    const body: { conversations: number; memories: number } = await response.json();
    expect(body.conversations).toBe(1);
    expect(body.memories).toBe(1);
    expect((await counts(target)).memory).toBe(0);
    expect((await counts(keep)).memory).toBe(1);
  });

  it("conversationId 無しでキャラ全会話を消す", async () => {
    const own = await newCharacter();
    const convA = await seedConversation(own);
    const convB = await seedConversation(own);
    const response = await handleMemoryResetRequest(
      own,
      new Request(`https://example.com/api/chat/${own}/memory`, { method: "DELETE" }),
    );
    expect(response.status).toBe(200);
    const body: { conversations: number } = await response.json();
    expect(body.conversations).toBe(2);
    expect((await counts(convA)).memory).toBe(0);
    expect((await counts(convB)).memory).toBe(0);
  });

  it("存在しない会話は404", async () => {
    const response = await handleMemoryResetRequest(
      characterId,
      new Request(
        `https://example.com/api/chat/${characterId}/memory?conversationId=${crypto.randomUUID()}`,
        { method: "DELETE" },
      ),
    );
    expect(response.status).toBe(404);
  });

  it("会話の無いキャラは404", async () => {
    const lonely = crypto.randomUUID();
    await local.d1
      .prepare(
        "INSERT INTO character (id, user_id, name, system_prompt, greeting, tags, created_at) VALUES (?,?,?,?,?,?,?)",
      )
      .bind(lonely, owner, "孤立", "テスト用", "こんにちは", "[]", now)
      .run();
    const response = await handleMemoryResetRequest(
      lonely,
      new Request(`https://example.com/api/chat/${lonely}/memory`, { method: "DELETE" }),
    );
    expect(response.status).toBe(404);
  });
});
