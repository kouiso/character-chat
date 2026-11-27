// @vitest-environment node
// POST /api/characters/:id/avatar（取り込み口）の確かめ。D1 はローカル、R2 は Map の模擬。
// アップロードも会話の画像選びも、置いた実体が既存の配信経路（GET avatar）で見えるところまで通す。
import { characterTable, userTable } from "@v2/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { openLocalD1, type LocalD1 } from "../../../../packages/db/src/test/local-d1";
import { handleAvatarRequest } from "../routes/api/characters/$id_/avatar";

const store = vi.hoisted(() => ({
  objects: new Map<string, { bytes: Uint8Array; type: string | undefined }>(),
}));
const platform = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
vi.mock("./platform", () => ({ getPlatform: async () => platform }));

const { handleAvatarPost, AVATAR_MAX_BYTES, listAvatarCandidateIds } =
  await import("./avatar-upload");

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2]);
// 画像鍵の形（R2_KEY_PATTERN）に合うよう、メッセージ id は 16 進だけで作る。
const suffix = crypto.randomUUID().slice(0, 8);
const mine = `av-mine-${suffix}`;
const other = `av-other-${suffix}`;
const stranger = `av-stranger-${suffix}`;
const convMine = `av-conv-mine-${suffix}`;
const convOther = `av-conv-other-${suffix}`;
const convStranger = `av-conv-stranger-${suffix}`;
const msgMine = `aa01-${suffix}`;
const msgOtherChar = `aa02-${suffix}`;
const msgStranger = `aa03-${suffix}`;
const msgVideo = `aa04-${suffix}`;
const msgGone = `aa05-${suffix}`;

let local: LocalD1;

const upload = (id: string, file: Blob | string | null, name = "a.png") => {
  const form = new FormData();
  if (file !== null) form.set("file", file instanceof Blob ? file : new Blob([file]), name);
  return handleAvatarPost(
    id,
    new Request("https://example.test/x", { method: "POST", body: form }),
  );
};
const choose = (id: string, messageId: unknown) =>
  handleAvatarPost(
    id,
    new Request("https://example.test/x", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messageId }),
    }),
  );
const message = async (response: Response) =>
  ((await response.json()) as { message: string }).message;

