// クリップ生成（RIT-30 ギャップ: Saylo のショート動画）。創作センターが選んだ
// ギャラリー画像を first-frame に Runware videoInference へ渡し、出来た mp4 を
// R2 へ保存して v2_clip に記録する。会話に紐付かん単発生成なので
// v2_video_generation（会話依存）ではなく専用テーブル。課金はしない
// （個人利用・無制限運用。V2_UNLIMITED で既存経路も課金を抜けとる）。
import { createDb, listLegacySourceUserIds, loadCharacter } from "@v2/db";

import { ImageGenerationError } from "./image-generation";
import {
  findTaskItem,
  MOTION_HINT,
  runwareCall,
  uploadFrameImage,
  VIDEO_DURATION_SECONDS,
  VIDEO_MODEL,
  VIDEO_RESOLUTION,
  type VideoEnv,
} from "./video-generation";

export type ClipRow = {
  id: string;
  characterId: string;
  status: string;
  taskId: string | null;
  videoKey: string | null;
  playCount: number;
  failureReason: string | null;
};

const markClipFailed = async (db: D1Database, id: string, reason: string): Promise<void> => {
  await db
    .prepare(
      "UPDATE v2_clip SET status = 'failed', failure_reason = ?, finished_at = ? WHERE id = ?",
    )
    .bind(reason, Date.now(), id)
    .run();
};

// first-frame にするギャラリー画像。キャラの v2_image_generation 行が正本。
const readSourceImage = async (
  db: D1Database,
  characterId: string,
  imageGenerationId: string,
): Promise<{ imageKey: string; prompt: string }> => {
  const row = await db
    .prepare(
      "SELECT image_key AS imageKey, prompt FROM v2_image_generation " +
        "WHERE id = ? AND character_id = ? AND status = 'ok' AND image_key IS NOT NULL",
    )
    .bind(imageGenerationId, characterId)
    .first<{ imageKey: string; prompt: string }>();
  if (!row) throw new ImageGenerationError("元画像が見つかりません。", 404);
  return row;
};

