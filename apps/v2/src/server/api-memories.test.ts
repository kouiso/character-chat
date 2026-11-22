// @vitest-environment node
// 記憶の手直し API（RIT-92）をローカル D1 で端から端まで回す。
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  characterContentSchema,
  characterTable,
  createCharacterWithVersion,
  createD1TurnStore,
  userTable,
  v2SummaryTable,
} from "@v2/db";
import { emptyLedger } from "@v2/prompt";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { openLocalD1, type LocalD1 } from "../../../../packages/db/src/test/local-d1";

import { LOCAL_USER_ID } from "./identity";

const platform = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));

vi.mock("./platform", () => ({ getPlatform: async () => platform }));

const { handleMemoriesRequest, handleMemoriesRestoreRequest, handleMemoriesLearnedRequest } =
  await import("./api-memories");

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

// 「使った記憶」は generation イベントが運ぶ（RIT-84）。指示文へ入った記憶は
// v2_generation_memory へ、検索の終わり方は v2_generation.memory_retrieval へ入る。
const generation = (usedMemories: { id: string; via: "pinned" | "search" }[] = []) => ({
  type: "generation" as const,
  generationId: crypto.randomUUID(),
  model: "test-model",
  promptVersion: "test",
  systemPrompt: "テスト用の指示",
  request: [],
  rawOutput: "",
  usage: null,
  latencyMs: 1,
  status: "ok" as const,
  usedMemories,
  memoryRetrieval: "ok" as const,
});

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

  const list = async (conversationId?: string) => {
    const response = await handleMemoriesRequest(
      characterId,
      new Request(
        `https://example.com/api/characters/c1/memories${
          conversationId ? `?conversationId=${conversationId}` : ""
        }`,
      ),
    );
    expect(response.status).toBe(200);
    return (await response.json()) as {
      conversationId: string | null;
      characterName: string;
      memories: {
        id: string;
        content: string;
        pinned: boolean;
        revision: number;
        category: string;
        origin: string;
        editedAt: number | null;
        supersededBy: string | null;
        usedInLastReply: boolean;
      }[];
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
        "v2_memory_use",
        "v2_memory_job",
        "v2_summary",
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

  it("GET は会話の記憶一覧・キャラ名・新項目を返す", async () => {
    const conversationId = await talk();
    const created = await call("POST", {
      conversationId,
      content: "一覧テスト用の記憶",
      kind: "fact",
      category: "relation",
    });
    expect(created.status).toBe(201);
    const result = await list(conversationId);
    expect(result.characterName).not.toBe("");
    expect(result.conversationId).toBe(conversationId);
    const memory = result.memories.find((row) => row.content === "一覧テスト用の記憶");
    expect(memory).toMatchObject({
      pinned: true,
      origin: "manual",
      category: "relation",
      revision: 1,
      editedAt: null,
      usedInLastReply: false,
    });
    // 別の会話の一覧には出ない（会話ごとの一覧・RIT-92）
    const other = await talk();
    const otherList = await list(other);
    expect(otherList.memories.find((row) => row.content === "一覧テスト用の記憶")).toBeUndefined();
    // 存在しない・形式の悪い会話 id は 404 / 422
    const notFound = await handleMemoriesRequest(
      characterId,
      new Request(`${url}?conversationId=no-such-conversation`),
    );
    expect(notFound.status).toBe(404);
    const bad = await handleMemoriesRequest(
      characterId,
      new Request(`${url}?conversationId=${"x".repeat(200)}`),
    );
    expect(bad.status).toBe(422);
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

  it("PATCH で直すと GET に反映され、pin も切り替わる。版ずれは 409 revision_conflict", async () => {
    const conversationId = await talk();
    const created = await call("POST", {
      conversationId,
      content: "直す前",
      kind: "preference",
    });
    const { memory } = (await created.json()) as { memory: { id: string; revision: number } };

    // expectedRevision が要る（無し・違う値は 422 / 409）
    expect((await call("PATCH", { memoryId: memory.id, content: "x" })).status).toBe(422);
    const conflict = await call("PATCH", {
      memoryId: memory.id,
      expectedRevision: 9,
      content: "x",
    });
    expect(conflict.status).toBe(409);
    const conflictBody = (await conflict.json()) as {
      code: string;
      currentRevision: number;
    };
    expect(conflictBody.code).toBe("revision_conflict");
    expect(conflictBody.currentRevision).toBe(1);

    const patched = await call("PATCH", {
      memoryId: memory.id,
      expectedRevision: 1,
      content: "直した後",
      category: "recent",
    });
    expect(patched.status).toBe(200);
    const { memory: updated } = (await patched.json()) as {
      memory: { revision: number; category: string; editedAt: number | null };
    };
    expect(updated.revision).toBe(2);
    expect(updated.category).toBe("recent");
    expect(updated.editedAt).not.toBeNull();
    let { memories } = await list(conversationId);
    expect(memories.find((row) => row.id === memory.id)?.content).toBe("直した後");

    const unpinned = await call("PATCH", {
      memoryId: memory.id,
      expectedRevision: 2,
      pinned: false,
    });
    expect(unpinned.status).toBe(200);
    ({ memories } = await list(conversationId));
    expect(memories.find((row) => row.id === memory.id)?.pinned).toBe(false);

    // content も pinned も無い PATCH は 422、存在しない記憶は 404
    expect((await call("PATCH", { memoryId: memory.id, expectedRevision: 3 })).status).toBe(422);
    expect(
      (await call("PATCH", { memoryId: "no-such", expectedRevision: 1, pinned: true })).status,
    ).toBe(404);
  });

  it("固定は 8 件まで。9 件目の固定は 409 pin_limit", async () => {
    const conversationId = await talk();
    // 手で足した記憶は既定で固定 → 8 件で満杯にする
    for (let index = 0; index < 8; index += 1) {
      const created = await call("POST", { conversationId, content: `固定${index}` });
      expect(created.status).toBe(201);
    }
    const ninth = await call("POST", { conversationId, content: "9件目" });
    const { memory } = (await ninth.json()) as { memory: { id: string } };
    // 一度外してから固定し直すと上限に当たる
    expect(
      (await call("PATCH", { memoryId: memory.id, expectedRevision: 1, pinned: false })).status,
    ).toBe(200);
    const over = await call("PATCH", {
      memoryId: memory.id,
      expectedRevision: 2,
      pinned: true,
    });
    expect(over.status).toBe(409);
    expect(((await over.json()) as { code: string }).code).toBe("pin_limit");
  });

  it("DELETE で消すと一覧から消え、他人のキャラ経路では触れない", async () => {
    const conversationId = await talk();
    const created = await call("POST", { conversationId, content: "消す記憶" });
    const { memory } = (await created.json()) as { memory: { id: string } };

    // 別キャラ id 経路はそのキャラの記憶が無いので 404
    const other = await handleMemoriesRequest(
      "other-char",
      request("DELETE", { memoryId: memory.id }),
    );
    expect(other.status).toBe(404);

    expect((await call("DELETE", { memoryId: memory.id })).status).toBe(200);
    const { memories } = await list(conversationId);
    expect(memories.find((row) => row.id === memory.id)).toBeUndefined();
  });

  it("覚える種類が空の版のキャラでも、利用者が足した記憶は入る（FR-7）", async () => {
    const content = characterContentSchema.parse({
      name: "無記憶役",
      personality: "案内役",
      speechStyle: "丁寧",
      greeting: "こんにちは。",
      memoryKinds: [],
    });
    const created = await createCharacterWithVersion(local.db, LOCAL_USER_ID, content);
    const conversationId = crypto.randomUUID();
    conversations.push(conversationId);
    try {
      // 種類を全て切った版に会話を固定しても、手で足す記憶は方針の外（利用者の明示だから）
      await createD1TurnStore(local.db, {
        userId: LOCAL_USER_ID,
        characterId: created.id,
        characterVersionId: created.versionId,
        promptVersion: "test",
        extractMemory: false,
      }).saveTurn({
        conversationId,
        turn: 1,
        userText: "私は紅茶が好きです。",
        ledger: emptyLedger(),
        events: [reply],
      });
      const createdMemory = await handleMemoriesRequest(
        created.id,
        request("POST", { conversationId, content: "手で足した記憶", kind: "preference" }),
      );
      expect(createdMemory.status).toBe(201);
      const response = await handleMemoriesRequest(
        created.id,
        new Request(`${url}?conversationId=${conversationId}`),
      );
      const { memories } = (await response.json()) as {
        memories: { content: string; kind: string }[];
      };
      expect(memories.find((row) => row.content === "手で足した記憶")).toMatchObject({
        kind: "preference",
      });
    } finally {
      // 会話→記憶の順に消してからキャラを消す（外部キー順。afterAll の掃除とは冪等に重なる）
      await local.d1
        .prepare(
          "DELETE FROM v2_chunk WHERE message_id IN (SELECT id FROM v2_message WHERE conversation_id = ?)",
        )
        .bind(conversationId)
        .run();
      for (const table of [
        "v2_memory",
        "v2_memory_tombstone",
        "v2_memory_job",
        "v2_message",
        "v2_ledger",
        "v2_generation",
      ]) {
        await local.d1
          .prepare(`DELETE FROM ${table} WHERE conversation_id = ?`)
          .bind(conversationId)
          .run();
      }
      await local.d1.prepare("DELETE FROM v2_conversation WHERE id = ?").bind(conversationId).run();
      await local.d1
        .prepare("DELETE FROM character_revision WHERE character_id = ?")
        .bind(created.id)
        .run();
      await local.d1
        .prepare("DELETE FROM character_version WHERE character_id = ?")
        .bind(created.id)
        .run();
      await local.d1.prepare("DELETE FROM character WHERE id = ?").bind(created.id).run();
    }
  });

  it("DELETE は deletedAt を返し、墓標に本文・要約を伏せ直し待ち・Queue へ仕事を送る（RIT-94）", async () => {
    const sent: { body: unknown }[] = [];
    const MEMORY_QUEUE = {
      send: async (body: unknown) => {
        sent.push({ body });
      },
    };
    platform.env = { DB: local.d1, V2_RAG_ENABLED: "0", MEMORY_QUEUE };

    const conversationId = await talk();
    await local.db.insert(v2SummaryTable).values({
      id: crypto.randomUUID(),
      conversationId,
      level: 1,
      coveredTo: 1,
      text: "紅茶が好きな人と話した",
      createdAt: Date.now(),
    });
    const created = await call("POST", { conversationId, content: "消す記憶" });
    const { memory } = (await created.json()) as { memory: { id: string } };

    const response = await call("DELETE", { memoryId: memory.id });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; deletedAt: number };
    expect(body.ok).toBe(true);
    expect(typeof body.deletedAt).toBe("number");

    // 墓標には本文が入る（伏せ直しの「書かない事柄」に使う）
    const tombstones = await local.d1
      .prepare("SELECT content FROM v2_memory_tombstone WHERE conversation_id = ?")
      .bind(conversationId)
      .all<{ content: string }>();
    expect(tombstones.results).toHaveLength(1);
    expect(tombstones.results?.[0]?.content).toBe("消す記憶");

    // その会話の要約は伏せ直し待ち
    const summaries = await local.d1
      .prepare("SELECT redact_pending AS pending FROM v2_summary WHERE conversation_id = ?")
      .bind(conversationId)
      .all<{ pending: number }>();
    expect(summaries.results).toEqual([{ pending: 1 }]);

    // Queue には体として type と conversationId だけ（本文は D1 の墓標が持つ）
    expect(sent).toEqual([{ body: { type: "summary_redact", conversationId } }]);
    platform.env = { DB: local.d1, V2_RAG_ENABLED: "0" };
  });

  it("復元は 30 秒以内なら記憶を戻し、窓切れは 410（RIT-94）", async () => {
    const restore = (body: unknown) =>
      handleMemoriesRestoreRequest(characterId, request("POST", body));
    const conversationId = await talk();
    const created = await call("POST", { conversationId, content: "戻す記憶" });
    const { memory } = (await created.json()) as { memory: { id: string } };
    expect((await call("DELETE", { memoryId: memory.id })).status).toBe(200);

    const restored = await restore({ memoryId: memory.id });
    expect(restored.status).toBe(200);
    const { memories } = await list(conversationId);
    expect(memories.find((row) => row.id === memory.id)?.content).toBe("戻す記憶");

    // 削除されとらん記憶の復元は 404
    const ghost = await restore({ memoryId: "no-such" });
    expect(ghost.status).toBe(404);

    // 窓切れ: deleted_at を 31 秒前に戻してから復元すると 410
    expect((await call("DELETE", { memoryId: memory.id })).status).toBe(200);
    await local.d1
      .prepare("UPDATE v2_memory SET deleted_at = ? WHERE id = ?")
      .bind(Date.now() - 31_000, memory.id)
      .run();
    const expired = await restore({ memoryId: memory.id });
    expect(expired.status).toBe(410);
    // 410 と同時に物理削除されるので次は 404
    const gone = await restore({ memoryId: memory.id });
    expect(gone.status).toBe(404);
  });

  it("空・長すぎる記憶は 422、500字までは通る", async () => {
    const conversationId = await talk();
    expect((await call("POST", { conversationId, content: "" })).status).toBe(422);
    expect((await call("POST", { conversationId, content: "x".repeat(501) })).status).toBe(422);
    expect((await call("POST", { conversationId, content: "x", category: "bad" })).status).toBe(
      422,
    );
    const ok = await call("POST", { conversationId, content: "あ".repeat(500) });
    expect(ok.status).toBe(201);
  });

  it("返事に使った記憶は usedInLastReply で返る（v2_generation_memory・RIT-84）", async () => {
    const conversationId = crypto.randomUUID();
    conversations.push(conversationId);
    const created = await call("POST", { conversationId, content: "使う記憶" });
    // まだ会話が無いので先に 404 — 会話を作ってから足す
    expect(created.status).toBe(404);
    await createD1TurnStore(local.db, {
      userId: LOCAL_USER_ID,
      characterId,
      promptVersion: "test",
      extractMemory: false,
    }).saveTurn({
      conversationId,
      turn: 1,
      userText: "私は紅茶が好きです。",
      ledger: emptyLedger(),
      events: [reply],
    });
    const posted = await call("POST", { conversationId, content: "使う記憶" });
    const { memory } = (await posted.json()) as { memory: { id: string } };
    // 2ターン目の返事でこの記憶が指示文へ入った、と記録する
    await createD1TurnStore(local.db, {
      userId: LOCAL_USER_ID,
      characterId,
      promptVersion: "test",
      extractMemory: false,
    }).saveTurn({
      conversationId,
      turn: 2,
      userText: "紅茶の話をもっと。",
      ledger: emptyLedger(),
      events: [reply, generation([{ id: memory.id, via: "search" }])],
    });
    const { memories } = await list(conversationId);
    expect(memories.find((row) => row.id === memory.id)?.usedInLastReply).toBe(true);

    // 新しい生成（枝の切り替え・RIT-82）で使った記憶が無ければバッジは落ちる
    await createD1TurnStore(local.db, {
      userId: LOCAL_USER_ID,
      characterId,
      promptVersion: "test",
      extractMemory: false,
    }).saveTurn({
      conversationId,
      turn: 2,
      userText: "紅茶の話をもっと。",
      ledger: emptyLedger(),
      events: [reply, generation()],
    });
    const after = await list(conversationId);
    expect(after.memories.find((row) => row.id === memory.id)?.usedInLastReply).toBe(false);
  });

  it("learned は抽出ジョブの状態を返す。無ければ none、待機中は pending", async () => {
    const learned = (conversationId: string, turn: number) =>
      handleMemoriesLearnedRequest(
        characterId,
        new Request(`${url}/learned?conversationId=${conversationId}&turn=${turn}`),
      );

    // ジョブが無い会話では none
    const quiet = await talk();
    const none = await learned(quiet, 1);
    expect(none.status).toBe(200);
    expect(((await none.json()) as { state: string }).state).toBe("none");

    // 抽出つきで保存すると pending のジョブが立つ
    const conversationId = crypto.randomUUID();
    conversations.push(conversationId);
    await createD1TurnStore(local.db, {
      userId: LOCAL_USER_ID,
      characterId,
      promptVersion: "test",
      extractMemory: true,
    }).saveTurn({
      conversationId,
      turn: 1,
      userText: "私は紅茶が好きです。",
      ledger: emptyLedger(),
      events: [reply],
    });
    const pending = await learned(conversationId, 1);
    expect(((await pending.json()) as { state: string }).state).toBe("pending");

    // 他人の・存在しない会話は 404
    const foreign = await handleMemoriesLearnedRequest(
      "other-char",
      new Request(`${url}/learned?conversationId=${conversationId}&turn=1`),
    );
    expect(foreign.status).toBe(404);
    expect(
      (
        await handleMemoriesLearnedRequest(
          characterId,
          new Request(`${url}/learned?conversationId=${conversationId}`),
        )
      ).status,
    ).toBe(422);
  });
});
