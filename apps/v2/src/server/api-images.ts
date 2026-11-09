// 会話起点の画像生成 API（RIT-182）。
// POST /api/chat/:id/images … 生成を起票し Novita タスクを開始、{ generationId } を返す。
// GET  /api/image-generations/:generationId … 照会のたびに状態を進める。running → Novita を
//   poll し、成功なら R2 へ保存・画像メッセージを作り生成記録を完了にする。
import {
  completeImageGeneration,
  createDb,
  createImageGeneration,
  ensureConversationVersion,
  ensureCurrentVersion,
  failImageGeneration,
  insertImageMessage,
  loadVersionedCharacter,
  markImageTaskStarted,
  readLatestLedgerJson,
  readOwnedConversation,
  readOwnedImageGeneration,
} from "@v2/db";
import { PROMPT_VERSION } from "@v2/prompt";
import { z } from "zod";

import { LOCAL_USER_ID } from "./engine";
import { ImageGenProviderError, IMAGE_GEN_MODEL, NovitaImageGen } from "./image-gen";
import { buildImagePrompt, BASE_NEGATIVE_PROMPT } from "./image-prompt";
import { getPlatform } from "./platform";

import type { ImageGenRequest } from "./image-gen";
import type { V2Db } from "@v2/db";

// 最小スライスはパラメータ固定（露出は RIT-183 以降）。
const IMAGE_WIDTH = 768;
const IMAGE_HEIGHT = 1024;
const IMAGE_STEPS = 32;
const IMAGE_GUIDANCE = 7;
const IMAGE_SAMPLER = "DPM++ 2M SDE Karras";

// 上流が応答を返さんまま残った生成を、画面側が待ち続けんよう打ち切る。
const GENERATION_TIMEOUT_MS = 240_000;
// 上流画像の取り込みサイズ上限。想定外の巨大応答で R2 へ無制限に書かんため。
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

const json = (status: number, body: Record<string, unknown>): Response =>
  Response.json(body, { status });

const postBodySchema = z.object({ conversationId: z.string().min(1).max(120) });

type ImageEnv = {
  NOVITA_API_KEY?: string;
  NOVITA_API_BASE?: string;
};

const providerFor = (env: ImageEnv): NovitaImageGen =>
  new NovitaImageGen({ apiKey: env.NOVITA_API_KEY, apiBase: env.NOVITA_API_BASE });

const upstreamDetail = (error: unknown): Record<string, unknown> => ({
  upstream: {
    status: error instanceof ImageGenProviderError ? error.status : null,
    detail:
      error instanceof ImageGenProviderError
        ? (error.detail ?? error.message)
        : error instanceof Error
          ? error.message
          : String(error),
  },
});

const upstreamMessage = (error: unknown): string => {
  if (!(error instanceof ImageGenProviderError)) return "画像生成サービスで失敗しました。";
  if (error.status === 400 || error.status === 422) {
    return "生成内容が受け付けられませんでした。";
  }
  if (error.status === 429) {
    return "画像生成サービスが混雑しています。少し待って再試行してください。";
  }
  if (
    error.detail?.includes("NOT_ENOUGH_BALANCE") ||
    error.detail?.includes("INSUFFICIENT_BALANCE")
  ) {
    return "画像生成サービスの残高が不足しています。";
  }
  return "画像生成サービスで失敗しました。";
};

// 記録側の reason コードを画面の文言へ。記録自体は構造化 JSON のまま残す。
const FAILED_REASON_MESSAGES: Record<string, string> = {
  init_failed: "画像生成を開始できませんでした。",
  timeout: "画像生成がタイムアウトしました。",
  upstream_failed: "画像生成に失敗しました。",
  no_image_returned: "画像生成に失敗しました。",
  image_store_failed: "画像を保存できませんでした。",
};

const writeFailure = async (
  db: V2Db,
  generationId: string,
  reason: string,
  extra: Record<string, unknown> = {},
): Promise<void> => {
  await failImageGeneration(db, {
    id: generationId,
    failureJson: JSON.stringify({ reason, ...extra }),
    now: Date.now(),
  });
};

// 拡張子・配信型は実バイトの型に合わせる（response_image_type 指定を上流が守らん時の破損防止）。
const extFor = (contentType: string): "jpg" | "png" =>
  contentType === "image/jpeg" || contentType === "image/jpg" ? "jpg" : "png";

