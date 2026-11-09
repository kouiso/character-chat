// RIT-182: 会話起点の画像生成の確かめ — Novita 模擬 fetch＋模擬 R2＋実 D1 で、
// 成功時に画像が R2 へ入り image_key 付きメッセージと生成記録が残ること、
// 失敗時に理由つき記録だけが残ることを見る。
// @vitest-environment node
import { v2ConversationTable, v2MessageTable } from "@v2/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { openLocalD1, type LocalD1 } from "../../../../packages/db/src/test/local-d1";
import { characterTable } from "../../../../src/schema/character";

import { buildImagePrompt, generateConversationImage } from "./image-generation";

const NOW = 1794290000000;
const PNG_HEAD = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

const novitaFetch = (taskStatus: string, includeImages = true): typeof fetch => {
  const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.endsWith("/txt2img")) {
      expect(init?.method).toBe("POST");
      return Response.json({ task_id: "rit182-task" });
    }
    if (url.includes("/task-result")) {
      return Response.json({
        task: { task_id: "rit182-task", status: taskStatus, progress_percent: 100 },
        ...(includeImages
          ? { images: [{ image_url: "https://example.com/rit182.png", seed: 12345 }] }
          : {}),
      });
    }
    if (url === "https://example.com/rit182.png") {
      return new Response(PNG_HEAD, { headers: { "content-type": "image/png" } });
    }
    return new Response("unexpected", { status: 500 });
  });
  return impl as unknown as typeof fetch;
};

const bucketOf = () => {
  const stored = new Map<string, Uint8Array>();
  return {
    stored,
    put: (async (key: string, value: ArrayBuffer | Uint8Array) => {
      stored.set(key, value instanceof Uint8Array ? value : new Uint8Array(value));
      return { key };
    }) as unknown as R2Bucket["put"],
  } as { stored: Map<string, Uint8Array>; put: R2Bucket["put"] } & Pick<R2Bucket, "put">;
};

