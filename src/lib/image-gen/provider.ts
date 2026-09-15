import { z } from "zod/v4";

export type ImageGenProviderName = "novita" | "runware";
export type ImageGenProviderMode = ImageGenProviderName | "auto";

export type ImageGenModel = "sdxl-base" | "flux-dev" | "pony-realism" | string;

export type ImageGenRequest = {
  prompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  model: ImageGenModel;
  steps: number;
  guidanceScale: number;
  seed?: number;
  imageNum?: number;
  samplerName?: string;
  // img2img: 参照画像(base64)があれば txt2img でなく img2img エンドポイントへ切り替える。
  // strength は元画像の保持度(低いほど元画像に忠実)。route.ts のキャラ一致パスと同値の 0.55 が既定。
  imageBase64?: string;
  strength?: number;
  // キャラ身元固定 LoRA (Runware AIR ID)。指定時は LoRA 対応 provider (runware) へ必ずルーティングされる。
  loras?: Array<{ model: string; weight: number }>;
};

export type ImageGenInitResponse = {
  taskId: string;
  provider: ImageGenProviderName;
  costEstimateUSD: number;
  latencyMs: number;
};

export type ImageGenTaskStatus =
  | "TASK_STATUS_QUEUED"
  | "TASK_STATUS_PROCESSING"
  | "TASK_STATUS_SUCCEED"
  | "TASK_STATUS_FAILED"
  | "TASK_STATUS_CANCELED";

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
  provider: z.enum(["novita", "runware"]).optional(),
  cost: z.number().optional(),
});

export type ImageGenTaskResult = z.infer<typeof imageGenTaskResultSchema>;

// 一時的な upstream 障害（rate-limit 429 や 5xx）を fallback 対象にするための共通判定。
// 402（課金/クレジット切れ）は billing 由来の fallback として呼び出し側で別途許可する。
export const isTransientUpstreamStatus = (status: number): boolean =>
  status === 408 || status === 425 || status === 429 || status >= 500;

export class ImageGenProviderError extends Error {
  readonly status: number;
  readonly retryable: boolean;
  readonly fallbackEligible: boolean;
  // どの provider が落としたか / 上流応答本文の要約。prod 失敗の一次証拠を残すための観測性フィールド。
  readonly provider?: ImageGenProviderName;
  readonly detail?: string;

  constructor(
    message: string,
    options: {
      status: number;
      retryable?: boolean;
      fallbackEligible?: boolean;
      provider?: ImageGenProviderName;
      detail?: string;
    },
  ) {
    super(message);
    this.name = "ImageGenProviderError";
    this.status = options.status;
    this.retryable = options.retryable ?? false;
    this.fallbackEligible = options.fallbackEligible ?? false;
    this.provider = options.provider;
    this.detail = options.detail;
  }
}

export interface ImageGenProvider {
  readonly name: ImageGenProviderName;
  generate(req: ImageGenRequest): Promise<ImageGenInitResponse>;
  getTaskResult(taskId: string): Promise<ImageGenTaskResult>;
  estimateCostUSD(req: ImageGenRequest): number;
  healthCheck(): Promise<{ ok: boolean; latencyMs: number }>;
}

export interface TaskStore {
  get(id: string): Promise<ImageGenTaskResult | null>;
  set(id: string, result: ImageGenTaskResult): Promise<void>;
  delete(id: string): Promise<void>;
}

export type ImageGenProviderConfig = {
  novitaApiKey?: string;
  runwareApiKey?: string;
  // 外部APIモック(.codex/mock-server.mjs)を使う際の origin。
  // 実環境では未設定、ローカル検証では http://127.0.0.1:8790 などを指定する。
  novitaApiBase?: string;
  runwareApiBase?: string;
  fetchImpl?: typeof fetch;
  taskStore?: TaskStore;
};