const storeUpstreamImage = async (bucket: R2Bucket, imageUrl: string): Promise<string> => {
  let response: Response;
  try {
    response = await fetch(imageUrl, { signal: AbortSignal.timeout(60_000) });
  } catch (error) {
    throw new ImageGenProviderError("generated image fetch failed", {
      status: 502,
      detail: error instanceof Error ? error.message : String(error),
    });
  }
  if (!response.ok) {
    throw new ImageGenProviderError("generated image fetch failed", { status: 502 });
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.startsWith("image/")) {
    throw new ImageGenProviderError("generated image is not an image", {
      status: 502,
      detail: contentType.slice(0, 100),
    });
  }
  const body = await response.arrayBuffer();
  if (body.byteLength === 0 || body.byteLength > MAX_IMAGE_BYTES) {
    throw new ImageGenProviderError("generated image size out of range", {
      status: 502,
      detail: `${body.byteLength}B`,
    });
  }
  const ext = extFor(contentType);
  const key = `images/${crypto.randomUUID()}.${ext}`;
  await bucket.put(key, body, {
    httpMetadata: { contentType: ext === "jpg" ? "image/jpeg" : "image/png" },
  });
  return key;
};

// 会話の所有権・ルートのキャラ一致・バージョン内容の 3 点をまとめて確認する。
const loadOwnedSceneCharacter = async (
  db: V2Db,
  characterId: string,
  conversationId: string,
): Promise<{ name: string; appearance: string } | null> => {
  const conversation = await readOwnedConversation(db, LOCAL_USER_ID, conversationId);
  if (!conversation || conversation.characterId !== characterId) return null;
  // 版が未固定の旧会話は、チャット engine と同じく現在版を固定してから読む。
  const versionId =
    conversation.characterVersionId ??
    (await ensureCurrentVersion(db, characterId, LOCAL_USER_ID).then((ensured) =>
      ensured
        ? ensureConversationVersion(db, {
            conversationId,
            userId: LOCAL_USER_ID,
            characterId,
            promptVersion: PROMPT_VERSION,
            versionId: ensured.versionId,
          })
        : null,
    ));
  const versioned = versionId
    ? await loadVersionedCharacter(db, {
        versionId,
        characterId,
        userId: LOCAL_USER_ID,
      })
    : null;
  if (!versioned) return null;
  return { name: versioned.content.name, appearance: versioned.content.appearance };
};

export const handleCreateImageRequest = async (id: string, request: Request): Promise<Response> => {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json(400, { message: "JSON形式で送信してください。" });
  }
  const body = postBodySchema.safeParse(payload);
  if (!body.success) return json(400, { message: "conversationId が必要です。" });

  const { env } = await getPlatform();
  const db = createDb(env.DB);
  const character = await loadOwnedSceneCharacter(db, id, body.data.conversationId);
  if (!character) return json(404, { message: "会話またはキャラクターが見つかりません。" });

  const ledgerJson = await readLatestLedgerJson(db, body.data.conversationId);
  const built = await buildImagePrompt(env, {
    characterName: character.name,
    appearance: character.appearance,
    ledgerJson,
  });
  if (built.degraded) {
    console.error(
      JSON.stringify({
        event: "image_prompt_translation_degraded",
        conversationId: body.data.conversationId,
      }),
    );
  }

  const provider = providerFor(env);
  const params: ImageGenRequest = {
    prompt: built.prompt,
    negativePrompt: BASE_NEGATIVE_PROMPT,
    width: IMAGE_WIDTH,
    height: IMAGE_HEIGHT,
    steps: IMAGE_STEPS,
    guidanceScale: IMAGE_GUIDANCE,
    samplerName: IMAGE_SAMPLER,
  };
  const generationId = crypto.randomUUID();
  await createImageGeneration(db, {
    id: generationId,
    conversationId: body.data.conversationId,
    model: IMAGE_GEN_MODEL,
    prompt: built.prompt,
    negativePrompt: BASE_NEGATIVE_PROMPT,
    seed: null,
    width: IMAGE_WIDTH,
    height: IMAGE_HEIGHT,
    steps: IMAGE_STEPS,
    guidanceScale: IMAGE_GUIDANCE,
    sampler: IMAGE_SAMPLER,
    costEstimateUsd: provider.estimateCostUSD(params),
    now: Date.now(),
  });

  try {
    const { taskId } = await provider.generate(params);
    await markImageTaskStarted(db, generationId, taskId);
    return json(200, { generationId, status: "running" });
  } catch (error) {
    await writeFailure(db, generationId, "init_failed", upstreamDetail(error));
    return json(502, { generationId, status: "failed", message: upstreamMessage(error) });
  }
};

