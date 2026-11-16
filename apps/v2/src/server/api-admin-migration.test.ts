// @vitest-environment node
// RIT-77: POST /api/admin/legacy-migration — mode 3 種・400/404/405/409/415・
// 応答に本文・題・利用者 ID が無い・apply を省くと D1 の行数が変わらない。
// apps/v2 側では drizzle-orm の記号を直接 import しない（@v2/db と二重バージョンで
// 型が衝突する）。種まきと掃除は @v2/db の createDb か生 SQL で行う。
import {
  characterTable,
  conversationTable,
  legacyOwnerLabel,
  messageTable,
  userTable,
} from "@v2/db";
import type { createDb } from "@v2/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  FRESH_LOCAL_D1_TIMEOUT_MS,
  openLocalD1,
  type LocalD1,
} from "../../../../packages/db/src/test/local-d1";

const platform = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
vi.mock("./platform", () => ({ getPlatform: async () => ({ env: platform.env }) }));

const { handleLegacyMigration } = await import("./api-admin-migration");

const post = (body: unknown, contentType = "application/json") =>
  handleLegacyMigration(
    new Request("https://v2.test/api/admin/legacy-migration", {
      method: "POST",
      headers: { "content-type": contentType },
      body: JSON.stringify(body),
    }),
  );

