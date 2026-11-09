// 画像→動画変換（RIT-190）。ギャラリーの画像を first-frame に Runware videoInference（Wan）へ
// 渡し、出来た mp4 を R2 へ保存して v2_message + v2_video_generation に記録する。
// 動画は数分掛かるので POST は依頼の登録だけを済ませ、GET で getResponse を逐次ポーリングして
// 完了・失敗へ終端化する。失敗行は理由を残す（将来の返金 RIT-188・課金台帳 RIT-135 の突合基）。
import {
  createDb,
  listLegacySourceUserIds,
  loadCharacter,
  readDisplayHistory,
  v2VideoGenerationTable,
} from "@v2/db";
import { PROMPT_VERSION } from "@v2/prompt";

import { CurrencyError } from "./currency";
import { chargeGeneration, refundGenerationBestEffort } from "./generation-billing";
import { ImageGenerationError } from "./image-generation";

// Wan 3.0: 720p $0.10/s。5秒で約 $0.50（上流実績 cost も行へ残す）。
export const VIDEO_MODEL = "alibaba:wan@3.0";
export const VIDEO_DURATION_SECONDS = 5;
export const VIDEO_RESOLUTION = "720p";
const RUNWARE_REQUEST_TIMEOUT_MS = 15_000;
// 動き指示は短く保つ（画像側 anchor の後ろへ付ける。長文は Wan のプロンプト上限を圧迫する）。
export const MOTION_HINT =
  "gentle natural motion, subtle expression change, breathing, slight hair movement, cinematic";

export type VideoEnv = {
  DB: D1Database;
  BUCKET: R2Bucket;
  RUNWARE_API_KEY?: string;
  RUNWARE_API_BASE?: string;
};

const withTimeout = (timeoutMs: number): AbortController => {
  const controller = new AbortController();
  setTimeout(() => controller.abort("runware_request_timeout"), timeoutMs);
  return controller;
};

const apiBase = (env: VideoEnv): string =>
  `${(env.RUNWARE_API_BASE ?? "https://api.runware.ai").replace(/\/$/u, "")}/v1`;

const requireApiKey = (env: VideoEnv): string => {
  if (env.RUNWARE_API_KEY) return env.RUNWARE_API_KEY;
  throw new ImageGenerationError("動画生成が設定されていません。", 503);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const firstErrorMessage = (errors: unknown): string | undefined => {
  if (!Array.isArray(errors) || errors.length === 0) return undefined;
  const first = errors[0];
  if (!isRecord(first)) return undefined;
  if (typeof first.message === "string") return first.message;
  if (typeof first.code === "string") return first.code;
  return undefined;
};

// Runware REST は認証タスクを並べた配列を POST する形（v1 runware-provider と同じ）。
export const runwareCall = async (
  env: VideoEnv,
  fetchImpl: typeof fetch,
  task: Record<string, unknown>,
): Promise<{ data: Record<string, unknown>[]; error?: string }> => {
  const apiKey = requireApiKey(env);
  const response = await fetchImpl(apiBase(env), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify([{ taskType: "authentication", apiKey }, task]),
    signal: withTimeout(RUNWARE_REQUEST_TIMEOUT_MS).signal,
  });
  if (!response.ok) {
    return { data: [], error: `runware http ${response.status}` };
  }
  const payload: unknown = await response.json();
  if (!isRecord(payload)) return { data: [], error: "runware malformed payload" };
  const data = Array.isArray(payload.data) ? payload.data.filter(isRecord) : [];
  const message = firstErrorMessage(payload.errors);
  if (Array.isArray(payload.errors) && payload.errors.length > 0) {
    return { data, error: message ?? "runware task error" };
  }
  return { data };
};

export const findTaskItem = (
  data: Record<string, unknown>[],
  taskType: string,
  taskUUID: string,
): Record<string, unknown> | undefined =>
  data.find((item) => item.taskType === taskType && item.taskUUID === taskUUID);

