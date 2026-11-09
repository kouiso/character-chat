// RIT-190: 画像→動画変換の確かめ — Runware 模擬 fetch＋模擬 R2＋実 D1 で、
// 依頼登録→ポーリング完了→R2 mp4・動画メッセージ・生成記録が揃うこと、
// 起動失敗・ポーリング失敗で理由つき行が残ることを見る。
// @vitest-environment node
import { v2ConversationTable, v2MessageTable } from "@v2/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { openLocalD1, type LocalD1 } from "../../../../packages/db/src/test/local-d1";
import { characterTable } from "../../../../src/schema/character";

import { pollVideoGeneration, startVideoGeneration } from "./video-generation";

const NOW = 1794290000000;
const PNG_HEAD = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const MP4_HEAD = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);

type RunwareMode = "succeed" | "init-error" | "poll-error" | "slow";

type RunwareTask = { taskType: string; taskUUID?: string };

const videoInferenceResponse = (mode: RunwareMode, task: RunwareTask): Response => {
  if (mode === "init-error") {
    return Response.json({ errors: [{ taskUUID: task.taskUUID, message: "model rejected" }] });
  }
  // 受入条件: NSFW 判定はリクエストで明示する（checkContent=false が送られること）。
  expect((task as { safety?: { checkContent?: boolean } }).safety?.checkContent).toBe(false);
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
        cost: 0.512,
      },
    ],
  });
};

// Runware REST は認証＋タスクの配列 POST。taskType ごとに返答を切り替える。
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
  const stored = new Map<string, Uint8Array>([["images/rit190-src.png", PNG_HEAD]]);
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

