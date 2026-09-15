import {
  imageGenTaskResultSchema,
  ImageGenProviderError,
  isTransientUpstreamStatus,
  type ImageGenInitResponse,
  type ImageGenProvider,
  type ImageGenProviderConfig,
  type ImageGenRequest,
  type ImageGenTaskResult,
} from "./provider";

const NOVITA_API_DEFAULT_ORIGIN = "https://api.novita.ai";
const NOVITA_INIT_TIMEOUT_MS = 15_000;
const NOVITA_POLL_TIMEOUT_MS = 10_000;
// Cloudflare 1010 bot-block が no-UA request に発動するため browser UA を送る
const NOVITA_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const NOVITA_IMAGE_INIT_MAX_ATTEMPTS = 3;
const NOVITA_IMAGE_INIT_RETRY_BASE_MS = 2_000;
// 429 (Too Many Requests) は Novita のレート制限で、指数的バックオフで再試行する。
const NOVITA_IMAGE_INIT_RETRY_STATUSES = new Set([429, 502, 503, 504]);

const NOVITA_POLL_MAX_ATTEMPTS = 3;
const NOVITA_POLL_RETRY_BASE_MS = 1_000;
const NOVITA_POLL_RETRY_STATUSES = new Set([429, 502, 503, 504]);

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const withTimeoutSignal = (timeoutMs: number, reason: string): AbortController => {
  const controller = new AbortController();
  setTimeout(() => controller.abort(reason), timeoutMs);
  return controller;
};

const readJson = async (response: Response): Promise<unknown> => response.json();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const parseTaskId = (value: unknown): string | null => {
  if (!isRecord(value) || typeof value.task_id !== "string") return null;
  return value.task_id;
};

// route.ts のキャラ一致パス (img2img) と同値。imageBase64 未指定時は txt2img のまま。
const NOVITA_IMG2IMG_DEFAULT_STRENGTH = 0.45;

// Novita img2img は prompt / negative_prompt を最大 1024 runes に制限する。
// 超過すると 400 VALIDATOR (NegativePrompt length must be between 0 and 1024 runes) で即失敗し、
// 502 "upstream service error" としてユーザーに返る。climax phase の negative_prompt がこれを超えていた。
const NOVITA_PROMPT_MAX_RUNES = 1024;

// rune(コードポイント)単位で max 以内に収める。途中タグが切れないようカンマ境界で切り詰める。
const clampToRunes = (text: string, max: number): string => {
  const runes = Array.from(text);
  if (runes.length <= max) return text;
  const head = runes.slice(0, max).join("");
  const lastComma = head.lastIndexOf(",");
  return (lastComma > 0 ? head.slice(0, lastComma) : head).trimEnd();
};

const buildInitBody = (req: ImageGenRequest): string => {
  const request = {
    model_name: req.model,
    prompt: clampToRunes(req.prompt, NOVITA_PROMPT_MAX_RUNES),
    negative_prompt: clampToRunes(req.negativePrompt, NOVITA_PROMPT_MAX_RUNES),
    width: req.width,
    height: req.height,
    sampler_name: req.samplerName ?? "DPM++ 2M Karras",
    steps: req.steps,
    guidance_scale: req.guidanceScale,
    image_num: req.imageNum ?? 1,
    seed: req.seed ?? -1,
  };
  return JSON.stringify({
    extra: { response_image_type: "jpeg" },
    // 参照画像があれば image_base64 + strength を request に足す。route.ts:7466-7468 と同形。
    request: req.imageBase64
      ? {
          ...request,
          image_base64: req.imageBase64,
          strength: req.strength ?? NOVITA_IMG2IMG_DEFAULT_STRENGTH,
        }
      : request,
  });
};

const shouldRetryInit = (response: Response, attempt: number): boolean =>
  NOVITA_IMAGE_INIT_RETRY_STATUSES.has(response.status) &&
  attempt < NOVITA_IMAGE_INIT_MAX_ATTEMPTS - 1;

const throwMissingApiKey = (): never => {
  throw new ImageGenProviderError("novita api key is not configured", {
    status: 503,
    retryable: false,
    fallbackEligible: true,
    provider: "novita",
  });
};

const requireApiKey = (apiKey: string | undefined): string => {
  if (typeof apiKey === "string" && apiKey.length > 0) return apiKey;
  return throwMissingApiKey();
};

// 上流応答本文を一次証拠として残すため安全な範囲(先頭600字)で読む。本文が無くても throw は止めない。
const readUpstreamBody = async (response: Response): Promise<string | undefined> => {
  try {
    const text = await response.text();
    if (!text) return undefined;
    return text.length > 600 ? `${text.slice(0, 600)}…` : text;
  } catch {
    return undefined;
  }
};

const isNovitaInsufficientBalance = (response: Response | null, detail?: string): boolean =>
  response?.status === 403 &&
  typeof detail === "string" &&
  (detail.includes("NOT_ENOUGH_BALANCE") || detail.includes("INSUFFICIENT_BALANCE"));

const throwUpstreamInitError = (response: Response | null, detail?: string): never => {
  throw new ImageGenProviderError("novita upstream service error", {
    status: response?.status ?? 502,
    retryable: response ? NOVITA_IMAGE_INIT_RETRY_STATUSES.has(response.status) : true,
    fallbackEligible:
      response === null ||
      response.status === 402 ||
      isNovitaInsufficientBalance(response, detail) ||
      isTransientUpstreamStatus(response.status),
    provider: "novita",
    detail,
  });
};

