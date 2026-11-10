// RIT-30 ギャップ: クリップ生成の確かめ — Runware 模擬 fetch＋模擬 R2＋実 D1 で、
// 登録→ポーリング完了→R2 mp4・ok 記録が揃うこと、起動/ポーリング失敗で理由つき行が
// 残ること、再生数加算・他人のクリップを読めんことを見る。会話には紐付かん。
// @vitest-environment node
import { v2ConversationTable } from "@v2/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { openLocalD1, type LocalD1 } from "../../../../packages/db/src/test/local-d1";
import { characterTable } from "../../../../src/schema/character";

// api-clips は server fn 経由で platform（cloudflare:workers）を引くので、
// vitest では実 env に差し替える（api-publish.test.ts と同じ作法）。
vi.mock("./platform", () => ({
  getPlatform: async () => {
    throw new Error("platform is not available in tests");
  },
}));

import { listClipRows, listClippableImages } from "./api-clips";
import { pollClipGeneration, startClipGeneration } from "./clip-generation";

const NOW = 1794291000000;
const PNG_HEAD = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const MP4_HEAD = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);

type RunwareMode = "succeed" | "init-error" | "poll-error" | "slow";
type RunwareTask = { taskType: string; taskUUID?: string };

const videoInferenceResponse = (mode: RunwareMode, task: RunwareTask): Response => {
  if (mode === "init-error") {
    return Response.json({ errors: [{ taskUUID: task.taskUUID, message: "model rejected" }] });
  }
  return Response.json({ data: [] });
};

const getResponseResult = (mode: RunwareMode, task: RunwareTask): Response => {
  if (mode === "poll-error") {
    return Response.json({ errors: [{ taskUUID: task.taskUUID, message: "upstream died" }] });
  }
  if (mode === "slow") return Response.json({ data: [] });
  return Response.json({
    data: [
      {
        taskType: "videoInference",
        taskUUID: task.taskUUID,
        videoURL: "https://vm.runware.ai/video/x.mp4",
      },
    ],
  });
};

const runwareFetch = (mode: RunwareMode): typeof fetch => {
  const respond = (task: RunwareTask): Response => {
    if (task.taskType === "mediaStorage") {
      return Response.json({
        data: [{ taskType: "mediaStorage", taskUUID: task.taskUUID, mediaUUID: "media-uuid-1" }],
      });
    }
    if (task.taskType === "videoInference") return videoInferenceResponse(mode, task);
    return getResponseResult(mode, task);
  };
  const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === "https://vm.runware.ai/video/x.mp4") {
      return new Response(MP4_HEAD, { headers: { "content-type": "video/mp4" } });
    }
    const tasks = JSON.parse(String(init?.body)) as RunwareTask[];
    expect(tasks[0].taskType).toBe("authentication");
    const task = tasks.find((row) => row.taskType !== "authentication");
    if (!task) return new Response("unexpected", { status: 500 });
    return respond(task);
  });
  return impl as unknown as typeof fetch;
};

const bucketOf = () => {
  const stored = new Map<string, Uint8Array>([["images/clip-src.png", PNG_HEAD]]);
  return {
    stored,
    put: vi.fn(async (key: string, value: ArrayBuffer | Uint8Array) => {
      stored.set(key, new Uint8Array(value instanceof ArrayBuffer ? value : value));
      return { key } as unknown as R2Object;
    }),
    get: vi.fn(async (key: string) => {
      const bytes = stored.get(key);
      if (!bytes) return null;
      return {
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(bytes);
            controller.close();
          },
        }),
        arrayBuffer: async () => bytes.buffer.slice(0),
        httpMetadata: { contentType: key.endsWith(".mp4") ? "video/mp4" : "image/png" },
      } as unknown as R2Object;
    }),
  } as { stored: Map<string, Uint8Array> } & Pick<R2Bucket, "put" | "get">;
};