describe("画像→動画変換", () => {
  let local: LocalD1;
  let charId: string;

  const env = (bucket: Pick<R2Bucket, "put" | "get">) => ({
    DB: local.d1,
    BUCKET: bucket as R2Bucket,
    RUNWARE_API_KEY: "test-key",
  });

  const videoRows = async () =>
    local.d1
      .prepare(
        "SELECT status, failure_reason, task_id, message_id, video_key, cost_usd, prompt, " +
          "source_message_id, duration_seconds, resolution FROM v2_video_generation " +
          "WHERE conversation_id = ?",
      )
      .bind("rit190-conv")
      .all<{
        status: string;
        failure_reason: string | null;
        task_id: string | null;
        message_id: string | null;
        video_key: string | null;
        cost_usd: number | null;
        prompt: string;
        source_message_id: string | null;
        duration_seconds: number;
        resolution: string;
      }>();

  const videoMessages = async () =>
    local.d1
      .prepare(
        "SELECT id, turn, image_key, content FROM v2_message WHERE image_key LIKE 'videos/%'",
      )
      .all<{ id: string; turn: number; image_key: string; content: string }>();

  beforeAll(async () => {
    local = await openLocalD1();
    const chars = await local.db.select({ id: characterTable.id }).from(characterTable).limit(1);
    charId = chars[0].id;
    await local.db.insert(v2ConversationTable).values({
      id: "rit190-conv",
      userId: "local",
      characterId: charId,
      title: "",
      threadId: "rit190-conv",
      promptVersion: "test",
      createdAt: NOW,
      updatedAt: NOW,
    });
    // 元画像メッセージ＋その生成記録（動画プロンプトはここから引く）。
    await local.db.insert(v2MessageTable).values({
      id: "rit190-src",
      conversationId: "rit190-conv",
      turn: 2,
      role: "assistant",
      content: "（画像を生成した）",
      imageKey: "images/rit190-src.png",
      createdAt: NOW,
    });
    await local.d1
      .prepare(
        "INSERT INTO v2_image_generation (id, conversation_id, character_id, message_id, task_id, " +
          "model, prompt, status, image_key, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
      )
      .bind(
        "rit190-gen-src",
        "rit190-conv",
        charId,
        "rit190-src",
        "task-src",
        "test-model",
        "silver hair, blue eyes, white dress",
        "ok",
        "images/rit190-src.png",
        NOW,
      )
      .run();
  }, 60_000);

  beforeEach(async () => {
    await local.d1
      .prepare("DELETE FROM v2_video_generation WHERE conversation_id = ?")
      .bind("rit190-conv")
      .run();
    await local.d1.prepare("DELETE FROM v2_message WHERE image_key LIKE 'videos/%'").run();
  });

  afterAll(async () => {
    await local.d1.batch([
      local.d1
        .prepare("DELETE FROM v2_video_generation WHERE conversation_id = ?")
        .bind("rit190-conv"),
      local.d1
        .prepare("DELETE FROM v2_image_generation WHERE conversation_id = ?")
        .bind("rit190-conv"),
      local.d1.prepare("DELETE FROM v2_message WHERE conversation_id = ?").bind("rit190-conv"),
      local.d1.prepare("DELETE FROM v2_conversation WHERE id = ?").bind("rit190-conv"),
    ]);
    await local.dispose();
  });

  it("登録→ポーリング完了: mp4 が R2 へ入り、動画メッセージと ok 記録が残る", async () => {
    const bucket = bucketOf();
    const started = await startVideoGeneration({
      env: env(bucket),
      characterId: charId,
      conversationId: "rit190-conv",
      sourceMessageId: "rit190-src",
      fetchImpl: runwareFetch("succeed"),
    });
    expect(started.status).toBe("processing");
    const queued = (await videoRows()).results;
    expect(queued).toHaveLength(1);
    expect(queued[0].status).toBe("processing");
    expect(queued[0].task_id).toBeTruthy();
    expect(queued[0].source_message_id).toBe("rit190-src");
    expect(queued[0].prompt).toContain("silver hair");
    expect(queued[0].duration_seconds).toBe(5);
    expect(queued[0].resolution).toBe("720p");

    const finished = await pollVideoGeneration({
      env: env(bucket),
      characterId: charId,
      generationId: started.generationId,
      fetchImpl: runwareFetch("succeed"),
    });
    expect(finished.status).toBe("ok");
    expect(finished.messageId).toBeTruthy();
    expect(finished.videoUrl).toBe(`/api/media/${finished.messageId}`);

    const rows = (await videoRows()).results;
    expect(rows[0].status).toBe("ok");
    expect(rows[0].video_key).toMatch(/^videos\/[\da-f-]+\.mp4$/);
    expect(rows[0].cost_usd).toBeCloseTo(0.512);
    const messages = (await videoMessages()).results;
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe("（動画を生成した）");
    expect(bucket.stored.has(rows[0].video_key as string)).toBe(true);
  });

  it("生成中のポーリングは processing を返し、行もそのまま", async () => {
    const bucket = bucketOf();
    const started = await startVideoGeneration({
      env: env(bucket),
      characterId: charId,
      conversationId: "rit190-conv",
      sourceMessageId: "rit190-src",
      fetchImpl: runwareFetch("slow"),
    });
    const polled = await pollVideoGeneration({
      env: env(bucket),
      characterId: charId,
      generationId: started.generationId,
      fetchImpl: runwareFetch("slow"),
    });
    expect(polled.status).toBe("processing");
    expect((await videoRows()).results[0].status).toBe("processing");
  });

  it("上流の失敗は理由つき failed 行になる", async () => {
    const bucket = bucketOf();
    const started = await startVideoGeneration({
      env: env(bucket),
      characterId: charId,
      conversationId: "rit190-conv",
      sourceMessageId: "rit190-src",
      fetchImpl: runwareFetch("poll-error"),
    });
    const polled = await pollVideoGeneration({
      env: env(bucket),
      characterId: charId,
      generationId: started.generationId,
      fetchImpl: runwareFetch("poll-error"),
    });
    expect(polled.status).toBe("failed");
    expect(polled.failureReason).toBe("upstream died");
    expect((await videoRows()).results[0].status).toBe("failed");
    // 失敗では動画メッセージを増やさん。
    expect((await videoMessages()).results).toHaveLength(0);
  });

  it("videoInference の起動失敗も failed 行を残す", async () => {
    await expect(
      startVideoGeneration({
        env: env(bucketOf()),
        characterId: charId,
        conversationId: "rit190-conv",
        sourceMessageId: "rit190-src",
        fetchImpl: runwareFetch("init-error"),
      }),
    ).rejects.toMatchObject({ status: 502 });
    const rows = (await videoRows()).results;
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("failed");
    expect(rows[0].failure_reason).toBe("model rejected");
  });

  it("元画像の無いメッセージ・画像なしメッセージは 404", async () => {
    await expect(
      startVideoGeneration({
        env: env(bucketOf()),
        characterId: charId,
        conversationId: "rit190-conv",
        sourceMessageId: "not-exists",
        fetchImpl: runwareFetch("succeed"),
      }),
    ).rejects.toMatchObject({ status: 404 });
    // 失敗行も残さん（対象が無いので記録も要らん）。
    expect((await videoRows()).results).toHaveLength(0);
  });

  it("Runware キー未設定なら 503", async () => {
    const envNoKey = { DB: local.d1, BUCKET: bucketOf() as unknown as R2Bucket };
    await expect(
      startVideoGeneration({
        env: envNoKey,
        characterId: charId,
        conversationId: "rit190-conv",
        sourceMessageId: "rit190-src",
        fetchImpl: runwareFetch("succeed"),
      }),
    ).rejects.toMatchObject({ status: 503 });
  });
});
