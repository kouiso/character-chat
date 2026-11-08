// @vitest-environment node
// 記憶の手直し API（RIT-92）をローカル D1 で端から端まで回す。
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  characterTable,
  createD1TurnStore,
  userTable,
} from "@v2/db";
import { emptyLedger } from "@v2/prompt";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { openLocalD1, type LocalD1 } from "../../../../packages/db/src/test/local-d1";

import { LOCAL_USER_ID } from "./identity";

const platform = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));

vi.mock("./platform", () => ({ getPlatform: async () => platform }));

const { handleMemoriesRequest } = await import("./api-memories");

const url = "https://example.com/api/characters/c1/memories";
const request = (method: string, body?: unknown) =>
  new Request(url, {
    method,
    ...(body === undefined
      ? {}
      : {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
  });

const reply = {
  type: "chunk" as const,
  seq: 0,
  text: "<dialogue>覚えておきます。</dialogue>",
  attempt: 1,
  preExtend: true,
  judge: {
    ok: true,
    reasons: [],
    warnings: [],
    checks: {
      ngram: { ok: true, ratio: 0, matchedPhrases: [], exactRepeat: false },
      nearDuplicate: { ok: true, matches: [] },
      voice: { ok: true, endingsMismatch: false },
      format: { ok: true },
      empty: { ok: true },
    },
  },
};

describe("memories API", () => {
  let local: LocalD1;
  let persistRoot: string | undefined;
  let characterId: string;
  const conversations: string[] = [];

  const talk = async (userText = "私は紅茶が好きです。") => {
    const conversationId = crypto.randomUUID();
    conversations.push(conversationId);
    await createD1TurnStore(local.db, {
      userId: LOCAL_USER_ID,
      characterId,
      promptVersion: "test",
      extractMemory: false,
    }).saveTurn({
      conversationId,
      turn: 1,
      userText,
      ledger: emptyLedger(),
      events: [reply],
    });
    return conversationId;
  };

  const call = (method: string, body?: unknown) =>
    handleMemoriesRequest(characterId, request(method, body));

  const list = async () => {
    const response = await call("GET");
    expect(response.status).toBe(200);
    return (await response.json()) as {
      memories: { id: string; content: string; pinned: boolean }[];
    };
  };

  beforeAll(async () => {
    persistRoot = await mkdtemp(join(tmpdir(), "v2-api-memories-"));
    local = await openLocalD1({ persistRoot });
    const now = Date.now();
    await local.db
      .insert(userTable)
      .values({ id: LOCAL_USER_ID, email: "local@example.invalid", createdAt: now })
      .onConflictDoNothing();
    const [character] = await local.db
      .select({ id: characterTable.id })
      .from(characterTable)
      .limit(1);
    characterId = character.id;
    platform.env = { DB: local.d1, V2_RAG_ENABLED: "0" };
  }, 120_000);

  afterAll(async () => {
    if (conversations.length) {
      const placeholders = conversations.map(() => "?").join(", ");
      // 子側から消す（v2_memory_source は memory の cascade）
      await local.d1
        .prepare(
          `DELETE FROM v2_chunk WHERE message_id IN (SELECT id FROM v2_message WHERE conversation_id IN (${placeholders}))`,
        )
        .bind(...conversations)
        .run();
      for (const table of [
        "v2_memory",
        "v2_memory_tombstone",
        "v2_message",
        "v2_ledger",
        "v2_generation",
      ]) {
        await local.d1
          .prepare(`DELETE FROM ${table} WHERE conversation_id IN (${placeholders})`)
          .bind(...conversations)
          .run();
      }
      await local.d1
        .prepare(`DELETE FROM v2_conversation WHERE id IN (${placeholders})`)
        .bind(...conversations)
        .run();
    }
    await local.dispose();
    if (persistRoot) await rm(persistRoot, { recursive: true, force: true });
  });

  it("GET はキャラの記憶一覧を返す", async () => {
    const conversationId = await talk();
    const created = await call("POST", {
      conversationId,
      content: "一覧テスト用の記憶",
      kind: "fact",
    });
    expect(created.status).toBe(201);
    const { memories } = await list();
    expect(memories.map((row) => row.content)).toContain("一覧テスト用の記憶");
    expect(memories.find((row) => row.content === "一覧テスト用の記憶")?.pinned).toBe(true);
  });

  it("POST は会話の指定が無くても直近会話へ紐付き、会話ゼロでは 409", async () => {
    await talk();
    const created = await call("POST", { content: "直近会話への記憶" });
    expect(created.status).toBe(201);
    const memory = (await created.json()) as { memory: { conversationId: string } };
    expect(conversations).toContain(memory.memory.conversationId);

    // 会話が1件も無いキャラ id では 409
    const empty = await handleMemoriesRequest(
      "no-conversations",
      request("POST", { content: "x" }),
    );
    expect(empty.status).toBe(409);
  });

  it("PATCH で直すと GET に反映され、pin も切り替わる", async () => {
    const conversationId = await talk();
    const created = await call("POST", {
      conversationId,
      content: "直す前",
      kind: "preference",
    });
    const { memory } = (await created.json()) as { memory: { id: string } };

    const patched = await call("PATCH", { memoryId: memory.id, content: "直した後" });
    expect(patched.status).toBe(200);
    let { memories } = await list();
    expect(memories.find((row) => row.id === memory.id)?.content).toBe("直した後");

    const unpinned = await call("PATCH", { memoryId: memory.id, pinned: false });
    expect(unpinned.status).toBe(200);
    ({ memories } = await list());
    expect(memories.find((row) => row.id === memory.id)?.pinned).toBe(false);

    // content も pinned も無い PATCH は 422、存在しない記憶は 404
    expect((await call("PATCH", { memoryId: memory.id })).status).toBe(422);
    expect((await call("PATCH", { memoryId: "no-such", pinned: true })).status).toBe(404);
  });

  it("DELETE で消すと一覧から消え、他人のキャラ経路では触れない", async () => {
    const conversationId = await talk();
    const created = await call("POST", { conversationId, content: "消す記憶" });
    const { memory } = (await created.json()) as { memory: { id: string } };

    // 別キャラ id 経路はそのキャラの記憶が無いので 404
    const other = await handleMemoriesRequest("other-char", request("DELETE", { memoryId: memory.id }));
    expect(other.status).toBe(404);

    expect((await call("DELETE", { memoryId: memory.id })).status).toBe(200);
    const { memories } = await list();
    expect(memories.find((row) => row.id === memory.id)).toBeUndefined();
  });

  it("空・長すぎる記憶は 422、4000字は通る", async () => {
    const conversationId = await talk();
    expect(
      (await call("POST", { conversationId, content: "" })).status,
    ).toBe(422);
    expect(
      (await call("POST", { conversationId, content: "x".repeat(4001) })).status,
    ).toBe(422);
    const ok = await call("POST", { conversationId, content: "あ".repeat(4000) });
    expect(ok.status).toBe(201);
  });
});