describe("クリップ生成", () => {
  let local: LocalD1;
  let charId: string;

  const env = (bucket: Pick<R2Bucket, "put" | "get">) => ({
    DB: local.d1,
    BUCKET: bucket as R2Bucket,
    RUNWARE_API_KEY: "test-key",
  });

  const clipRows = async () =>
    local.d1
      .prepare(
        "SELECT status, failure_reason, task_id, video_key, prompt, play_count, " +
          "source_generation_id FROM v2_clip WHERE user_id = 'local'",
      )
      .all<{
        status: string;
        failure_reason: string | null;
        task_id: string | null;
        video_key: string | null;
        prompt: string;
        play_count: number;
        source_generation_id: string | null;
      }>();

  beforeAll(async () => {
    local = await openLocalD1();
    const chars = await local.db.select({ id: characterTable.id }).from(characterTable).limit(1);
    charId = chars[0].id;
    // conversation_id は NOT NULL なので素材画像の親として会話を1本立てる。
    // （クリップ自体は会話に紐付かん。素材の記録は会話内生成が前提。）
    await local.db.insert(v2ConversationTable).values({
      id: "clip-conv",
      userId: "local",
      characterId: charId,
      title: "",
      threadId: "clip-conv",
      promptVersion: "test",
      createdAt: NOW,
      updatedAt: NOW,
    });
    // first-frame になる生成画像。クリップの元プロンプトはここから引く。
    await local.d1
      .prepare(
        "INSERT INTO v2_image_generation (id, conversation_id, character_id, message_id, task_id, " +
          "model, prompt, status, image_key, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
      )
      .bind(
        "clip-src-gen",
        "clip-conv",
        charId,
        "clip-src-msg",
        "task-src",
        "test-model",
        "silver hair, blue eyes, white dress",
        "ok",
        "images/clip-src.png",
        NOW,
      )
      .run();
  }, 60_000);

  beforeEach(async () => {
    await local.d1.prepare("DELETE FROM v2_clip WHERE user_id = 'local'").run();
  });

  afterAll(async () => {
    await local.d1.batch([
      local.d1.prepare("DELETE FROM v2_clip WHERE user_id = 'local'"),
      local.d1.prepare("DELETE FROM v2_image_generation WHERE id = ?").bind("clip-src-gen"),
      local.d1.prepare("DELETE FROM v2_conversation WHERE id = ?").bind("clip-conv"),
    ]);
    await local.dispose();
  });

  it("登録→ポーリング完了: mp4 が R2 へ入り ok 記録と videoUrl が残る", async () => {
    const bucket = bucketOf();
    const started = await startClipGeneration({
      env: env(bucket),
      userId: "local",
      characterId: charId,
      imageGenerationId: "clip-src-gen",
      fetchImpl: runwareFetch("succeed"),
    });
    expect(started.status).toBe("processing");
    const queued = (await clipRows()).results;
    expect(queued).toHaveLength(1);
    expect(queued[0].status).toBe("processing");
    expect(queued[0].task_id).toBeTruthy();
    expect(queued[0].source_generation_id).toBe("clip-src-gen");
    expect(queued[0].prompt).toContain("silver hair");

    const finished = await pollClipGeneration({
      env: env(bucket),
      userId: "local",
      clipId: started.clipId,
      fetchImpl: runwareFetch("succeed"),
    });
    expect(finished.status).toBe("ok");
    expect(finished.videoUrl).toBe(`/api/clip-media/${started.clipId}`);
    const rows = (await clipRows()).results;
    expect(rows[0].status).toBe("ok");
    expect(rows[0].video_key).toMatch(/^videos\/[\da-f-]+\.mp4$/);
    expect(bucket.stored.has(rows[0].video_key as string)).toBe(true);
  });

  it("動きの指定を足すとプロンプトが差し替わる", async () => {
    const started = await startClipGeneration({
      env: env(bucketOf()),
      userId: "local",
      characterId: charId,
      imageGenerationId: "clip-src-gen",
      instruction: "ゆっくり振り向く",
      fetchImpl: runwareFetch("succeed"),
    });
    const rows = (await clipRows()).results;
    expect(rows[0].prompt).toContain("ゆっくり振り向く");
    expect(rows[0].prompt).not.toContain("silver hair");
    expect(started.status).toBe("processing");
  });

  it("生成中のポーリングは processing を返す", async () => {
    const bucket = bucketOf();
    const started = await startClipGeneration({
      env: env(bucket),
      userId: "local",
      characterId: charId,
      imageGenerationId: "clip-src-gen",
      fetchImpl: runwareFetch("slow"),
    });
    const polled = await pollClipGeneration({
      env: env(bucket),
      userId: "local",
      clipId: started.clipId,
      fetchImpl: runwareFetch("slow"),
    });
    expect(polled.status).toBe("processing");
    expect((await clipRows()).results[0].status).toBe("processing");
  });

  it("上流の失敗は理由つき failed 行になる", async () => {
    const bucket = bucketOf();
    const started = await startClipGeneration({
      env: env(bucket),
      userId: "local",
      characterId: charId,
      imageGenerationId: "clip-src-gen",
      fetchImpl: runwareFetch("poll-error"),
    });
    const polled = await pollClipGeneration({
      env: env(bucket),
      userId: "local",
      clipId: started.clipId,
      fetchImpl: runwareFetch("poll-error"),
    });
    expect(polled.status).toBe("failed");
    expect(polled.failureReason).toBe("upstream died");
    expect((await clipRows()).results[0].status).toBe("failed");
  });

  it("videoInference の起動失敗も failed 行を残す", async () => {
    await expect(
      startClipGeneration({
        env: env(bucketOf()),
        userId: "local",
        characterId: charId,
        imageGenerationId: "clip-src-gen",
        fetchImpl: runwareFetch("init-error"),
      }),
    ).rejects.toMatchObject({ status: 502 });
    const rows = (await clipRows()).results;
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("failed");
    expect(rows[0].failure_reason).toBe("model rejected");
  });

  it("存在しない生成画像・他キャラの画像・存在しないキャラはエラー", async () => {
    await expect(
      startClipGeneration({
        env: env(bucketOf()),
        userId: "local",
        characterId: charId,
        imageGenerationId: "not-exists",
        fetchImpl: runwareFetch("succeed"),
      }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      startClipGeneration({
        env: env(bucketOf()),
        userId: "local",
        characterId: "not-a-character",
        imageGenerationId: "clip-src-gen",
        fetchImpl: runwareFetch("succeed"),
      }),
    ).rejects.toMatchObject({ status: 404 });
    // 対象が無い時は行も残さん。
    expect((await clipRows()).results).toHaveLength(0);
  });

  it("Runware キー未設定なら 503", async () => {
    await expect(
      startClipGeneration({
        env: { DB: local.d1, BUCKET: bucketOf() as unknown as R2Bucket },
        userId: "local",
        characterId: charId,
        imageGenerationId: "clip-src-gen",
        fetchImpl: runwareFetch("succeed"),
      }),
    ).rejects.toMatchObject({ status: 503 });
  });

  it("再生数が加算され、一覧へ playCount と videoUrl が出る", async () => {
    const bucket = bucketOf();
    const started = await startClipGeneration({
      env: env(bucket),
      userId: "local",
      characterId: charId,
      imageGenerationId: "clip-src-gen",
      fetchImpl: runwareFetch("succeed"),
    });
    await pollClipGeneration({
      env: env(bucket),
      userId: "local",
      clipId: started.clipId,
      fetchImpl: runwareFetch("succeed"),
    });
    // POST /api/clips/:id/play と同じ加算
    for (let i = 0; i < 3; i += 1) {
      await local.d1
        .prepare(
          "UPDATE v2_clip SET play_count = play_count + 1 WHERE id = ? AND user_id = ? AND status = 'ok'",
        )
        .bind(started.clipId, "local")
        .run();
    }
    const items = await listClipRows(local.d1, "local");
    expect(items).toHaveLength(1);
    expect(items[0].playCount).toBe(3);
    expect(items[0].characterName).toBeTruthy();
    expect(items[0].videoUrl).toBe(`/api/clip-media/${started.clipId}`);
  });

  it("他人のクリップは poll も一覧も見えない", async () => {
    const bucket = bucketOf();
    const started = await startClipGeneration({
      env: env(bucket),
      userId: "local",
      characterId: charId,
      imageGenerationId: "clip-src-gen",
      fetchImpl: runwareFetch("succeed"),
    });
    await expect(
      pollClipGeneration({
        env: env(bucket),
        userId: "someone-else",
        clipId: started.clipId,
        fetchImpl: runwareFetch("succeed"),
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(await listClipRows(local.d1, "someone-else")).toHaveLength(0);
  });

  it("素材一覧は生成済み画像だけを出す", async () => {
    const images = await listClippableImages(local.d1, charId);
    expect(images.map((row) => row.imageGenerationId)).toContain("clip-src-gen");
    const src = images.find((row) => row.imageGenerationId === "clip-src-gen")!;
    expect(src.imageUrl).toBe(`/api/media/${src.messageId}`);
    expect(await listClippableImages(local.d1, "not-a-character")).toHaveLength(0);
  });
});