// R2 の画像を Runware メディアストレージへ data URI で送り、frameImages 用の UUID を得る。
export const uploadFrameImage = async (
  env: VideoEnv,
  fetchImpl: typeof fetch,
  imageKey: string,
): Promise<string> => {
  const object = await env.BUCKET.get(imageKey);
  if (!object) throw new ImageGenerationError("元画像が見つかりません。", 404);
  const bytes = new Uint8Array(await object.arrayBuffer());
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const contentType = object.httpMetadata?.contentType ?? "image/png";
  const taskUUID = crypto.randomUUID();
  const { data, error } = await runwareCall(env, fetchImpl, {
    taskType: "mediaStorage",
    taskUUID,
    operation: "upload",
    media: `data:${contentType};base64,${btoa(binary)}`,
  });
  const item = findTaskItem(data, "mediaStorage", taskUUID);
  const mediaUUID = item && typeof item.mediaUUID === "string" ? item.mediaUUID : undefined;
  if (error || !mediaUUID) {
    throw new ImageGenerationError(`動画生成の元画像を送れませんでした。${error ?? ""}`, 502);
  }
  return mediaUUID;
};

// 動画の本文: 元画像の生成プロンプト（身元 anchor 入り）→ 無ければ依頼文 → 素の動き指示。
const buildVideoPrompt = async (
  db: D1Database,
  sourceMessageId: string,
  instruction?: string,
): Promise<string> => {
  const row = await db
    .prepare(
      "SELECT prompt FROM v2_image_generation WHERE message_id = ? ORDER BY created_at DESC LIMIT 1",
    )
    .bind(sourceMessageId)
    .first<{ prompt: string }>();
  const base = instruction?.trim() || row?.prompt || "";
  return base ? `${base}, ${MOTION_HINT}` : MOTION_HINT;
};

type GenerationRow = {
  id: string;
  conversationId: string;
  characterId: string;
  status: string;
  taskId: string | null;
  messageId: string | null;
  failureReason: string | null;
};

// 生成課金（RIT-188）。上流へ投げる前に spend。残高不足は 409 で登録自体をしない。
const chargeOrThrow = async (env: VideoEnv, generationId: string): Promise<void> => {
  try {
    await chargeGeneration(env.DB, { userId: "local", generationId, kind: "video" });
  } catch (error) {
    if (error instanceof CurrencyError) {
      throw new ImageGenerationError(error.message, error.status);
    }
    throw error;
  }
};

const markFailed = async (db: D1Database, id: string, reason: string): Promise<void> => {
  await db
    .prepare(
      "UPDATE v2_video_generation SET status = 'failed', failure_reason = ?, finished_at = ? " +
        "WHERE id = ?",
    )
    .bind(reason, Date.now(), id)
    .run();
  // 開始時に charge 済みの行だけここへ来る。失敗は同額を台帳へ返す（RIT-188）。
  await refundGenerationBestEffort(db, { userId: "local", generationId: id, kind: "video" });
};

const baseRow = (input: {
  generationId: string;
  conversationId: string;
  characterId: string;
  sourceMessageId: string;
  taskId: string | null;
  prompt: string;
}) => ({
  id: input.generationId,
  conversationId: input.conversationId,
  characterId: input.characterId,
  sourceMessageId: input.sourceMessageId,
  taskId: input.taskId,
  model: VIDEO_MODEL,
  prompt: input.prompt,
  durationSeconds: VIDEO_DURATION_SECONDS,
  resolution: VIDEO_RESOLUTION,
});