const insertClip = async (
  db: D1Database,
  input: {
    id: string;
    userId: string;
    characterId: string;
    sourceGenerationId: string;
    taskId: string | null;
    prompt: string;
    status: "failed" | "processing";
    failureReason?: string;
  },
): Promise<void> => {
  const now = Date.now();
  await db
    .prepare(
      "INSERT INTO v2_clip (id, user_id, character_id, source_generation_id, task_id, model, " +
        "prompt, status, failure_reason, created_at, finished_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    )
    .bind(
      input.id,
      input.userId,
      input.characterId,
      input.sourceGenerationId,
      input.taskId,
      VIDEO_MODEL,
      input.prompt,
      input.status,
      input.failureReason ?? null,
      now,
      input.status === "failed" ? now : null,
    )
    .run();
};

export const startClipGeneration = async (input: {
  env: VideoEnv;
  userId: string;
  characterId: string;
  imageGenerationId: string;
  instruction?: string;
  fetchImpl?: typeof fetch;
}): Promise<{ clipId: string; status: string }> => {
  const { env } = input;
  if (!env.RUNWARE_API_KEY) {
    throw new ImageGenerationError("動画生成が設定されていません。", 503);
  }
  const db = createDb(env.DB);
  const owners = [input.userId, ...(await listLegacySourceUserIds(db))];
  const loaded = await loadCharacter(db, input.characterId, owners);
  if (!loaded.ok) {
    throw new ImageGenerationError("キャラクターが見つかりません。", 404);
  }
  const source = await readSourceImage(env.DB, input.characterId, input.imageGenerationId);
  const prompt = input.instruction?.trim()
    ? `${input.instruction.trim()}, ${MOTION_HINT}`
    : `${source.prompt}, ${MOTION_HINT}`;
  const clipId = crypto.randomUUID();
  const clipSeed = {
    id: clipId,
    userId: input.userId,
    characterId: input.characterId,
    sourceGenerationId: input.imageGenerationId,
    prompt,
  };
  const fail = async (reason: string): Promise<never> => {
    await insertClip(env.DB, {
      ...clipSeed,
      taskId: null,
      status: "failed",
      failureReason: reason,
    });
    throw new ImageGenerationError("動画を生成できませんでした。", 502);
  };

  const fetchImpl = input.fetchImpl ?? fetch;
  const mediaUUID = await uploadFrameImage(env, fetchImpl, source.imageKey).catch(
    async (uploadError) => {
      if (uploadError instanceof ImageGenerationError && uploadError.status === 404) {
        throw uploadError;
      }
      return await fail(uploadError instanceof Error ? uploadError.message : String(uploadError));
    },
  );

  const taskUUID = crypto.randomUUID();
  const { error } = await runwareCall(env, fetchImpl, {
    taskType: "videoInference",
    taskUUID,
    model: VIDEO_MODEL,
    positivePrompt: prompt,
    duration: VIDEO_DURATION_SECONDS,
    resolution: VIDEO_RESOLUTION,
    inputs: { frameImages: [{ image: mediaUUID, frame: "first" }] },
    deliveryMethod: "async",
    safety: { checkContent: false },
  });
  if (error) return await fail(error);
  await insertClip(env.DB, { ...clipSeed, taskId: taskUUID, status: "processing" });
  return { clipId, status: "processing" };
};

// 完了時: mp4 を取得して R2 の videos/ へ置き、clip 行を ok へ終端化する。
const finishClip = async (input: {
  env: VideoEnv;
  row: ClipRow;
  videoUrl: string;
  fetchImpl: typeof fetch;
}): Promise<void> => {
  const { env, row } = input;
  const response = await input.fetchImpl(input.videoUrl);
  if (!response.ok) throw new ImageGenerationError("動画の取得に失敗しました。", 502);
  const bytes = await response.arrayBuffer();
  const videoKey = `videos/${crypto.randomUUID()}.mp4`;
  await env.BUCKET.put(videoKey, bytes, { httpMetadata: { contentType: "video/mp4" } });
  await env.DB.prepare(
    "UPDATE v2_clip SET status = 'ok', video_key = ?, finished_at = ? WHERE id = ?",
  )
    .bind(videoKey, Date.now(), row.id)
    .run();
};

export type ClipPollResult = {
  clipId: string;
  status: string;
  videoUrl?: string;
  playCount?: number;
  failureReason?: string;
};

const toClipVideoUrl = (clipId: string, row: ClipRow): string | undefined =>
  row.status === "ok" && row.videoKey ? `/api/clip-media/${encodeURIComponent(clipId)}` : undefined;

const terminalClipResult = (row: ClipRow): ClipPollResult | null => {
  if (row.status === "ok") {
    return { clipId: row.id, status: "ok", videoUrl: toClipVideoUrl(row.id, row) };
  }
  if (row.status === "failed") {
    return { clipId: row.id, status: "failed", failureReason: row.failureReason ?? undefined };
  }
  if (!row.taskId) return { clipId: row.id, status: row.status };
  return null;
};

const readClip = async (db: D1Database, userId: string, clipId: string): Promise<ClipRow | null> =>
  db
    .prepare(
      "SELECT id, character_id AS characterId, status, task_id AS taskId, video_key AS videoKey, " +
        "play_count AS playCount, failure_reason AS failureReason " +
        "FROM v2_clip WHERE id = ? AND user_id = ?",
    )
    .bind(clipId, userId)
    .first<ClipRow>();

export const pollClipGeneration = async (input: {
  env: VideoEnv;
  userId: string;
  clipId: string;
  fetchImpl?: typeof fetch;
}): Promise<ClipPollResult> => {
  const { env } = input;
  const row = await readClip(env.DB, input.userId, input.clipId);
  if (!row) throw new ImageGenerationError("クリップが見つかりません。", 404);
  const terminal = terminalClipResult(row);
  if (terminal) return { ...terminal, playCount: row.playCount };

  const fetchImpl = input.fetchImpl ?? fetch;
  const { data, error } = await runwareCall(env, fetchImpl, {
    taskType: "getResponse",
    taskUUID: row.taskId as string,
  });
  if (error) {
    await markClipFailed(env.DB, row.id, error);
    return { clipId: row.id, status: "failed", failureReason: error };
  }
  const item = findTaskItem(data, "videoInference", row.taskId as string);
  const videoUrl = item && typeof item.videoURL === "string" ? item.videoURL : undefined;
  if (!videoUrl) {
    return { clipId: row.id, status: "processing" };
  }
  try {
    await finishClip({ env, row, videoUrl, fetchImpl });
  } catch (finishError) {
    const reason = finishError instanceof Error ? finishError.message : String(finishError);
    await markClipFailed(env.DB, row.id, reason);
    return { clipId: row.id, status: "failed", failureReason: reason };
  }
  return {
    clipId: row.id,
    status: "ok",
    videoUrl: `/api/clip-media/${encodeURIComponent(row.id)}`,
  };
};
