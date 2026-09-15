import {
  ImageGenProviderError,
  isTransientUpstreamStatus,
  type ImageGenInitResponse,
  type ImageGenProvider,
  type ImageGenProviderConfig,
  type ImageGenRequest,
  type ImageGenTaskResult,
  type TaskStore,
} from "./provider";

const RUNWARE_API_DEFAULT_URL = "https://api.runware.ai/v1";
// Runware imageInference は同期接続を長時間保持すると Cloudflare / 上流側のタイムアウトで切れる。
// deliveryMethod: "async" でキュー投入し、getResponse をクライアント poll 経由で呼び出すことで安全に生成完了を拾う。
const RUNWARE_INIT_TIMEOUT_MS = 15_000;
const RUNWARE_POLL_TIMEOUT_MS = 10_000;
const RUNWARE_POLL_INTERVAL_MS = 3_000;
// getTaskResult 内で 1 リクエストあたり待つ上限。長時間ブロックさせず、クライアントの poll ループに委ねる。
const RUNWARE_GET_RESULT_MAX_WAIT_MS = 20_000;

// アプリ公開名 → Runware AIR ID のマッピング。Runware には自前アップロードした
// チェックポイントしか無いため、未知のモデル名を素通しすると必ず失敗する。明示的に弾く。
const RUNWARE_MODEL_MAP: Record<string, string> = {
  "waiNSFWIllustrious_v90_1187991.safetensors": "aiadultapp:waiillustrious@9",
};

const RUNWARE_TASK_PREFIX = "runware-";

export const isRunwareTaskId = (taskId: string): boolean => taskId.startsWith(RUNWARE_TASK_PREFIX);