export const startVideoGeneration = async (input: {
  env: VideoEnv;
  characterId: string;
  conversationId: string;
  sourceMessageId: string;
  instruction?: string;
  fetchImpl?: typeof fetch;
}): Promise<{ generationId: string; status: string }> => {
  const { env } = input;
  // キー未設定は設定欠陥なので、記録行を残さず先に 503 を返す。
  requireApiKey(env);
  const db = createDb(env.DB);
  const owners = ["local", ...(await listLegacySourceUserIds(db))];
  const loaded = await loadCharacter(db, input.characterId, owners);
  if (!loaded.ok) {
    throw new ImageGenerationError("会話またはキャラクターが見つかりません。", 404);
  }
  const source = await env.DB.prepare(
    "SELECT image_key AS imageKey FROM v2_message WHERE id = ? AND conversation_id = ?",
  )
    .bind(input.sourceMessageId, input.conversationId)
    .first<{ imageKey: string | null }>();
  if (!source?.imageKey) {
    throw new ImageGenerationError("元画像が見つかりません。", 404);
  }
  const prompt = await buildVideoPrompt(env.DB, input.sourceMessageId, input.instruction);
  const generationId = crypto.randomUUID();
  const base = baseRow({
    generationId,
    conversationId: input.conversationId,
    characterId: input.characterId,
    sourceMessageId: input.sourceMessageId,
    taskId: null,
    prompt,
  });
  const fail = async (reason: string): Promise<never> => {
    await db.insert(v2VideoGenerationTable).values({
      ...base,
      status: "failed",
      failureReason: reason,
      createdAt: Date.now(),
      finishedAt: Date.now(),
    });
    // charge 済みの失敗なので同額を返却（RIT-188）。
    await refundGenerationBestEffort(env.DB, {
      userId: "local",
      generationId,
      kind: "video",
    });
    throw new ImageGenerationError("動画を生成できませんでした。", 502);
  };

  // 生成課金（RIT-188）。上流へ投げる前に spend。残高不足は 409 で登録自体をしない。
  await chargeOrThrow(env, generationId);

  const fetchImpl = input.fetchImpl ?? fetch;
  let mediaUUID: string;
  try {
    mediaUUID = await uploadFrameImage(env, fetchImpl, source.imageKey);
  } catch (error) {
    if (error instanceof ImageGenerationError && error.status === 404) throw error;
    return await fail(error instanceof Error ? error.message : String(error));
  }

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
    // 受入条件: NSFW 判定はリクエストで明示する。上流既定のフィルタには依存しない。
    safety: { checkContent: false },
  });
  if (error) return await fail(error);
  await db.insert(v2VideoGenerationTable).values({
    ...base,
    taskId: taskUUID,
    status: "processing",
    createdAt: Date.now(),
  });
  return { generationId, status: "processing" };
};

// 完了時: mp4 を取得して R2 へ置き、動画メッセージと生成行の更新を1バッチで書く。
const finishVideo = async (input: {
  env: VideoEnv;
  db: ReturnType<typeof createDb>;
  row: GenerationRow;
  videoUrl: string;
  costUsd: number | null;
  fetchImpl: typeof fetch;
}): Promise<void> => {
  const { env, db, row } = input;
  const response = await input.fetchImpl(input.videoUrl);
  if (!response.ok) throw new ImageGenerationError("動画の取得に失敗しました。", 502);
  const bytes = await response.arrayBuffer();
  const videoKey = `videos/${crypto.randomUUID()}.mp4`;
  await env.BUCKET.put(videoKey, bytes, { httpMetadata: { contentType: "video/mp4" } });
  const display = await readDisplayHistory(
    db,
    { userId: "local", characterId: row.characterId, promptVersion: PROMPT_VERSION },
    row.conversationId,
  );
  const messageId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO v2_message (id, conversation_id, turn, role, content, image_key, created_at) " +
        "VALUES (?,?,?,?,?,?,?)",
    ).bind(
      messageId,
      row.conversationId,
      display.turn,
      "assistant",
      "（動画を生成した）",
      videoKey,
      Date.now(),
    ),
    env.DB.prepare(
      "UPDATE v2_video_generation SET status = 'ok', message_id = ?, video_key = ?, " +
        "cost_usd = ?, finished_at = ? WHERE id = ?",
    ).bind(messageId, videoKey, input.costUsd, Date.now(), row.id),
  ]);
};