describe("顔の絵の取り込み口", () => {
  beforeAll(async () => {
    local = await openLocalD1();
    platform.env = {
      DB: local.d1,
      ASSETS: { fetch: async () => new Response(null, { status: 404 }) },
      BUCKET: {
        put: async (key: string, value: Uint8Array, options?: R2PutOptions) => {
          const meta = options?.httpMetadata;
          store.objects.set(key, {
            bytes: value,
            type: meta && !(meta instanceof Headers) ? meta.contentType : undefined,
          });
        },
        get: async (key: string) => {
          const hit = store.objects.get(key);
          return hit
            ? {
                body: hit.bytes,
                arrayBuffer: async () => hit.bytes.slice().buffer,
                httpMetadata: { contentType: hit.type },
              }
            : null;
        },
        head: async (key: string) => {
          const hit = store.objects.get(key);
          return hit
            ? { size: hit.bytes.byteLength, httpMetadata: { contentType: hit.type } }
            : null;
        },
      },
    };
    await local.db.insert(userTable).values({
      id: stranger,
      email: `${stranger}@example.invalid`,
      createdAt: Date.now(),
    });
    await local.d1
      .prepare(
        "INSERT OR IGNORE INTO user (id, email, created_at) VALUES ('local', 'local@example.invalid', 1)",
      )
      .run();
    for (const [id, userId] of [
      [mine, "local"],
      [other, "local"],
    ] as const) {
      await local.db.insert(characterTable).values({
        id,
        userId,
        name: "検査キャラ",
        systemPrompt: "設定",
        greeting: "こんにちは",
        tags: [],
        avatar: null,
        createdAt: Date.now(),
      });
    }
    const conv = (id: string, userId: string, characterId: string) =>
      local.d1
        .prepare(
          "INSERT INTO v2_conversation (id, user_id, character_id, title, thread_id, prompt_version, created_at, updated_at) VALUES (?, ?, ?, '', ?, 'test', 1, 1)",
        )
        .bind(id, userId, characterId, id)
        .run();
    await conv(convMine, "local", mine);
    await conv(convOther, "local", other);
    await conv(convStranger, stranger, mine);
    let turn = 0;
    const msg = (id: string, convId: string, key: string, active = 1) =>
      local.d1
        .prepare(
          "INSERT INTO v2_message (id, conversation_id, turn, role, content, image_key, active, created_at) VALUES (?, ?, ?, 'assistant', 'x', ?, ?, 1)",
        )
        .bind(id, convId, ++turn, key, active)
        .run();
    await msg(msgMine, convMine, `images/${msgMine}.png`);
    await msg(msgOtherChar, convOther, `images/${msgOtherChar}.png`);
    await msg(msgStranger, convStranger, `images/${msgStranger}.png`);
    await msg(msgVideo, convMine, `videos/${msgVideo}.mp4`);
    await msg(msgGone, convMine, `images/${msgGone}.png`, 0);
    for (const id of [msgMine, msgOtherChar, msgStranger, msgGone]) {
      store.objects.set(`images/${id}.png`, { bytes: png, type: "image/png" });
    }
  }, 300_000);

  afterAll(async () => {
    await local.d1
      .prepare("DELETE FROM v2_message WHERE conversation_id IN (?, ?, ?)")
      .bind(convMine, convOther, convStranger)
      .run();
    await local.d1
      .prepare("DELETE FROM v2_conversation WHERE id IN (?, ?, ?)")
      .bind(convMine, convOther, convStranger)
      .run();
    await local.d1.prepare("DELETE FROM character WHERE id IN (?, ?)").bind(mine, other).run();
    await local.d1.prepare("DELETE FROM user WHERE id = ?").bind(stranger).run();
    await local.dispose();
  });

  const serveSaved = async (id: string, ref: string) => {
    await local.d1.prepare("UPDATE character SET avatar = ? WHERE id = ?").bind(ref, id).run();
    return handleAvatarRequest(id, new Request(`https://example.test/api/characters/${id}/avatar`));
  };

  it("画像をアップロードすると参照が返り、顔として配信される", async () => {
    const response = await upload(mine, new Blob([png], { type: "image/png" }));
    expect(response.status).toBe(200);
    const { avatarRef } = (await response.json()) as { avatarRef: string };
    expect(avatarRef).toMatch(/^local\/[\da-f-]+\.png$/);
    const served = await serveSaved(mine, avatarRef);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(png);
  });

  it("まだ保存していない新規キャラでもアップロードできる", async () => {
    const response = await upload("new", new Blob([png], { type: "image/png" }));
    expect(response.status).toBe(200);
  });

  it("画像でない名乗りのファイルは理由つきで断る", async () => {
    const response = await upload(mine, new Blob(["<html>"], { type: "text/html" }), "a.html");
    expect(response.status).toBe(415);
    expect(await message(response)).toContain("画像ではないファイル");
  });

  it("画像と名乗る偽物（中身が画像でない）も断る", async () => {
    const response = await upload(
      mine,
      new Blob(["<html>hello world</html>"], { type: "image/png" }),
    );
    expect(response.status).toBe(415);
    expect(await message(response)).toContain("画像ではないファイル");
  });

  it("大きすぎる画像は理由つきで断り、置かない", async () => {
    const before = store.objects.size;
    const big = new Uint8Array(AVATAR_MAX_BYTES + 1);
    big.set(png);
    const response = await upload(mine, new Blob([big], { type: "image/png" }));
    expect(response.status).toBe(413);
    expect(await message(response)).toContain("大きすぎ");
    expect(store.objects.size).toBe(before);
  });

  it("ファイルが無い・空は理由つきで断る", async () => {
    expect((await upload(mine, null)).status).toBe(400);
    const empty = await upload(mine, new Blob([], { type: "image/png" }));
    expect(empty.status).toBe(400);
    expect(await message(empty)).toContain("空");
  });

  it("他人のキャラへはアップロードできない", async () => {
    await local.db.insert(characterTable).values({
      id: `av-foreign-${suffix}`,
      userId: stranger,
      name: "他人",
      systemPrompt: "設定",
      greeting: "こんにちは",
      tags: [],
      avatar: null,
      createdAt: Date.now(),
    });
    const response = await upload(`av-foreign-${suffix}`, new Blob([png], { type: "image/png" }));
    expect(response.status).toBe(404);
    await local.d1.prepare("DELETE FROM character WHERE id = ?").bind(`av-foreign-${suffix}`).run();
  });

  it("この子との会話の画像を選ぶと顔として配信される", async () => {
    const response = await choose(mine, msgMine);
    expect(response.status).toBe(200);
    const { avatarRef } = (await response.json()) as { avatarRef: string };
    // 元の画像を消しても顔は残る（参照ではなくコピー）。
    store.objects.delete(`images/${msgMine}.png`);
    const served = await serveSaved(mine, avatarRef);
    expect(served.status).toBe(200);
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(png);
    store.objects.set(`images/${msgMine}.png`, { bytes: png, type: "image/png" });
  });

  it("別のキャラの会話・他人の会話・消した画像・存在しない id は同じ理由で断る", async () => {
    for (const id of [msgOtherChar, msgStranger, msgGone, "no-such-message"]) {
      const response = await choose(mine, id);
      expect(response.status).toBe(404);
      expect(await message(response)).toContain("この子との会話の画像ではありません");
    }
  });

  it("動画・id 欠落・存在しないキャラは断る", async () => {
    const video = await choose(mine, msgVideo);
    expect(video.status).toBe(415);
    expect(await message(video)).toContain("動画");
    expect((await choose(mine, 42)).status).toBe(400);
    expect((await choose("no-such-character", msgMine)).status).toBe(404);
  });

  it("別オリジンからの取り込みは断り、置かない", async () => {
    const before = store.objects.size;
    const form = new FormData();
    form.set("file", new Blob([png], { type: "image/png" }), "a.png");
    const crossOrigin: Record<string, string>[] = [
      { "sec-fetch-site": "cross-site" },
      { origin: "https://evil.example" },
    ];
    for (const headers of crossOrigin) {
      const response = await handleAvatarPost(
        mine,
        new Request("https://example.test/x", { method: "POST", headers, body: form }),
      );
      expect(response.status).toBe(403);
    }
    const json = await handleAvatarPost(
      mine,
      new Request("https://example.test/x", {
        method: "POST",
        headers: { "content-type": "application/json", "sec-fetch-site": "cross-site" },
        body: JSON.stringify({ messageId: msgMine }),
      }),
    );
    expect(json.status).toBe(403);
    expect(store.objects.size).toBe(before);
  });

  it("JSON と名乗らない本文（単純リクエスト）は読まずに断る", async () => {
    const response = await handleAvatarPost(
      mine,
      new Request("https://example.test/x", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: JSON.stringify({ messageId: msgMine }),
      }),
    );
    expect(response.status).toBe(415);
    const bare = await handleAvatarPost(
      mine,
      new Request("https://example.test/x", {
        method: "POST",
        body: JSON.stringify({ messageId: msgMine }),
      }),
    );
    expect(bare.status).toBe(415);
  });

  it("予約の new 以外の存在しないキャラ id へはアップロードできず、置かない", async () => {
    const before = store.objects.size;
    const response = await upload("zzz-does-not-exist", new Blob([png], { type: "image/png" }));
    expect(response.status).toBe(404);
    expect(store.objects.size).toBe(before);
  });

  it("顔の候補はこの子の画像だけで、全体の件数上限に左右されない", async () => {
    const env = platform.env as unknown as Parameters<typeof listAvatarCandidateIds>[0];
    const ids = (await listAvatarCandidateIds(env, mine)).map((item) => item.messageId);
    expect(ids).toContain(msgMine);
    for (const excluded of [msgOtherChar, msgStranger, msgGone, msgVideo]) {
      expect(ids).not.toContain(excluded);
    }
    expect(await listAvatarCandidateIds(env, "no-such-character")).toEqual([]);
  });
});
