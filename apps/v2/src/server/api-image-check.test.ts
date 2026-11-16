// @vitest-environment node
// GET /api/admin/image-check — 会話の中の画像の検査。4 状態と、他者の会話を対象外にする事。
import {
  characterTable,
  conversationTable,
  messageTable,
  userTable,
  v2ConversationTable,
  v2MessageTable,
} from "@v2/db";
// テストの掃除は drizzle を直接 import せず raw D1 で行う（別バージョン drizzle の型衝突回避）。
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { handleImageCheck } from "./api-image-check";

import { openLocalD1, type LocalD1 } from "../../../../packages/db/src/test/local-d1";

const mocks = vi.hoisted(() => ({
  bucketHead: vi.fn<(key: string) => Promise<unknown>>(async () => null),
  d1: { current: null as D1Database | null },
}));

vi.mock("./platform", () => ({
  getPlatform: vi.fn(async () => ({
    env: {
      get DB() {
        return mocks.d1.current;
      },
      BUCKET: { head: mocks.bucketHead },
    },
  })),
}));

const request = (query = "") => new Request(`https://example.test/api/admin/image-check${query}`);

describe("GET /api/admin/image-check", () => {
  let local: LocalD1;
  const prefix = `zzimg-${crypto.randomUUID().slice(0, 8)}`;
  const charId = `${prefix}-char`;
  const convId = `${prefix}-conv`;
  const otherUser = `${prefix}-other`;
  const otherConv = `${prefix}-other-conv`;
  const msg = (name: string) => `${prefix}-${name}`;
  const okKey = "images/0f8fad5b-d9cb-469f-a165-70867728950e.png";

  const insertV2Message = async (
    id: string,
    conversationId: string,
    imageKey: string | null,
    turn: number,
  ) =>
    local.db.insert(v2MessageTable).values({
      id,
      conversationId,
      turn,
      role: "assistant",
      content: "画像",
      imageKey,
      createdAt: Date.now(),
    });

  beforeAll(async () => {
    local = await openLocalD1();
    mocks.d1.current = local.d1;
    await local.db
      .insert(userTable)
      .values({ id: "local", email: "local@example.invalid", createdAt: Date.now() })
      .onConflictDoNothing();
    await local.db.insert(userTable).values({
      id: otherUser,
      email: `${otherUser}@example.invalid`,
      createdAt: Date.now(),
    });
    await local.db.insert(characterTable).values({
      id: charId,
      userId: "local",
      name: "画像検査キャラ",
      systemPrompt: "設定",
      greeting: "こんにちは",
      tags: [],
      createdAt: Date.now(),
    });
    await local.db.insert(v2ConversationTable).values({
      id: convId,
      userId: "local",
      characterId: charId,
      threadId: convId,
      promptVersion: "test",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    // 他の利用者の会話。画像が在っても対象に入らん。
    await local.db.insert(v2ConversationTable).values({
      id: otherConv,
      userId: otherUser,
      characterId: charId,
      threadId: otherConv,
      promptVersion: "test",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await insertV2Message(msg("other"), otherConv, okKey, 1);

    // v2 で作った画像（旧 message に同じ id が無い → createdInV2 に数える）。
    await insertV2Message(msg("created"), convId, okKey, 1);
    // 旧移行の画像（v2_message.image_key は空、同じ id の旧 message.image_key が指す）。
    await insertV2Message(msg("legacy"), convId, null, 2);
    await local.db.insert(conversationTable).values({
      id: `${prefix}-legacy-conv`,
      userId: "local",
      characterId: charId,
      title: "",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await local.db.insert(messageTable).values({
      id: msg("legacy"),
      userId: "local",
      conversationId: `${prefix}-legacy-conv`,
      characterId: charId,
      role: "assistant",
      content: "旧画像",
      imageKey: "images/1f8fad5b-d9cb-469f-a165-70867728950e.png",
      createdAt: Date.now(),
    });
    // 形の合わん鍵・無い物・1 バイトの物。
    await insertV2Message(msg("badkey"), convId, "backups/x.sql", 3);
    await insertV2Message(
      msg("missing"),
      convId,
      "images/2f8fad5b-d9cb-469f-a165-70867728950e.png",
      4,
    );
    await insertV2Message(
      msg("empty"),
      convId,
      "images/3f8fad5b-d9cb-469f-a165-70867728950e.png",
      5,
    );
  }, 180_000);

  afterAll(async () => {
    await local.d1.prepare("DELETE FROM message WHERE id = ?").bind(msg("legacy")).run();
    await local.d1
      .prepare("DELETE FROM conversation WHERE id = ?")
      .bind(`${prefix}-legacy-conv`)
      .run();
    for (const id of ["created", "legacy", "badkey", "missing", "empty", "other"].map(msg)) {
      await local.d1.prepare("DELETE FROM v2_message WHERE id = ?").bind(id).run();
    }
    await local.d1
      .prepare("DELETE FROM v2_conversation WHERE id IN (?, ?)")
      .bind(convId, otherConv)
      .run();
    await local.d1.prepare("DELETE FROM character WHERE id = ?").bind(charId).run();
    await local.d1.prepare("DELETE FROM user WHERE id = ?").bind(otherUser).run();
    // 'local' 利用者はほかの検査とも共有する土台なので消さん。
    await local.dispose();
  });

  it("4 つの状態を鍵と実体から判別し、他の利用者の画像は対象に入らん", async () => {
    mocks.bucketHead.mockImplementation(async (key: string) => {
      if (key === "images/3f8fad5b-d9cb-469f-a165-70867728950e.png") {
        return { size: 1 } as R2Object;
      }
      if (key === okKey || key === "images/1f8fad5b-d9cb-469f-a165-70867728950e.png") {
        return { size: 100 } as R2Object;
      }
      return null;
    });
    const response = await handleImageCheck(request("?limit=25"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      total: number;
      createdInV2: number;
      items: { messageId: string; conversationId: string; status: string }[];
    };
    const byId = new Map(body.items.map((item) => [item.messageId, item]));
    expect(byId.get(msg("created"))).toMatchObject({ status: "ok", conversationId: convId });
    expect(byId.get(msg("legacy"))).toMatchObject({ status: "ok", conversationId: convId });
    expect(byId.get(msg("badkey"))?.status).toBe("bad_key");
    expect(byId.get(msg("missing"))?.status).toBe("missing");
    expect(byId.get(msg("empty"))?.status).toBe("empty");
    expect(byId.has(msg("other"))).toBe(false);
    // v2 由来の画像 1 件だけが createdInV2（旧移行・bad_key 等は数えん）。
    expect(body.createdInV2).toBeGreaterThanOrEqual(1);
    const createdIds = body.items.filter(
      (item) => item.messageId === msg("created") || item.messageId === msg("legacy"),
    );
    expect(createdIds).toHaveLength(2);
    // bad_key は head を呼ばん。
    expect(mocks.bucketHead).not.toHaveBeenCalledWith("backups/x.sql");
  });

  it("total は対象の全件、createdInV2 はどのページにも全体の数を返す", async () => {
    const body = (await (await handleImageCheck(request("?limit=1"))).json()) as {
      total: number;
      createdInV2: number;
      items: unknown[];
      nextCursor: string | null;
    };
    expect(body.items).toHaveLength(1);
    expect(body.total).toBeGreaterThanOrEqual(5);
    expect(body.createdInV2).toBeGreaterThanOrEqual(1);
    expect(body.nextCursor).not.toBeNull();
    const second = (await (
      await handleImageCheck(request(`?limit=1&cursor=${body.nextCursor}`))
    ).json()) as { total: number; createdInV2: number };
    expect(second.total).toBe(body.total);
    expect(second.createdInV2).toBe(body.createdInV2);
  });

  it("limit=26 は 400 bad_request", async () => {
    const response = await handleImageCheck(request("?limit=26"));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ code: "bad_request" });
  });
});
