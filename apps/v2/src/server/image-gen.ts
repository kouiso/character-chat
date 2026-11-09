// Novita の非同期画像生成 API（txt2img/img2img）クライアント。
// 旧アプリ src/lib/image-gen/novita-provider.ts の v2 移植。モデルは局長指示で
// waiNSFWIllustrious_v90_1187991 固定（他モデルは使わん）。
import { z } from "zod";

export const IMAGE_GEN_MODEL = "waiNSFWIllustrious_v90_1187991.safetensors";

export type ImageGenRequest = {
  prompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  steps: number;
  guidanceScale: number;
  seed?: number;
  imageNum?: number;
  samplerName?: string;
  // img2img: 参照画像(base64)があれば img2img エンドポイントへ切り替える（RIT-184 用の土台）。
  imageBase64?: string;
  strength?: number;
};

export const imageGenTaskResultSchema = z.object({
  task: z.object({
    task_id: z.string(),
    status: z.enum([
      "TASK_STATUS_QUEUED",
      "TASK_STATUS_PROCESSING",
      "TASK_STATUS_SUCCEED",
      "TASK_STATUS_FAILED",
      "TASK_STATUS_CANCELED",
    ]),
    progress_percent: z.number(),
    reason: z.string().optional(),
  }),
  images: z
    .array(
      z.object({
        image_url: z.string(),
        seed: z.union([z.string(), z.number()]).optional(),
        image_seed: z.union([z.string(), z.number()]).optional(),
      }),
    )
    .optional(),
});

export type ImageGenTaskResult = z.infer<typeof imageGenTaskResultSchema>;

// 一時的な upstream 障害（rate-limit 429 や 5xx）の判定。
export const isTransientUpstreamStatus = (status: number): boolean =>
  status === 408 || status === 425 || status === 429 || status >= 500;

export class ImageGenProviderError extends Error {
  readonly status: number;
  readonly retryable: boolean;
  readonly detail?: string;

  constructor(message: string, options: { status: number; retryable?: boolean; detail?: string }) {
    super(message);
    this.name = "ImageGenProviderError";
    this.status = options.status;
    this.retryable = options.retryable ?? false;
    this.detail = options.detail;
  }
}

const NOVITA_API_DEFAULT_ORIGIN = "https://api.novita.ai";
const NOVITA_INIT_TIMEOUT_MS = 15_000;
const NOVITA_POLL_TIMEOUT_MS = 10_000;
// Cloudflare 1010 bot-block が no-UA request に発動するため browser UA を送る。
const NOVITA_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const NOVITA_IMAGE_INIT_MAX_ATTEMPTS = 3;
const NOVITA_IMAGE_INIT_RETRY_BASE_MS = 2_000;
const NOVITA_IMAGE_INIT_RETRY_STATUSES = new Set([429, 502, 503, 504]);
const NOVITA_POLL_MAX_ATTEMPTS = 3;
const NOVITA_POLL_RETRY_BASE_MS = 1_000;
const NOVITA_POLL_RETRY_STATUSES = new Set([429, 502, 503, 504]);
// Novita は prompt / negative_prompt を最大 1024 runes に制限する。超過は 400 で即失敗する。
const NOVITA_PROMPT_MAX_RUNES = 1024;
// 参照画像の有無で切り替わる img2img の既定 strength（旧アプリのキャラ一致パスと同値）。
const NOVITA_IMG2IMG_DEFAULT_STRENGTH = 0.45;

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const withTimeoutSignal = (timeoutMs: number, reason: string): AbortController => {
  const controller = new AbortController();
  setTimeout(() => controller.abort(reason), timeoutMs);
  return controller;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const parseTaskId = (value: unknown): string | null => {
  if (!isRecord(value) || typeof value.task_id !== "string") return null;
  return value.task_id;
};

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
    model_name: IMAGE_GEN_MODEL,
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
    extra: { response_image_type: "png" },
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
  });
};

const requireApiKey = (apiKey: string | undefined): string => {
  if (typeof apiKey === "string" && apiKey.length > 0) return apiKey;
  return throwMissingApiKey();
};

// 上流応答本文を一次証拠として残すため安全な範囲(先頭600字)で読む。
const readUpstreamBody = async (response: Response): Promise<string | undefined> => {
  try {
    const text = await response.text();
    if (!text) return undefined;
    return text.length > 600 ? `${text.slice(0, 600)}…` : text;
  } catch {
    return undefined;
  }
};

const throwUpstreamInitError = (response: Response | null, detail?: string): never => {
  throw new ImageGenProviderError("novita upstream service error", {
    status: response?.status ?? 502,
    retryable: response ? NOVITA_IMAGE_INIT_RETRY_STATUSES.has(response.status) : true,
    detail,
  });
};

export type NovitaConfig = {
  apiKey?: string;
  // 外部APIモック等で origin を差し替える場合用。未指定なら本番 origin。
  apiBase?: string;
  fetchImpl?: typeof fetch;
};

export class NovitaImageGen {
  private readonly apiKey?: string;
  private readonly apiBase: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: NovitaConfig) {
    this.apiKey = config.apiKey;
    this.apiBase = `${config.apiBase ?? NOVITA_API_DEFAULT_ORIGIN}/v3/async`;
    // 明示的な arrow 関数ラップで workerd ローカル開発の "Illegal invocation" を防ぐ。
    this.fetchImpl = config.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  }

  estimateCostUSD(req: ImageGenRequest): number {
    const megapixels = (req.width * req.height) / 1_000_000;
    return Number((0.0025 * Math.max(1, megapixels) * (req.imageNum ?? 1)).toFixed(6));
  }

  private initEndpoint(req: ImageGenRequest): string {
    return `${this.apiBase}/${req.imageBase64 ? "img2img" : "txt2img"}`;
  }

  async generate(req: ImageGenRequest): Promise<{ taskId: string; costEstimateUSD: number }> {
    const apiKey = requireApiKey(this.apiKey);
    const response = await this.fetchInitWithRetry(
      this.initEndpoint(req),
      buildInitBody(req),
      apiKey,
    );
    if (!response.ok) throwUpstreamInitError(response, await readUpstreamBody(response));

    const taskId = parseTaskId(await response.json());
    if (!taskId) {
      throw new ImageGenProviderError("unexpected novita response shape", {
        status: 502,
        retryable: false,
      });
    }
    return { taskId, costEstimateUSD: this.estimateCostUSD(req) };
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
    if (response === null) return throwUpstreamInitError(null);
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
      await wait(NOVITA_IMAGE_INIT_RETRY_BASE_MS * 2 ** attempt);
      return;
    }
    throw new ImageGenProviderError(`novita network error: ${String(error)}`, {
      status: 502,
      retryable: true,
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
      return imageGenTaskResultSchema.parse(await response.json());
    } catch (error) {
      throw new ImageGenProviderError(
        `failed to parse novita task result: ${error instanceof Error ? error.message : String(error)}`,
        { status: 502 },
      );
    }
  }

  private async throwTaskError(response: Response | null): Promise<never> {
    const detail = response ? await readUpstreamBody(response) : undefined;
    throw new ImageGenProviderError("novita task upstream service error", {
      status: response?.status ?? 502,
      retryable: response ? NOVITA_POLL_RETRY_STATUSES.has(response.status) : true,
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
      await wait(NOVITA_POLL_RETRY_BASE_MS * 2 ** attempt);
    }
    return this.throwTaskError(lastResponse);
  }
}