type GenerationRow = NonNullable<Awaited<ReturnType<typeof readOwnedImageGeneration>>>;

// 上流照会。一過性失敗で生成を殺さず null を返し、画面の polling は続く。
const pollUpstream = async (
  env: ImageEnv,
  generationId: string,
  taskId: string,
): Promise<Awaited<ReturnType<NovitaImageGen["getTaskResult"]>> | null> => {
  try {
    return await providerFor(env).getTaskResult(taskId);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "image_task_poll_error",
        generationId,
        status: error instanceof ImageGenProviderError ? error.status : null,
      }),
    );
    return null;
  }
};

// 上流の完了応答を生成記録へ落とす。保存失敗は失敗扱い（画面へ理由が出る）。
const settleSucceeded = async (
  db: V2Db,
  env: ImageEnv & { BUCKET: R2Bucket },
  generation: GenerationRow,
  imageUrl: string | undefined,
): Promise<Response> => {
  if (!imageUrl) {
    await writeFailure(db, generation.id, "no_image_returned");
    return json(200, { status: "failed", reason: "画像生成に失敗しました。" });
  }
  try {
    const r2Key = await storeUpstreamImage(env.BUCKET, imageUrl);
    const message = await insertImageMessage(db, {
      conversationId: generation.conversationId,
      content: "（このシーンの画像を生成しました）",
      imageKey: r2Key,
      now: Date.now(),
    });
    await completeImageGeneration(db, {
      id: generation.id,
      r2Key,
      messageId: message.id,
      now: Date.now(),
    });
    return json(200, { status: "succeeded", messageId: message.id });
  } catch (error) {
    await writeFailure(db, generation.id, "image_store_failed", upstreamDetail(error));
    return json(200, { status: "failed", reason: "画像を保存できませんでした。" });
  }
};

// running の生成を照会・遷移させる。戻り値は画面へ返す {status, reason?} 系の JSON。
const advanceRunningGeneration = async (
  db: V2Db,
  env: ImageEnv & { BUCKET: R2Bucket },
  generation: GenerationRow,
): Promise<Response> => {
  if (Date.now() - generation.createdAt > GENERATION_TIMEOUT_MS) {
    await writeFailure(db, generation.id, "timeout");
    return json(200, { status: "failed", reason: "画像生成がタイムアウトしました。" });
  }
  if (!generation.taskId) {
    // init 応答前にブラウザが閉じられても poll で辿れるよう、taskId 未到達はまだ待つ。
    return json(200, { status: "running" });
  }

  const result = await pollUpstream(env, generation.id, generation.taskId);
  if (!result) return json(200, { status: "running" });

  const upstreamStatus = result.task.status;
  if (upstreamStatus === "TASK_STATUS_QUEUED" || upstreamStatus === "TASK_STATUS_PROCESSING") {
    return json(200, { status: "running" });
  }
  if (upstreamStatus !== "TASK_STATUS_SUCCEED") {
    await writeFailure(db, generation.id, "upstream_failed", {
      upstream: { reason: result.task.reason ?? upstreamStatus },
    });
    return json(200, { status: "failed", reason: "画像生成に失敗しました。" });
  }
  // 成功: 上流 URL から R2 へ保存し、画像つきメッセージを起票する。
  return settleSucceeded(db, env, generation, result.images?.[0]?.image_url);
};

export const handleImageStatusRequest = async (generationId: string): Promise<Response> => {
  const { env } = await getPlatform();
  const db = createDb(env.DB);
  const generation = await readOwnedImageGeneration(db, LOCAL_USER_ID, generationId);
  if (!generation) return json(404, { message: "生成記録が見つかりません。" });

  if (generation.status === "succeeded") {
    return json(200, { status: "succeeded", messageId: generation.messageId });
  }
  if (generation.status === "failed") {
    const failure = generation.failureJson
      ? (JSON.parse(generation.failureJson) as { reason?: string })
      : null;
    return json(200, {
      status: "failed",
      reason: FAILED_REASON_MESSAGES[failure?.reason ?? ""] ?? "画像生成に失敗しました。",
    });
  }
  return advanceRunningGeneration(db, env, generation);
};