describe("POST /api/admin/legacy-migration", () => {
  let local: LocalD1;
  let db: ReturnType<typeof createDb>;
  const owner = `api-migration-${crypto.randomUUID()}`;
  // 会話 ID は本物と同じく利用者 ID を含まない乱数（応答に ID が混ざらん事を確かめるため）。
  const conversationId = `conv-${crypto.randomUUID()}`;
  let sourceOwner = "";

  beforeAll(async () => {
    local = await openLocalD1();
    db = local.db;
    platform.env = { DB: local.d1 };
    const [character] = await db.select({ id: characterTable.id }).from(characterTable).limit(1);
    await db
      .insert(userTable)
      .values({ id: owner, email: `${owner}@example.invalid`, createdAt: 1 });
    await db.insert(conversationTable).values({
      id: conversationId,
      userId: owner,
      characterId: character.id,
      title: "題名は出さない",
      createdAt: 1,
      updatedAt: 1,
    });
    for (const [index, role] of ["user", "assistant"].entries()) {
      await db.insert(messageTable).values({
        id: `${conversationId}-m${index}`,
        conversationId,
        userId: owner,
        characterId: character.id,
        role: role as "user" | "assistant",
        content: "本文は出さない",
        createdAt: index + 1,
      });
    }
    sourceOwner = await legacyOwnerLabel(owner);
  }, FRESH_LOCAL_D1_TIMEOUT_MS);
  afterAll(async () => {
    // 掃除は生 SQL で（drizzle の述語は @v2/db 側の型を通せんので）。
    for (const [sql, id] of [
      ["DELETE FROM v2_message WHERE conversation_id = ?", conversationId],
      ["DELETE FROM v2_legacy_import WHERE conversation_id = ?", conversationId],
      ["DELETE FROM v2_conversation WHERE id = ?", conversationId],
      ["DELETE FROM message WHERE user_id = ?", owner],
      ["DELETE FROM conversation WHERE user_id = ?", owner],
      ["DELETE FROM user WHERE id = ?", owner],
    ] as const) {
      await local.d1.prepare(sql).bind(id).run();
    }
    platform.env = {};
    await local.dispose();
  });

  it("POST 以外は 405、JSON でなければ 415、形が違えば 400", async () => {
    const get = await handleLegacyMigration(
      new Request("https://v2.test/api/admin/legacy-migration", { method: "GET" }),
    );
    expect(get.status).toBe(405);
    const notJson = await post({ mode: "sources" }, "text/plain");
    expect(notJson.status).toBe(415);
    expect(await notJson.json()).toEqual({ code: "content_type_required" });
    const broken = await handleLegacyMigration(
      new Request("https://v2.test/api/admin/legacy-migration", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      }),
    );
    expect(broken.status).toBe(400);
  });

  it("mode が足りん・知らん・古い項目を含むと 400 bad_request", async () => {
    for (const body of [
      {},
      { mode: "memory" },
      { mode: "corpus" },
      { mode: "verify-memory" },
      { mode: "verify-corpus" },
      { mode: "conversations" },
      { mode: "conversations", sourceOwner, dryRun: true },
      { mode: "conversations", sourceOwner, sourceUserId: "x" },
      { mode: "conversations", sourceOwner, limit: 21 },
      { mode: "conversations", sourceOwner: "notalabel" },
      { mode: "conversations", sourceOwner, apply: true },
    ]) {
      const response = await post(body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(await response.json()).toEqual({ code: "bad_request" });
    }
  });

  it("当たる利用者の無い札は 404 source_not_found", async () => {
    const response = await post({ mode: "conversations", sourceOwner: "owner-00000000" });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ code: "source_not_found" });
  });

  it("sources は札と件数だけ返し、利用者 ID を出さない", async () => {
    const response = await post({ mode: "sources" });
    expect(response.status).toBe(200);
    const json = (await response.json()) as {
      sources: {
        sourceOwner: string;
        conversations: number;
        messages: number;
        importedConversations: number;
      }[];
    };
    const row = json.sources.find((entry) => entry.sourceOwner === sourceOwner);
    expect(row).toEqual({
      sourceOwner,
      conversations: 1,
      messages: 2,
      importedConversations: 0,
    });
    expect(JSON.stringify(json)).not.toContain(owner);
  });

  it("確認だけは書き込まず、応答に本文・題・利用者 ID が無い", async () => {
    const before = await local.d1
      .prepare("SELECT count(*) AS n FROM v2_message")
      .first<{ n: number }>();
    const response = await post({ mode: "conversations", sourceOwner });
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toMatchObject({
      mode: "conversations",
      apply: false,
      sourceOwner,
      nextCursor: null,
      page: {
        conversations: 1,
        messages: 2,
        insertedConversations: 1,
        insertedMessages: 2,
        failures: [],
      },
    });
    const serialized = JSON.stringify(json);
    expect(serialized).not.toContain(owner);
    expect(serialized).not.toContain("題名は出さない");
    expect(serialized).not.toContain("本文は出さない");
    const after = await local.d1
      .prepare("SELECT count(*) AS n FROM v2_message")
      .first<{ n: number }>();
    expect(after?.n).toBe(before?.n);
  });

  it("apply: true は expected と一致する時だけ書き、ずれれば 409 plan_changed", async () => {
    const mismatched = await post({
      mode: "conversations",
      sourceOwner,
      apply: true,
      expected: { insertedConversations: 1, insertedMessages: 1 },
    });
    expect(mismatched.status).toBe(409);
    expect(await mismatched.json()).toEqual({
      code: "plan_changed",
      planned: { insertedConversations: 1, insertedMessages: 2 },
    });
    const applied = await post({
      mode: "conversations",
      sourceOwner,
      apply: true,
      expected: { insertedConversations: 1, insertedMessages: 2 },
    });
    expect(applied.status).toBe(200);
    const json = (await applied.json()) as {
      page: { insertedConversations: number; insertedMessages: number };
    };
    expect(json.page).toMatchObject({ insertedConversations: 1, insertedMessages: 2 });
    // 2 度目は 0。expected が 0・0 でなければ 409。
    const again = await post({
      mode: "conversations",
      sourceOwner,
      apply: true,
      expected: { insertedConversations: 0, insertedMessages: 0 },
    });
    expect(again.status).toBe(200);
    const stale = await post({
      mode: "conversations",
      sourceOwner,
      apply: true,
      expected: { insertedConversations: 1, insertedMessages: 2 },
    });
    expect(stale.status).toBe(409);
  });

  it("verify-conversations は 1 件ずつの状態を返し、何も書かない", async () => {
    const response = await post({ mode: "verify-conversations", sourceOwner });
    expect(response.status).toBe(200);
    const json = (await response.json()) as {
      mode: string;
      sourceOwner: string;
      nextCursor: string | null;
      page: { items: { conversationId: string; status: string; matchedMessages: number }[] };
    };
    expect(json).toMatchObject({ mode: "verify-conversations", sourceOwner, nextCursor: null });
    expect(json.page.items[0]).toMatchObject({
      conversationId,
      status: "match",
      matchedMessages: 2,
    });
    expect(JSON.stringify(json)).not.toContain(owner);
  });
});
