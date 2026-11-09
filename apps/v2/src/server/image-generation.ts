// 会話起点の画像生成（RIT-182）。キャラの外見 anchor と直近シーンからプロンプトを組み、
// Novita txt2img → poll → R2 保存 → v2_message（image_key 付き）+ v2_image_generation 記録
// までを1回の POST で同期的に済ませる。失敗は記録に理由を残して画面へ返す。
import {
  createDb,
  listLegacySourceUserIds,
  loadCharacter,
  loadLatestLedger,
  readDisplayHistory,
  v2ImageGenerationTable,
  v2MessageTable,
} from "@v2/db";
import { PROMPT_VERSION } from "@v2/prompt";

import {
  buildVisualAnchorPrompt,
  dedupePromptTags,
  detectExplicitContent,
  forbiddenExpressionForPhase,
  hasUsableIdentityAnchor,
  KNOWN_FAILURE_NEGATIVE,
  LORA_PINNED_RECIPE,
  NOVITA_HAIR_COLOR_NEGATIVE_TAGS,
  PHASE_GUARDRAILS,
  phaseExpressionForPhase,
  resolveVisualAnchorWeight,
  sanitizeImageTagsForPhase,
  stripFloatingCumTags,
  subjectTagsForPhase,
  type ImagePhase,
} from "./image-phase";
import { createNovitaClient, NOVITA_TXT2IMG_MODEL } from "./image-novita";

export const IMAGE_MODEL = NOVITA_TXT2IMG_MODEL;

// v1 のピン留めレシピ（10点実証レシピ）と同じ寸法・steps・guidance・negative 基線。
const IMAGE_WIDTH = 832;
const IMAGE_HEIGHT = 1216;
const IMAGE_STEPS = 30;
const IMAGE_GUIDANCE = 5;
const BASE_NEGATIVE =
  "lowres, bad anatomy, worst quality, extra limbs, extra fingers, deformed, mutated hands, text, watermark";

// RIT-183: ユーザー指定の上書き。未指定分は確定レシピの既定値へ倒す。
// strength は img2img 専用で、txt2img 経路では上流へ送らず記録だけ残す。
export type ImageParamOverrides = {
  cfg?: number;
  seed?: number;
  negativePrompt?: string;
  width?: number;
  height?: number;
  strength?: number;
};

// i2i の元画像保持度。v1 のキャラ一致パスと同じ 0.45（局長採点90点の確定値）。
const I2I_DEFAULT_STRENGTH = 0.45;

// 記録へ残す最終的に使ったパラメータ。指定値と既定値を合成した結果なので
// この行だけで同じ条件の再生成ができる。
type ResolvedImageParams = {
  width: number;
  height: number;
  steps: number;
  guidanceScale: number;
  seed?: number;
  strength: number | null;
};

const resolveImageParams = (overrides?: ImageParamOverrides): ResolvedImageParams => ({
  width: overrides?.width ?? IMAGE_WIDTH,
  height: overrides?.height ?? IMAGE_HEIGHT,
  steps: IMAGE_STEPS,
  guidanceScale: overrides?.cfg ?? IMAGE_GUIDANCE,
  seed: overrides?.seed,
  strength: overrides?.strength ?? null,
});

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
  loraModel: string | null;
  loraWeight: number | null;
  loraTriggerPrompt: string | null;
};