const withTimeoutSignal = (timeoutMs: number, reason: string): AbortController => {
  const controller = new AbortController();
  setTimeout(() => controller.abort(reason), timeoutMs);
  return controller;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const readUpstreamBody = async (response: Response): Promise<string | undefined> => {
  try {
    const text = await response.text();
    if (!text) return undefined;
    return text.length > 600 ? `${text.slice(0, 600)}…` : text;
  } catch {
    return undefined;
  }
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const requireApiKey = (apiKey: string | undefined): string => {
  if (typeof apiKey === "string" && apiKey.length > 0) return apiKey;
  throw new ImageGenProviderError("runware api key is not configured", {
    status: 503,
    retryable: false,
    fallbackEligible: true,
    provider: "runware",
  });
};

const mapModel = (model: string): string => {
  const mapped = RUNWARE_MODEL_MAP[model];
  if (mapped) return mapped;
  throw new ImageGenProviderError(`no runware mapping for model: ${model}`, {
    status: 400,
    retryable: false,
    fallbackEligible: false,
    provider: "runware",
  });
};

const buildInferenceTask = (req: ImageGenRequest, taskUUID: string): Record<string, unknown> => {
  const task: Record<string, unknown> = {
    taskType: "imageInference",
    taskUUID,
    positivePrompt: req.prompt,
    negativePrompt: req.negativePrompt,
    model: mapModel(req.model),
    width: req.width,
    height: req.height,
    steps: req.steps,
    CFGScale: req.guidanceScale,
    numberResults: req.imageNum ?? 1,
    outputType: "URL",
    outputFormat: "JPG",
    deliveryMethod: "async",
  };
  // Runware の seed 省略 = ランダム。Novita 流の -1 は invalid になるため付けない。
  if (req.seed !== undefined && req.seed !== null && req.seed >= 0) task.seed = req.seed;
  if (req.loras?.length) {
    task.lora = req.loras.map((l) => ({ model: l.model, weight: l.weight }));
  }
  return task;
};

type RunwareImage = { image_url: string; seed?: number };

const parseImagesFromData = (data: unknown[], taskUUID: string): RunwareImage[] => {
  const images: RunwareImage[] = [];
  for (const item of data) {
    if (!isRecord(item)) continue;
    if (item.taskType !== "imageInference" || item.taskUUID !== taskUUID) continue;
    if (typeof item.imageURL !== "string") continue;
    images.push({
      image_url: item.imageURL,
      ...(typeof item.seed === "number" ? { seed: item.seed } : {}),
    });
  }
  return images;
};

const parseImages = (payload: unknown, taskUUID: string): RunwareImage[] => {
  if (!isRecord(payload)) return [];
  const data = Array.isArray(payload.data) ? payload.data : [];
  return parseImagesFromData(data, taskUUID);
};

const getStringField = (record: Record<string, unknown>, key: string): string | undefined => {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
};

const findTaskError = (
  errors: unknown[],
  taskUUID: string,
): Record<string, unknown> | undefined => {
  for (const error of errors) {
    if (!isRecord(error)) continue;
    if (error.taskUUID === taskUUID) return error;
  }
  return undefined;
};

const extractErrorMessage = (payload: unknown, taskUUID: string): string | undefined => {
  if (!isRecord(payload)) return undefined;
  const errors = Array.isArray(payload.errors) ? payload.errors : [];
  const matched = findTaskError(errors, taskUUID);
  if (matched) {
    const message = getStringField(matched, "message");
    if (message) return message;
    return getStringField(matched, "code");
  }
  const first = errors[0];
  if (!isRecord(first)) return undefined;
  const message = getStringField(first, "message");
  if (message) return message;
  return getStringField(first, "code");
};

const buildSuccessResult = (taskId: string, images: RunwareImage[]): ImageGenTaskResult => ({
  task: { task_id: taskId, status: "TASK_STATUS_SUCCEED", progress_percent: 100 },
  images,
  provider: "runware",
});

const buildProcessingResult = (taskId: string): ImageGenTaskResult => ({
  task: { task_id: taskId, status: "TASK_STATUS_PROCESSING", progress_percent: 0 },
  provider: "runware",
});

const buildFailedResult = (taskId: string): ImageGenTaskResult => ({
  task: { task_id: taskId, status: "TASK_STATUS_FAILED", progress_percent: 0 },
  provider: "runware",
});

const isTerminalStatus = (status: string): boolean =>
  status === "TASK_STATUS_SUCCEED" ||
  status === "TASK_STATUS_FAILED" ||
  status === "TASK_STATUS_CANCELED";

const extractTaskUUID = (taskId: string): string => taskId.slice(RUNWARE_TASK_PREFIX.length);

export class RunwareImageGenProvider implements ImageGenProvider {
  readonly name = "runware" as const;
  private readonly apiKey?: string;
  private readonly apiUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly taskStore?: TaskStore;

  constructor(config: ImageGenProviderConfig) {
    this.apiKey = config.runwareApiKey;
    // novita と同じくモック向けに差し替え可能にする。未設定なら本番の api.runware.ai。
    this.apiUrl = config.runwareApiBase
      ? `${config.runwareApiBase.replace(/\/$/u, "")}/v1`
      : RUNWARE_API_DEFAULT_URL;
    // 明示的な arrow 関数ラップで workerd ローカル開発の "Illegal invocation" を防ぐ
    this.fetchImpl = config.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
    this.taskStore = config.taskStore;
  }

  estimateCostUSD(req: ImageGenRequest): number {
    return Number((0.0008 * (req.imageNum ?? 1)).toFixed(6));
  }

  async healthCheck(): Promise<{ ok: boolean; latencyMs: number }> {
    const startedAt = Date.now();
    return { ok: Boolean(this.apiKey), latencyMs: Date.now() - startedAt };
  }

  // async deliveryMethod で画像生成をキューし、即座に task_id を返す。
  // 実際の生成完了は getTaskResult / クライアント poll で取得する。
  async generate(req: ImageGenRequest): Promise<ImageGenInitResponse> {
    const apiKey = requireApiKey(this.apiKey);
    const store = this.requireTaskStore();
    const taskUUID = crypto.randomUUID();
    const startedAt = Date.now();
    const taskId = `${RUNWARE_TASK_PREFIX}${taskUUID}`;

    // モデルマッピング失敗(400)を network-error 扱いにしないため、body は try の外で組み立てる
    const initBody = JSON.stringify([
      { taskType: "authentication", apiKey },
      buildInferenceTask(req, taskUUID),
    ]);

    const initResponse = await this.fetchWithTimeout(initBody, RUNWARE_INIT_TIMEOUT_MS);
    const initPayload = await initResponse.json();
    const initImages = parseImages(initPayload, taskUUID);
    if (initImages.length > 0) {
      await store.set(taskId, buildSuccessResult(taskId, initImages));
      return {
        taskId,
        provider: this.name,
        costEstimateUSD: this.estimateCostUSD(req),
        latencyMs: Date.now() - startedAt,
      };
    }

    const initError = extractErrorMessage(initPayload, taskUUID);
    if (initError) {
      throw new ImageGenProviderError(`runware async init error: ${initError}`, {
        status: 502,
        retryable: true,
        fallbackEligible: true,
        provider: "runware",
        detail: JSON.stringify(initPayload),
      });
    }

    // キュー投入に成功 → task store に PROCESSING を書き込み、task_id を即返す
    await store.set(taskId, buildProcessingResult(taskId));
    return {
      taskId,
      provider: this.name,
      costEstimateUSD: this.estimateCostUSD(req),
      latencyMs: Date.now() - startedAt,
    };
  }

  async getTaskResult(taskId: string): Promise<ImageGenTaskResult> {
    const store = this.requireTaskStore();
    const existing = await store.get(taskId);
    if (existing && isTerminalStatus(existing.task.status)) {
      return existing;
    }

    const apiKey = requireApiKey(this.apiKey);
    const taskUUID = extractTaskUUID(taskId);
    const pollBody = JSON.stringify([
      { taskType: "authentication", apiKey },
      { taskType: "getResponse", taskUUID },
    ]);

    const startedAt = Date.now();
    while (Date.now() - startedAt < RUNWARE_GET_RESULT_MAX_WAIT_MS) {
      await sleep(RUNWARE_POLL_INTERVAL_MS);
      const pollResponse = await this.fetchWithTimeout(pollBody, RUNWARE_POLL_TIMEOUT_MS);
      const pollPayload = await pollResponse.json();
      const pollImages = parseImages(pollPayload, taskUUID);
      if (pollImages.length > 0) {
        const result = buildSuccessResult(taskId, pollImages);
        await store.set(taskId, result);
        return result;
      }
      const pollError = extractErrorMessage(pollPayload, taskUUID);
      if (pollError) {
        const result = buildFailedResult(taskId);
        await store.set(taskId, result);
        throw new ImageGenProviderError(`runware async poll error: ${pollError}`, {
          status: 502,
          retryable: true,
          fallbackEligible: true,
          provider: "runware",
          detail: JSON.stringify(pollPayload),
        });
      }
    }

    // まだ完了していない場合は PROCESSING を返し、呼び出し側の poll ループに委ねる。
    // 非破壊読み: 成功後の store.set は別リクエストが待っている場合でも結果を保持する。
    const result = existing ?? buildProcessingResult(taskId);
    await store.set(taskId, result);
    return result;
  }

  private async fetchWithTimeout(body: string, timeoutMs: number): Promise<Response> {
    const abortController = withTimeoutSignal(timeoutMs, "runware_request_timeout");
    let response: Response;
    try {
      response = await this.fetchImpl(this.apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: abortController.signal,
      });
    } catch (error) {
      throw new ImageGenProviderError(`runware network error: ${String(error)}`, {
        status: 502,
        retryable: true,
        fallbackEligible: true,
        provider: "runware",
        detail: String(error),
      });
    }
    if (!response.ok) {
      throw new ImageGenProviderError("runware upstream service error", {
        status: response.status,
        retryable: isTransientUpstreamStatus(response.status),
        fallbackEligible: response.status === 402 || isTransientUpstreamStatus(response.status),
        provider: "runware",
        detail: await readUpstreamBody(response),
      });
    }
    return response;
  }

  private requireTaskStore(): TaskStore {
    if (this.taskStore) return this.taskStore;
    throw new ImageGenProviderError("runware task store is not configured", {
      status: 503,
      retryable: false,
      fallbackEligible: true,
      provider: "runware",
    });
  }
}