export class NovitaImageGenProvider implements ImageGenProvider {
  readonly name = "novita" as const;
  private readonly apiKey?: string;
  private readonly apiBase: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: ImageGenProviderConfig) {
    this.apiKey = config.novitaApiKey;
    this.apiBase = `${config.novitaApiBase ?? NOVITA_API_DEFAULT_ORIGIN}/v3/async`;
    // 明示的な arrow 関数ラップで workerd ローカル開発の "Illegal invocation" を防ぐ
    this.fetchImpl = config.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  }

  // 参照画像の有無でエンドポイントを切り替える (route.ts:7454-7456 と同じ分岐)。
  private initEndpoint(req: ImageGenRequest): string {
    return `${this.apiBase}/${req.imageBase64 ? "img2img" : "txt2img"}`;
  }

  estimateCostUSD(req: ImageGenRequest): number {
    const megapixels = (req.width * req.height) / 1_000_000;
    return Number((0.0025 * Math.max(1, megapixels) * (req.imageNum ?? 1)).toFixed(6));
  }

  async healthCheck(): Promise<{ ok: boolean; latencyMs: number }> {
    const startedAt = Date.now();
    if (!this.apiKey) return { ok: false, latencyMs: Date.now() - startedAt };
    return { ok: true, latencyMs: Date.now() - startedAt };
  }

  async generate(req: ImageGenRequest): Promise<ImageGenInitResponse> {
    const apiKey = requireApiKey(this.apiKey);

    const startedAt = Date.now();
    const response = await this.fetchInitWithRetry(
      this.initEndpoint(req),
      buildInitBody(req),
      apiKey,
    );
    if (!response.ok) throwUpstreamInitError(response, await readUpstreamBody(response));

    const taskId = parseTaskId(await readJson(response));
    if (!taskId) {
      throw new ImageGenProviderError("unexpected novita response shape", {
        status: 502,
        retryable: false,
        fallbackEligible: false,
        provider: "novita",
      });
    }

    return {
      taskId,
      provider: this.name,
      costEstimateUSD: this.estimateCostUSD(req),
      latencyMs: Date.now() - startedAt,
    };
  }

  private async fetchInitWithRetry(
    endpoint: string,
    body: string,
    apiKey: string,
  ): Promise<Response> {
    let response: Response | null = null;
    for (let attempt = 0; attempt < NOVITA_IMAGE_INIT_MAX_ATTEMPTS; attempt += 1) {
      try {
        response = await this.fetchInit(endpoint, body, apiKey);
      } catch (error) {
        await this.handleNetworkRetry(error, attempt);
        continue;
      }

      if (response.ok) break;
      if (!shouldRetryInit(response, attempt)) break;
      // 指数的バックオフ：2s, 4s, 8s
      await wait(NOVITA_IMAGE_INIT_RETRY_BASE_MS * 2 ** attempt);
    }

    if (response === null) {
      return throwUpstreamInitError(null);
    }
    return response;
  }

  private async fetchInit(endpoint: string, body: string, apiKey: string): Promise<Response> {
    const abortController = withTimeoutSignal(NOVITA_INIT_TIMEOUT_MS, "novita_init_timeout");
    return this.fetchImpl(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "User-Agent": NOVITA_USER_AGENT,
      },
      body,
      signal: abortController.signal,
    });
  }

  private async handleNetworkRetry(error: unknown, attempt: number): Promise<void> {
    if (attempt < NOVITA_IMAGE_INIT_MAX_ATTEMPTS - 1) {
      // 指数的バックオフ：2s, 4s, 8s
      await wait(NOVITA_IMAGE_INIT_RETRY_BASE_MS * 2 ** attempt);
      return;
    }
    throw new ImageGenProviderError(`novita network error: ${String(error)}`, {
      status: 502,
      retryable: true,
      fallbackEligible: true,
      provider: "novita",
      detail: String(error),
    });
  }

  private async fetchTaskResult(taskId: string, apiKey: string): Promise<Response> {
    const abortController = withTimeoutSignal(NOVITA_POLL_TIMEOUT_MS, "novita_poll_timeout");
    return this.fetchImpl(`${this.apiBase}/task-result?task_id=${encodeURIComponent(taskId)}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "User-Agent": NOVITA_USER_AGENT,
      },
      signal: abortController.signal,
    });
  }

  private async parseTaskResult(response: Response): Promise<ImageGenTaskResult> {
    try {
      return imageGenTaskResultSchema.parse(await readJson(response));
    } catch (error) {
      throw new ImageGenProviderError(
        `failed to parse novita task result: ${error instanceof Error ? error.message : String(error)}`,
        { status: 502, fallbackEligible: false, provider: "novita" },
      );
    }
  }

  private async throwTaskError(response: Response | null): Promise<never> {
    const detail = response ? await readUpstreamBody(response) : undefined;
    throw new ImageGenProviderError("novita task upstream service error", {
      status: response?.status ?? 502,
      retryable: response ? NOVITA_POLL_RETRY_STATUSES.has(response.status) : true,
      fallbackEligible: false,
      provider: "novita",
      detail,
    });
  }

  async getTaskResult(taskId: string): Promise<ImageGenTaskResult> {
    const apiKey = requireApiKey(this.apiKey);

    let lastResponse: Response | null = null;
    for (let attempt = 0; attempt < NOVITA_POLL_MAX_ATTEMPTS; attempt += 1) {
      const response = await this.fetchTaskResult(taskId, apiKey);
      lastResponse = response;
      if (response.ok) return await this.parseTaskResult(response);
      const shouldRetry =
        NOVITA_POLL_RETRY_STATUSES.has(response.status) && attempt < NOVITA_POLL_MAX_ATTEMPTS - 1;
      if (!shouldRetry) break;
      // ポーリング時の 429/5xx も指数バックオフで再試行
      await wait(NOVITA_POLL_RETRY_BASE_MS * 2 ** attempt);
    }

    return this.throwTaskError(lastResponse);
  }
}