// アプリ側の drizzle と @v2/db 側は別インスタンス解決になるので、この読込は生 SQL で済ませる
// （packages/db 内に寄せると apps 側の型衝突が残る。既知の二重バージョン問題）。
const readCharacterVisual = async (
  db: D1Database,
  characterId: string,
): Promise<CharacterVisual> => {
  const row = await db
    .prepare(
      "SELECT visual_prompt, image_meta, lora_model, lora_weight, lora_trigger_prompt " +
        "FROM character WHERE id = ?",
    )
    .bind(characterId)
    .first<{
      visual_prompt: string | null;
      image_meta: string | null;
      lora_model: string | null;
      lora_weight: number | null;
      lora_trigger_prompt: string | null;
    }>();
  return {
    visualPrompt: row?.visual_prompt ?? null,
    imageMeta: row?.image_meta
      ? (JSON.parse(row.image_meta) as CharacterVisual["imageMeta"])
      : null,
    loraModel: row?.lora_model ?? null,
    loraWeight: row?.lora_weight ?? null,
    loraTriggerPrompt: row?.lora_trigger_prompt ?? null,
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

// 品質語尾はフェーズを問わず固定（v1 組み立て末尾の正典）。
const QUALITY_TAIL = "masterpiece, best quality, anatomically_correct_hands, five_fingers";

// negative 語尾も v1 正典。構図崩壊・実写化・人数崩れを常時弾く。
// solo フェーズは男タグを追加で殺し、カップル構図は 3 人以上だけ殺す。
const NEGATIVE_TAIL_BASE =
  "monochrome, grayscale, greyscale, multiple girls, 2girls, group, crowd, realistic, photorealistic, 3d, western, text, watermark, bad anatomy, bad hands, extra hands, three hands, disembodied hand, duplicate arms, extra fingers, fewer fingers, missing fingers, extra_fingers, fused_hands, malformed_hands, mutated hands, poorly drawn hands, malformed_feet, three_legs, missing_limbs, worst quality, low quality, normal quality, cropped";
const NEGATIVE_TAIL_SOLO = ", male, man, boy, 2boys, multiple boys";
const NEGATIVE_TAIL_COUPLE = ", 3boys, 3girls";

// LoRA ゲート: lora_model 登録済みかつ weight > 0 で発火（weight 0 以下は無効扱い。
// 発火すると anchor も参照も外れたまま身元の担い手が消える）。身元は trigger prompt が
// anchor ブロックを丸ごと置換し、negative・パラメータはピン留めレシピで全置換する。
const resolveLoraGate = (
  visual: CharacterVisual,
): { model: string; weight: number; triggerPrompt: string } | null => {
  if (!visual.loraModel) return null;
  const weight = visual.loraWeight ?? 0.85;
  if (weight <= 0) return null;
  if (!visual.loraTriggerPrompt) {
    // trigger 無しでも LoRA は効くが身元タグが薄くなる。運用ミス検知用に一次証拠を残す。
    console.warn("lora gate active without trigger prompt", {
      loraModel: visual.loraModel,
    });
  }
  return {
    model: visual.loraModel,
    weight,
    triggerPrompt: visual.loraTriggerPrompt ?? "",
  };
};

// v1 `[[route]].ts` の組み立てを v2 の台帳フェーズから動かす移植版（RIT-186）。
// 順序: [身元anchor(or LoRA trigger), 被写体, フェーズ positiveHint, 画風/服装,
//        明示タグ, シーン文, 表情, 品質語尾] → dedupe → climax/afterglow だけ浮遊cum除去。
export const buildImagePrompt = (
  visual: CharacterVisual,
  history: { role: string; content: string }[],
  phase: ImagePhase,
  turn: number,
  extraNegative?: string,
): { prompt: string; negativePrompt: string; loraActive: boolean } => {
  const meta = visual.imageMeta;
  const lora = resolveLoraGate(visual);
  const guardrail = PHASE_GUARDRAILS[phase];
  const scene = sceneHint(history);
  const explicit = detectExplicitContent(scene ?? "");

  // 身元ブロックは appearance + visual_prompt。artStyle/outfit はシーン側の内容として畳む。
  const anchorSource = [meta?.appearance, visual.visualPrompt]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join(", ");
  // 身元タグが 1 つも無いまま生成すると「プロフと別人の匿名女性」が返る。
  // 止めるのは身元の出所が 1 つも無い時だけ（LoRA trigger も出所の 1 つ）。
  // prompt を空にして返すと呼び出し側の既存 422 ゲートへ自然に乗る。
  if (!lora && !hasUsableIdentityAnchor(anchorSource)) {
    return { prompt: "", negativePrompt: "", loraActive: false };
  }
  const anchor = lora
    ? lora.triggerPrompt
    : buildVisualAnchorPrompt(anchorSource, resolveVisualAnchorWeight(phase));

  const explicitTags = explicit.detected ? explicit.tags.join(", ") : "";
  const sceneTags = sanitizeImageTagsForPhase(
    phase,
    [explicitTags, scene].filter(Boolean).join(", "),
  );

  const assembled = dedupePromptTags(
    [
      anchor,
      subjectTagsForPhase(phase),
      guardrail.positiveHint,
      meta?.artStyle,
      meta?.outfit,
      sceneTags,
      phaseExpressionForPhase(phase, turn),
      QUALITY_TAIL,
    ]
      .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
      .join(", "),
  );
  const prompt =
    phase === "climax" || phase === "afterglow"
      ? stripFloatingCumTags(assembled)
      : assembled;

  // LoRA 経路はピン留め短文 negative で全置換（長 negative は身元固定と喧嘩する）。
  const negativePrompt = lora
    ? LORA_PINNED_RECIPE.negativePrompt
    : dedupePromptTags(
        [
          extraNegative,
          meta?.negativePrompt,
          BASE_NEGATIVE,
          guardrail.negativeExtra,
          forbiddenExpressionForPhase(phase),
          NOVITA_HAIR_COLOR_NEGATIVE_TAGS,
          KNOWN_FAILURE_NEGATIVE,
          NEGATIVE_TAIL_BASE +
            (phase === "conversation" ? NEGATIVE_TAIL_SOLO : NEGATIVE_TAIL_COUPLE),
        ]
          .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
          .join(", "),
      );

  return { prompt, negativePrompt, loraActive: lora !== null };
};

// プロンプトと確定パラメータをまとめて解決する。generate 本体の分岐を増やさんための切り出し。
const prepareImageJob = (
  visual: CharacterVisual,
  history: { role: string; content: string }[],
  phase: ImagePhase,
  turn: number,
  overrides: ImageParamOverrides | undefined,
): { params: ResolvedImageParams; prompt: string; negativePrompt: string } => {
  const built = buildImagePrompt(visual, history, phase, turn, overrides?.negativePrompt);
  const params = resolveImageParams(overrides);
  return {
    params: built.loraActive
      ? {
          ...params,
          width: LORA_PINNED_RECIPE.width,
          height: LORA_PINNED_RECIPE.height,
          steps: LORA_PINNED_RECIPE.steps,
          guidanceScale: LORA_PINNED_RECIPE.guidanceScale,
        }
      : params,
    prompt: built.prompt,
    negativePrompt: built.negativePrompt,
  };
};

// i2i 参照元の解決。参照は同一会話（＝本人所有）の画像付きメッセージだけに限る。
// message_id 経由で生成行へ結び、派生元の generation id も拾う（RIT-184 の派生関係）。
const readImageSource = async (
  db: D1Database,
  conversationId: string,
  messageId: string,
): Promise<{ imageKey: string; sourceGenerationId: string | null } | null> => {
  const row = await db
    .prepare(
      "SELECT m.image_key AS imageKey, g.id AS generationId FROM v2_message m " +
        "LEFT JOIN v2_image_generation g ON g.message_id = m.id " +
        "WHERE m.id = ? AND m.conversation_id = ?",
    )
    .bind(messageId, conversationId)
    .first<{ imageKey: string | null; generationId: string | null }>();
  return row?.imageKey
    ? { imageKey: row.imageKey, sourceGenerationId: row.generationId ?? null }
    : null;
};

// R2 オブジェクトを base64 へ。Workers の btoa は8bit文字列前提なので塊に分けて積む。
const objectToBase64 = async (bucket: R2Bucket, key: string): Promise<string | null> => {
  const object = await bucket.get(key);
  if (!object) return null;
  const bytes = new Uint8Array(await object.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
};

// i2i 入力の確定。参照元メッセージを同一会話内に限って解決し R2 から元絵を引く。
// 依頼文はプロンプト先頭へ（構図の保持は strength が担う）、strength は実値を記録へ残す。
const prepareI2i = async (
  env: ImageEnv,
  conversationId: string,
  prompt: string,
  params: ResolvedImageParams,
  sourceMessageId: string | undefined,
  instruction: string | undefined,
): Promise<{
  base64: string;
  sourceGenerationId: string | null;
  prompt: string;
  strength: number;
}> => {
  const source = await readImageSource(env.DB, conversationId, sourceMessageId ?? "");
  if (!source) {
    throw new ImageGenerationError("参照元の画像が見つかりません。", 404);
  }
  const base64 = await objectToBase64(env.BUCKET, source.imageKey);
  if (!base64) {
    throw new ImageGenerationError("参照元の画像データを読めませんでした。", 502);
  }
  const finalPrompt = instruction?.trim() ? `${instruction.trim()}, ${prompt}` : prompt;
  return {
    base64,
    sourceGenerationId: source.sourceGenerationId,
    prompt: finalPrompt,
    strength: params.strength ?? I2I_DEFAULT_STRENGTH,
  };
};

const seedOf = (raw: string | number | undefined): number | null => {
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
};

export type ConversationImageResult =
  | { ok: true; messageId: string; imageUrl: string; generationId: string }
  | { ok: false; generationId: string; status: number; message: string };

// 生成記録の共通部分。プロンプトに加えて確定パラメータも全部入るので、
// 失敗行だけからでも「何を投げようとしたか」が再現できる。
type GenerationBase = ResolvedImageParams & {
  id: string;
  conversationId: string;
  characterId: string;
  prompt: string;
  negativePrompt: string;
  sourceGenerationId?: string | null;
};

type FailureRecorder = (reason: string, taskId?: string) => Promise<ConversationImageResult>;

const recordFailure =
  (db: ReturnType<typeof createDb>, base: GenerationBase): FailureRecorder =>
  async (reason, taskId) => {
    await db.insert(v2ImageGenerationTable).values({
      ...base,
      seed: base.seed ?? null,
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
  base: GenerationBase;
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
      // 上流が返した実績 seed を優先する（指定 seed を送った場合は同じ値が返る）。
      seed: input.image.seed ?? input.base.seed ?? null,
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

// Novita への init → poll → R2・メッセージ永続化までの実行部。
// i2i 入力があれば img2img へ、無ければ txt2img へ振る。
const runGeneration = async (deps: {
  env: ImageEnv;
  db: ReturnType<typeof createDb>;
  base: GenerationBase;
  i2i: Awaited<ReturnType<typeof prepareI2i>> | null;
  turn: number;
  fetchImpl?: typeof fetch;
}): Promise<ConversationImageResult> => {
  const { env, db, base, i2i } = deps;
  const fail = recordFailure(db, base);
  const client = createNovitaClient({
    apiKey: env.NOVITA_API_KEY,
    apiBase: env.MOCK_API_BASE,
    fetchImpl: deps.fetchImpl,
  });

  const initInput = {
    prompt: base.prompt,
    negativePrompt: base.negativePrompt,
    width: base.width,
    height: base.height,
    steps: base.steps,
    guidanceScale: base.guidanceScale,
    seed: base.seed,
  };

  let taskId: string;
  try {
    taskId = i2i
      ? await client.initImg2Img({
          ...initInput,
          imageBase64: i2i.base64,
          strength: i2i.strength,
        })
      : await client.initTxt2Img(initInput);
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }

  try {
    const result = await pollForImage(client, taskId);
    if ("failedReason" in result) return fail(result.failedReason, taskId);
    return await persistSuccess({
      db,
      env,
      fetchImpl: deps.fetchImpl ?? fetch,
      base,
      taskId,
      turn: deps.turn,
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

export const generateConversationImage = async (input: {
  env: ImageEnv;
  characterId: string;
  conversationId: string;
  params?: ImageParamOverrides;
  // i2i: 参照元メッセージ（同一会話の画像付き行のみ受ける）と表情変更等の依頼文。
  sourceMessageId?: string;
  instruction?: string;
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
  // フェーズは台帳の最新値が正。まだ台帳が無い会話（生成だけ先に走るケース）は conversation。
  const ledger = await loadLatestLedger(
    db,
    { userId: "local", characterId: input.characterId, promptVersion: PROMPT_VERSION },
    input.conversationId,
  );
  const phase: ImagePhase = ledger?.phase ?? "conversation";
  const { params, prompt, negativePrompt } = prepareImageJob(
    visual,
    display.history,
    phase,
    display.turn,
    input.params,
  );
  if (!prompt) {
    throw new ImageGenerationError("キャラクターの外見設定がないため画像を生成できません。", 422);
  }

  // i2i: 指定時だけ参照元を解決。確定したプロンプトと実効 strength は記録へ残す。
  const i2i = input.sourceMessageId
    ? await prepareI2i(
        env,
        input.conversationId,
        prompt,
        params,
        input.sourceMessageId,
        input.instruction,
      )
    : null;
  const resolved: ResolvedImageParams = i2i ? { ...params, strength: i2i.strength } : params;

  const base: GenerationBase = {
    id: crypto.randomUUID(),
    conversationId: input.conversationId,
    characterId: input.characterId,
    prompt: i2i ? i2i.prompt : prompt,
    negativePrompt,
    sourceGenerationId: i2i?.sourceGenerationId ?? null,
    ...resolved,
  };
  return runGeneration({
    env,
    db,
    base,
    i2i,
    turn: display.turn,
    fetchImpl: input.fetchImpl,
  });
};

export const isCharacterMismatchError = (error: unknown): boolean =>
  error instanceof ImageGenerationError && error.status === 404;