const toVideoUrl = (messageId: string | null): string | undefined =>
  messageId ? `/api/media/${encodeURIComponent(messageId)}` : undefined;

type PollResult = {
  generationId: string;
  status: string;
  messageId?: string;
  videoUrl?: string;
  failureReason?: string;
};

// 終端（ok/failed）・未起動の行は上流へ問い合わせずそのまま返す。
const terminalResult = (row: GenerationRow): PollResult | null => {
  if (row.status === "ok") {
    return {
      generationId: row.id,
      status: "ok",
      messageId: row.messageId ?? undefined,
      videoUrl: toVideoUrl(row.messageId),
    };
  }
  if (row.status === "failed") {
    return {
      generationId: row.id,
      status: "failed",
      failureReason: row.failureReason ?? undefined,
    };
  }
  if (!row.taskId) return { generationId: row.id, status: row.status };
  return null;
};

// 完了応答を保存面へ落とす。失敗したら理由つきの行にして failed を返す。
const completePoll = async (input: {
  env: VideoEnv;
  db: ReturnType<typeof createDb>;
  row: GenerationRow;
  videoUrl: string;
  costUsd: number | null;
  fetchImpl: typeof fetch;
}): Promise<PollResult> => {
  const { env, row } = input;
  try {
    await finishVideo({
      env,
      db: input.db,
      row,
      videoUrl: input.videoUrl,
      costUsd: input.costUsd,
      fetchImpl: input.fetchImpl,
    });
  } catch (finishError) {
    const reason = finishError instanceof Error ? finishError.message : String(finishError);
    await markFailed(env.DB, row.id, reason);
    return { generationId: row.id, status: "failed", failureReason: reason };
  }
  const finished = await env.DB.prepare(
    "SELECT message_id AS messageId FROM v2_video_generation WHERE id = ?",
  )
    .bind(row.id)
    .first<{ messageId: string | null }>();
  return {
    generationId: row.id,
    status: "ok",
    messageId: finished?.messageId ?? undefined,
    videoUrl: toVideoUrl(finished?.messageId ?? null),
  };
};

// 上流へ問い合わせて、完了なら R2 保存＋メッセージ作成まで済ませる。
const settlePoll = async (input: {
  env: VideoEnv;
  db: ReturnType<typeof createDb>;
  row: GenerationRow;
  fetchImpl: typeof fetch;
}): Promise<PollResult> => {
  const { env, row } = input;
  const { data, error } = await runwareCall(env, input.fetchImpl, {
    taskType: "getResponse",
    taskUUID: row.taskId as string,
  });
  if (error) {
    await markFailed(env.DB, row.id, error);
    return { generationId: row.id, status: "failed", failureReason: error };
  }
  const item = findTaskItem(data, "videoInference", row.taskId as string);
  const videoUrl = item && typeof item.videoURL === "string" ? item.videoURL : undefined;
  if (!videoUrl) {
    // まだ上流で生成中。次のポーリングで拾う。
    return { generationId: row.id, status: "processing" };
  }
  const costUsd = item && typeof item.cost === "number" ? item.cost : null;
  return completePoll({ ...input, videoUrl, costUsd });
};

export const pollVideoGeneration = async (input: {
  env: VideoEnv;
  characterId: string;
  generationId: string;
  fetchImpl?: typeof fetch;
}): Promise<PollResult> => {
  const { env } = input;
  const db = createDb(env.DB);
  const row = await env.DB.prepare(
    "SELECT id, status, task_id AS taskId, message_id AS messageId, failure_reason AS failureReason, " +
      "conversation_id AS conversationId, character_id AS characterId " +
      "FROM v2_video_generation WHERE id = ? AND character_id = ?",
  )
    .bind(input.generationId, input.characterId)
    .first<GenerationRow>();
  if (!row) throw new ImageGenerationError("動画生成が見つかりません。", 404);
  const terminal = terminalResult(row);
  if (terminal) return terminal;
  return settlePoll({ env, db, row, fetchImpl: input.fetchImpl ?? fetch });
};
