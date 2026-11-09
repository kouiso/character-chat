// 会話起点の画像生成（RIT-182）。キャラの外見 anchor と直近シーンからプロンプトを組み、
// Novita txt2img → poll → R2 保存 → v2_message（image_key 付き）+ v2_image_generation 記録
// までを1回の POST で同期的に済ませる。失敗は記録に理由を残して画面へ返す。
import {
  createDb,
  listLegacySourceUserIds,
  loadCharacter,
  readDisplayHistory,
  v2ImageGenerationTable,
  v2MessageTable,
} from "@v2/db";
import { PROMPT_VERSION } from "@v2/prompt";

import { createNovitaClient, NOVITA_TXT2IMG_MODEL } from "./image-novita";

export const IMAGE_MODEL = NOVITA_TXT2IMG_MODEL;

// v1 のピン留めレシピ（10点実証レシピ）と同じ寸法・steps・guidance・negative 基線。
const IMAGE_WIDTH = 832;
const IMAGE_HEIGHT = 1216;
const IMAGE_STEPS = 30;
const IMAGE_GUIDANCE = 5;
const BASE_NEGATIVE =
  "lowres, bad anatomy, worst quality, extra limbs, extra fingers, deformed, mutated hands, text, watermark";

// poll は合計 ~50s。Novita の txt2img は実測 10-30s なので余裕を持たせつつ、POST を
// 無限に握らん上限にする。
const POLL_INTERVAL_MS = 2_500;
const POLL_DEADLINE_MS = 50_000;

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export class ImageGenerationError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ImageGenerationError";
    this.status = status;
  }
}

type ImageEnv = {
  DB: D1Database;
  BUCKET: R2Bucket;
  NOVITA_API_KEY?: string;
  MOCK_API_BASE?: string;
};

type CharacterVisual = {
  visualPrompt: string | null;
  imageMeta: {
    appearance: string;
    artStyle: string;
    outfit?: string;
    negativePrompt?: string;
  } | null;
};

// アプリ側の drizzle と @v2/db 側は別インスタンス解決になるので、この読込は生 SQL で済ませる
// （packages/db 内に寄せると apps 側の型衝突が残る。既知の二重バージョン問題）。
const readCharacterVisual = async (
  db: D1Database,
  characterId: string,
): Promise<CharacterVisual> => {
  const row = await db
    .prepare("SELECT visual_prompt, image_meta FROM character WHERE id = ?")
    .bind(characterId)
    .first<{ visual_prompt: string | null; image_meta: string | null }>();
  return {
    visualPrompt: row?.visual_prompt ?? null,
    imageMeta: row?.image_meta
      ? (JSON.parse(row.image_meta) as CharacterVisual["imageMeta"])
      : null,
  };
};

// 直近シーンの手がかりはキャラの最後の発言から短く取る。長い地の文を全部積むと
// 1024 runes 上限で anchor が削られるので先頭 160 字に絞る。
const sceneHint = (history: { role: string; content: string }[]): string | null => {
  const last = [...history].reverse().find((row) => row.role === "assistant");
  if (!last) return null;
  const text = last.content.replace(/\s+/g, " ").trim().slice(0, 160);
  return text ? text : null;
};

export const buildImagePrompt = (
  visual: CharacterVisual,
  history: { role: string; content: string }[],
): { prompt: string; negativePrompt: string } => {
  const meta = visual.imageMeta;
  const parts = [
    meta?.artStyle,
    meta?.appearance,
    meta?.outfit,
    visual.visualPrompt,
    sceneHint(history),
  ].filter((part): part is string => typeof part === "string" && part.trim().length > 0);
  const negatives = [meta?.negativePrompt, BASE_NEGATIVE]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join(", ");
  return {
    prompt: parts.join(", "),
    negativePrompt: negatives,
  };
};

const seedOf = (raw: string | number | undefined): number | null => {
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
};

export type ConversationImageResult =
  | { ok: true; messageId: string; imageUrl: string; generationId: string }
  | { ok: false; generationId: string; status: number; message: string };

type FailureRecorder = (reason: string, taskId?: string) => Promise<ConversationImageResult>;

const recordFailure =
  (
    db: ReturnType<typeof createDb>,
    base: {
      id: string;
      conversationId: string;
      characterId: string;
      prompt: string;
      negativePrompt: string;
    },
  ): FailureRecorder =>
  async (reason, taskId) => {
    await db.insert(v2ImageGenerationTable).values({
      ...base,
      taskId: taskId ?? null,
      model: IMAGE_MODEL,
      status: "failed",
      failureReason: reason,
      createdAt: Date.now(),
    });
    return {
      ok: false,
      generationId: base.id,
      status: 502,
      message: "画像を生成できませんでした。",
    };
  };

