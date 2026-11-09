// RIT-185: 画像履歴一覧・削除の API 面の確かめ — 実 D1 + 模擬 R2 で、
// 新しい順の一覧、他人会話の遮断、削除で一覧・メッセージ・R2 実体から消えることを見る。
// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { openLocalD1, type LocalD1 } from "../../../../packages/db/src/test/local-d1";
import { characterTable } from "../../../../src/schema/character";

const platform = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));

vi.mock("./platform", () => ({ getPlatform: async () => platform }));

const { handleImageListRequest, handleImageDeleteRequest } = await import("./api-images");

const NOW = 1794290000000;
const CONV = "rit185-conv";

let local: LocalD1;
let charId: string;
const deleted: string[] = [];

const seed = async () => {
  const chars = await local.db
    .select({ id: characterTable.id })
    .from(characterTable)
    .limit(1);
  charId = chars[0].id;
  await local.d1
    .prepare(
      "INSERT INTO v2_conversation (id, user_id, character_id, title, thread_id, prompt_version, created_at, updated_at) VALUES (?, ?, ?, '', ?, 'test', ?, ?)",
    )
    .bind(CONV, "local", charId, CONV, NOW, NOW)
    .run();
  await local.d1
    .prepare(
      "INSERT INTO v2_conversation (id, user_id, character_id, title, thread_id, prompt_version, created_at, updated_at) VALUES (?, ?, ?, '', ?, 'test', ?, ?)",
    )
    .bind("rit185-other", "other-user", charId, "rit185-other", NOW, NOW)
    .run();
};

const insertImageMessage = async (id: string, turn: number, createdAt: number) => {
  await local.d1
    .prepare(
      "INSERT INTO v2_message (id, conversation_id, turn, role, content, image_key, created_at) VALUES (?, ?, ?, 'assistant', '（画像を生成した）', ?, ?)",
    )
    .bind(id, CONV, turn, `images/${id}.png`, createdAt)
    .run();
  await local.d1
    .prepare(
      "INSERT INTO v2_image_generation (id, conversation_id, character_id, message_id, model, prompt, status, image_key, created_at) VALUES (?, ?, ?, ?, 'm', 'p', 'ok', ?, ?)",
    )
    .bind(`gen-${id}`, CONV, charId, id, `images/${id}.png`, createdAt)
    .run();
};

const imageRows = async () =>
  local.d1
    .prepare("SELECT id FROM v2_message WHERE conversation_id = ? AND image_key IS NOT NULL")
    .bind(CONV)
    .all<{ id: string }>();

describe("画像履歴 API", () => {
  beforeAll(async () => {
    local = await openLocalD1();
    platform.env = {
      DB: local.d1,
      BUCKET: {
        get: async () => null,
        put: async () => ({ key: "k" }),
        delete: async (key: string) => {
          deleted.push(key);
        },
      },
    };
    await seed();
  }, 60_000);

  beforeEach(async () => {
    deleted.length = 0;
    await local.d1
      .prepare("DELETE FROM v2_image_generation WHERE conversation_id IN (?, ?)")
      .bind(CONV, "rit185-other")
      .run();
    await local.d1
      .prepare("DELETE FROM v2_message WHERE conversation_id IN (?, ?)")
      .bind(CONV, "rit185-other")
      .run();
    await insertImageMessage("rit185-old", 1, NOW);
    await local.d1
      .prepare(
        "INSERT INTO v2_message (id, conversation_id, turn, role, content, created_at) VALUES (?, ?, 2, 'assistant', '本文のみ', ?)",
      )
      .bind("rit185-text", CONV, NOW + 1)
      .run();
    await insertImageMessage("rit185-new", 3, NOW + 2);
  });

  afterAll(async () => {
    await local.d1.batch([
      local.d1
        .prepare("DELETE FROM v2_image_generation WHERE conversation_id IN (?, ?)")
        .bind(CONV, "rit185-other"),
      local.d1.prepare("DELETE FROM v2_message WHERE conversation_id IN (?, ?)").bind(CONV, "rit185-other"),
      local.d1.prepare("DELETE FROM v2_conversation WHERE id IN (?, ?)").bind(CONV, "rit185-other"),
    ]);
    await local.dispose();
  });

  const list = (characterId: string, conversationId = CONV) =>
    handleImageListRequest(
      characterId,
      new Request(
        `https://example.com/api/chat/${characterId}/images?conversationId=${conversationId}`,
      ),
    );

  it("一覧が新しい順で返り、画像無し行は出ない", async () => {
    const response = await list(charId);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      images: { messageId: string; imageUrl: string; generationId: string | null; turn: number }[];
    };
    expect(body.images.map((image) => image.messageId)).toEqual(["rit185-new", "rit185-old"]);
    expect(body.images[0].imageUrl).toBe(`/api/media/${encodeURIComponent("rit185-new")}`);
    expect(body.images[0].generationId).toBe("gen-rit185-new");
    expect(body.images.map((image) => image.messageId)).not.toContain("rit185-text");
  });

  it("他人の会話は 404", async () => {
    const response = await list(charId, "rit185-other");
    expect(response.status).toBe(404);
  });

  it("conversationId 未指定は 400", async () => {
    const response = await handleImageListRequest(
      charId,
      new Request(`https://example.com/api/chat/${charId}/images`),
    );
    expect(response.status).toBe(400);
  });

  it("削除するとメッセージ・一覧・R2 実体から消える", async () => {
    const response = await handleImageDeleteRequest(
      charId,
      new Request(
        `https://example.com/api/chat/${charId}/images?conversationId=${CONV}&messageId=rit185-new`,
        { method: "DELETE" },
      ),
    );
    expect(response.status).toBe(200);
    expect(deleted).toEqual(["images/rit185-new.png"]);
    expect((await imageRows()).results.map((row) => row.id)).toEqual(["rit185-old"]);
    const after = (await (await list(charId)).json()) as { images: { messageId: string }[] };
    expect(after.images.map((image) => image.messageId)).toEqual(["rit185-old"]);
  });

  it("画像無しメッセージ・無い id の削除は 404", async () => {
    const response = await handleImageDeleteRequest(
      charId,
      new Request(
        `https://example.com/api/chat/${charId}/images?conversationId=${CONV}&messageId=rit185-text`,
        { method: "DELETE" },
      ),
    );
    expect(response.status).toBe(404);
    const missing = await handleImageDeleteRequest(
      charId,
      new Request(
        `https://example.com/api/chat/${charId}/images?conversationId=${CONV}&messageId=none`,
        { method: "DELETE" },
      ),
    );
    expect(missing.status).toBe(404);
  });
});