describe("generateConversationImage", () => {
  let local: LocalD1;
  let charId: string;

  const env = (bucket: Pick<R2Bucket, "put">) => ({
    DB: local.d1,
    BUCKET: bucket as R2Bucket,
    NOVITA_API_KEY: "test-key",
  });

  const imageMessages = async () =>
    local.d1
      .prepare("SELECT id, turn, image_key FROM v2_message WHERE image_key IS NOT NULL")
      .all<{ id: string; turn: number; image_key: string }>();

  const generationRows = async () =>
    local.d1
      .prepare(
        "SELECT status, failure_reason, task_id, seed, image_key, message_id FROM v2_image_generation WHERE conversation_id = ?",
      )
      .bind("rit182-conv")
      .all<{
        status: string;
        failure_reason: string | null;
        task_id: string | null;
        seed: number | null;
        image_key: string | null;
        message_id: string | null;
      }>();

  beforeAll(async () => {
    local = await openLocalD1();
    const chars = await local.db
      .select({ id: characterTable.id, imageMeta: characterTable.imageMeta })
      .from(characterTable)
      .limit(1);
    charId = chars[0].id;
    if (!chars[0].imageMeta) {
      // seed キャラに外見が無い時だけ補う。確かめの都合で prompt 組立対象が必要なため。
      await local.d1
        .prepare("UPDATE character SET image_meta = ? WHERE id = ?")
        .bind(
          JSON.stringify({
            appearance: "long silver hair, blue eyes",
            artStyle: "anime style",
            outfit: "white dress",
            negativePrompt: "extra fingers",
          }),
          charId,
        )
        .run();
    }
    await local.db.insert(v2ConversationTable).values({
      id: "rit182-conv",
      userId: "local",
      characterId: charId,
      title: "",
      threadId: "rit182-conv",
      promptVersion: "test",
      createdAt: NOW,
      updatedAt: NOW,
    });
    await local.db.insert(v2MessageTable).values({
      id: "rit182-msg-1",
      conversationId: "rit182-conv",
      turn: 1,
      role: "assistant",
      content: "海辺を歩きながら微笑んだ。潮風が髪を揺らす。",
      createdAt: NOW,
    });
  });

  afterAll(async () => {
    await local.d1.batch([
      local.d1
        .prepare("DELETE FROM v2_image_generation WHERE conversation_id = ?")
        .bind("rit182-conv"),
      local.d1.prepare("DELETE FROM v2_message WHERE conversation_id = ?").bind("rit182-conv"),
      local.d1.prepare("DELETE FROM v2_conversation WHERE id = ?").bind("rit182-conv"),
    ]);
    await local.dispose();
  });

  it("成功: R2 へ画像を置き、image_key 付きメッセージと生成記録が残る", async () => {
    const bucket = bucketOf();
    const result = await generateConversationImage({
      env: env(bucket),
      characterId: charId,
      conversationId: "rit182-conv",
      fetchImpl: novitaFetch("TASK_STATUS_SUCCEED"),
    });
    expect(result.ok).toBe(true);
    const messages = (await imageMessages()).results;
    expect(messages).toHaveLength(1);
    expect(messages[0].image_key).toMatch(/^images\/[\da-f-]+\.png$/);
    expect(bucket.stored.get(messages[0].image_key)).toEqual(PNG_HEAD);
    const rows = (await generationRows()).results;
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("ok");
    expect(rows[0].task_id).toBe("rit182-task");
    expect(rows[0].seed).toBe(12345);
    expect(rows[0].message_id).toBe(messages[0].id);
    // 画像はターンを1つ消費する（次の会話ターンが重ならんよう）。
    expect(messages[0].turn).toBe(2);
  });

  it("失敗: 理由つき記録だけ残り、メッセージは出さん", async () => {
    const bucket = bucketOf();
    const result = await generateConversationImage({
      env: env(bucket),
      characterId: charId,
      conversationId: "rit182-conv",
      fetchImpl: novitaFetch("TASK_STATUS_FAILED"),
    });
    expect(result.ok).toBe(false);
    const messages = (await imageMessages()).results;
    expect(messages).toHaveLength(1); // 前の成功分のみ
    const rows = (await generationRows()).results;
    const failed = rows.filter((row) => row.status === "failed");
    expect(failed).toHaveLength(1);
    expect(failed[0].failure_reason).toContain("TASK_STATUS_FAILED");
    expect(failed[0].task_id).toBe("rit182-task");
    expect(bucket.stored.size).toBe(0);
  });

  it("他人の会話は弾く", async () => {
    await local.db.insert(v2ConversationTable).values({
      id: "rit182-foreign",
      userId: "someone-else",
      characterId: charId,
      title: "",
      threadId: "rit182-foreign",
      promptVersion: "test",
      createdAt: NOW,
      updatedAt: NOW,
    });
    await expect(
      generateConversationImage({
        env: env(bucketOf()),
        characterId: charId,
        conversationId: "rit182-foreign",
        fetchImpl: novitaFetch("TASK_STATUS_SUCCEED"),
      }),
    ).rejects.toThrow();
    await local.d1.prepare("DELETE FROM v2_conversation WHERE id = ?").bind("rit182-foreign").run();
  });
});

describe("buildImagePrompt", () => {
  it("外見 anchor・衣装・シーンを1本の prompt に組み、negative を合わせる", () => {
    const { prompt, negativePrompt } = buildImagePrompt(
      {
        visualPrompt: "soft lighting",
        imageMeta: {
          appearance: "silver hair",
          artStyle: "anime",
          outfit: "white dress",
          negativePrompt: "extra limbs",
        },
      },
      [{ role: "assistant", content: "浜辺で微笑む" }],
    );
    expect(prompt).toContain("anime");
    expect(prompt).toContain("silver hair");
    expect(prompt).toContain("white dress");
    expect(prompt).toContain("soft lighting");
    expect(prompt).toContain("浜辺で微笑む");
    expect(negativePrompt).toContain("extra limbs");
    expect(negativePrompt).toContain("lowres");
  });
});