// task-result が SUCCEED になるまで待つ。画像 URL を返すか、理由を添えて null。
const pollForImage = async (
  client: ReturnType<typeof createNovitaClient>,
  taskId: string,
): Promise<{ imageUrl: string; seed: number | null } | { failedReason: string }> => {
  const deadline = Date.now() + POLL_DEADLINE_MS;
  while (Date.now() < deadline) {
    const result = await client.taskResult(taskId);
    if (result.task.status === "TASK_STATUS_SUCCEED") {
      const image = result.images?.[0];
      return image
        ? { imageUrl: image.image_url, seed: seedOf(image.seed) }
        : { failedReason: "task succeeded without images" };
    }
    if (
      result.task.status === "TASK_STATUS_FAILED" ||
      result.task.status === "TASK_STATUS_CANCELED"
    ) {
      return { failedReason: `task ${result.task.status}` };
    }
    await wait(POLL_INTERVAL_MS);
  }
  return { failedReason: "task poll timeout" };
};

const fetchImageBytes = async (fetchImpl: typeof fetch, url: string): Promise<Uint8Array> => {
  const response = await fetchImpl(url);
  const contentType = response.headers.get("content-type") ?? "";
  if (!response.ok || !contentType.startsWith("image/")) {
    throw new ImageGenerationError("生成画像の取得に失敗しました。", 502);
  }
  return new Uint8Array(await response.arrayBuffer());
};

// 成功時: R2 へ画像を置き、image_key 付きの v2_message と生成記録を1バッチで書く。
const persistSuccess = async (input: {
  db: ReturnType<typeof createDb>;
  env: ImageEnv;
  fetchImpl: typeof fetch;
  base: {
    id: string;
    conversationId: string;
    characterId: string;
    prompt: string;
    negativePrompt: string;
  };
  taskId: string;
  turn: number;
  image: { imageUrl: string; seed: number | null };
}): Promise<ConversationImageResult> => {
  const bytes = await fetchImageBytes(input.fetchImpl, input.image.imageUrl);
  const imageKey = `images/${crypto.randomUUID()}.png`;
  await input.env.BUCKET.put(imageKey, bytes, { httpMetadata: { contentType: "image/png" } });
  const messageId = crypto.randomUUID();
  await input.db.batch([
    input.db.insert(v2MessageTable).values({
      id: messageId,
      conversationId: input.base.conversationId,
      turn: input.turn,
      role: "assistant",
      content: "（画像を生成した）",
      imageKey,
      createdAt: Date.now(),
    }),
    input.db.insert(v2ImageGenerationTable).values({
      ...input.base,
      messageId,
      taskId: input.taskId,
      model: IMAGE_MODEL,
      seed: input.image.seed,
      status: "ok",
      imageKey,
      createdAt: Date.now(),
    }),
  ]);
  return {
    ok: true,
    messageId,
    imageUrl: `/api/media/${encodeURIComponent(messageId)}`,
    generationId: input.base.id,
  };
};

export const generateConversationImage = async (input: {
  env: ImageEnv;
  characterId: string;
  conversationId: string;
  fetchImpl?: typeof fetch;
}): Promise<ConversationImageResult> => {
  const { env } = input;
  const db = createDb(env.DB);
  const owners = ["local", ...(await listLegacySourceUserIds(db))];
  const loaded = await loadCharacter(db, input.characterId, owners);
  if (!loaded.ok) {
    throw new ImageGenerationError("会話またはキャラクターが見つかりません。", 404);
  }
  // 会話の所有と次ターンを既存の読込規則で取る（移行会話の失敗ターン除外もここで効く）。
  const display = await readDisplayHistory(
    db,
    { userId: "local", characterId: input.characterId, promptVersion: PROMPT_VERSION },
    input.conversationId,
  );
  const visual = await readCharacterVisual(env.DB, input.characterId);
  const { prompt, negativePrompt } = buildImagePrompt(visual, display.history);
  if (!prompt) {
    throw new ImageGenerationError("キャラクターの外見設定がないため画像を生成できません。", 422);
  }

  const base = {
    id: crypto.randomUUID(),
    conversationId: input.conversationId,
    characterId: input.characterId,
    prompt,
    negativePrompt,
  };
  const fail = recordFailure(db, base);
  const client = createNovitaClient({
    apiKey: env.NOVITA_API_KEY,
    apiBase: env.MOCK_API_BASE,
    fetchImpl: input.fetchImpl,
  });

  let taskId: string;
  try {
    taskId = await client.initTxt2Img({
      prompt,
      negativePrompt,
      width: IMAGE_WIDTH,
      height: IMAGE_HEIGHT,
      steps: IMAGE_STEPS,
      guidanceScale: IMAGE_GUIDANCE,
    });
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }

  try {
    const result = await pollForImage(client, taskId);
    if ("failedReason" in result) return fail(result.failedReason, taskId);
    return await persistSuccess({
      db,
      env,
      fetchImpl: input.fetchImpl ?? fetch,
      base,
      taskId,
      turn: display.turn,
      image: result,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await fail(reason, taskId);
    if (error instanceof ImageGenerationError) throw error;
    return {
      ok: false,
      generationId: base.id,
      status: 502,
      message: "画像を生成できませんでした。",
    };
  }
};

export const isCharacterMismatchError = (error: unknown): boolean =>
  error instanceof ImageGenerationError && error.status === 404;
