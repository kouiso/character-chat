// アルバム一覧の確かめ — 実 D1 で、本人の会話・種類分け・新しい順・他人会話の遮断を見る。
// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { openLocalD1, type LocalD1 } from "../../../../packages/db/src/test/local-d1";

import { listAlbumItems } from "./api-album";

const NOW = 1794290000000;

let local: LocalD1;

const seed = async () => {
  for (const user of ["local", "other-user"]) {
    await local.d1
      .prepare("INSERT OR IGNORE INTO user (id, email, created_at) VALUES (?, ?, ?)")
      .bind(user, `${user}@x`, 1)
      .run();
  }
  for (const [id, name] of [
    ["album-c1", "霜月 鈴"],
    ["album-c2", "さくら"],
  ]) {
    await local.d1
      .prepare(
        "INSERT INTO character (id, user_id, name, system_prompt, greeting, tags, created_at) VALUES (?, 'local', ?, 'sp', 'g', '[]', ?)",
      )
      .bind(id, name, NOW)
      .run();
  }
  const convs: [string, string, string][] = [
    ["album-conv", "local", "album-c1"],
    ["album-conv2", "local", "album-c2"],
    ["album-other", "other-user", "album-c1"],
  ];
  for (const [id, user, char] of convs) {
    await local.d1
      .prepare(
        "INSERT INTO v2_conversation (id, user_id, character_id, title, thread_id, prompt_version, created_at, updated_at) VALUES (?, ?, ?, '', ?, 'test', ?, ?)",
      )
      .bind(id, user, char, id, NOW, NOW)
      .run();
  }
};

const imageMessage = async (
  id: string,
  conv: string,
  char: string,
  imageKey: string,
  createdAt: number,
  groupId: string | null = null,
  turn = 1,
) => {
  await local.d1
    .prepare(
      "INSERT INTO v2_message (id, conversation_id, turn, role, content, image_key, created_at) VALUES (?, ?, ?, 'assistant', '（画像を生成した）', ?, ?)",
    )
    .bind(id, conv, turn, imageKey, createdAt)
    .run();
  await local.d1
    .prepare(
      "INSERT INTO v2_image_generation (id, conversation_id, character_id, message_id, model, prompt, status, image_key, group_id, created_at) VALUES (?, ?, ?, ?, 'm', 'p', 'ok', ?, ?, ?)",
    )
    .bind(`gen-${id}`, conv, char, id, imageKey, groupId, createdAt)
    .run();
};

describe("アルバム一覧", () => {
  beforeAll(async () => {
    local = await openLocalD1();
    await seed();
    await imageMessage("alb-old", "album-conv", "album-c1", "images/alb-old.png", NOW, null, 1);
    await imageMessage(
      "alb-comic",
      "album-conv",
      "album-c1",
      "images/alb-comic.png",
      NOW + 2,
      "g-1",
      2,
    );
    await imageMessage("alb-video", "album-conv2", "album-c2", "videos/alb-video.mp4", NOW + 3);
    await imageMessage("alb-other", "album-other", "album-c1", "images/other.png", NOW + 4);
    await local.d1
      .prepare(
        "INSERT INTO v2_clip (id, user_id, character_id, model, prompt, status, video_key, created_at) VALUES ('alb-clip', 'local', 'album-c2', 'm', 'p', 'ok', 'videos/clip.mp4', ?)",
      )
      .bind(NOW + 5)
      .run();
    // 生成中・失敗のクリップは出ないことの確かめ
    await local.d1
      .prepare(
        "INSERT INTO v2_clip (id, user_id, character_id, model, prompt, status, created_at) VALUES ('alb-clip-ng', 'local', 'album-c2', 'm', 'p', 'queued', ?)",
      )
      .bind(NOW + 6)
      .run();
  }, 300_000);

  afterAll(async () => {
    await local.dispose();
  });

  it("本人の画像・漫画・クリップが新しい順で返り、他人の会話は出ない", async () => {
    const items = await listAlbumItems(local.d1, "local");
    const ids = items.map((item) => item.id);
    expect(ids).toEqual(["clip-alb-clip", "alb-video", "alb-comic", "alb-old"]);
    expect(ids).not.toContain("alb-other");
    expect(items.map((item) => item.kind)).toEqual(["clip", "clip", "comic", "image"]);
    expect(items[0].mediaUrl).toBe("/api/clip-media/alb-clip");
    expect(items[2].mediaUrl).toBe("/api/media/alb-comic");
    expect(items[1].characterName).toBe("さくら");
  });

  it("生成中・失敗のクリップは一覧に出ない", async () => {
    const items = await listAlbumItems(local.d1, "local");
    expect(items.map((item) => item.id)).not.toContain("clip-alb-clip-ng");
  });
});
