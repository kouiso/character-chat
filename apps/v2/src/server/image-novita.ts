// Novita async API の最小クライアント（txt2img 起動 + task-result 参照）。
// v1 の src/lib/image-gen/novita-provider.ts は Pages Functions 側のコードなので、
// Worker からは必要な2経路だけをここへ置く。振る舞い（browser UA・リトライ・rune 制限）を
// 変える時は v1 側とずれんよう注意。
import { z } from "zod";

export const NOVITA_TXT2IMG_MODEL = "waiNSFWIllustrious_v90_1187991.safetensors";

const NOVITA_INIT_TIMEOUT_MS = 15_000;
const NOVITA_POLL_TIMEOUT_MS = 10_000;
const NOVITA_INIT_MAX_ATTEMPTS = 3;
const NOVITA_INIT_RETRY_BASE_MS = 2_000;
// 429 はレート制限、5xx は上流障害。両方とも再試行で回復しうる。
const NOVITA_RETRY_STATUSES = new Set([429, 502, 503, 504]);
// Novita は prompt/negative_prompt を 1024 runes に制限する。超過は 400 で即失敗する。
const NOVITA_PROMPT_MAX_RUNES = 1024;
// no-UA の fetch は Cloudflare 1010 bot-block に当たるので browser UA を送る（v1 と同じ）。
const NOVITA_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const clampToRunes = (text: string, max: number): string => {
  const runes = Array.from(text);
  if (runes.length <= max) return text;
  const head = runes.slice(0, max).join("");
  const lastComma = head.lastIndexOf(",");
  return (lastComma > 0 ? head.slice(0, lastComma) : head).trimEnd();
};

const initResponseSchema = z.object({ task_id: z.string() });

const taskResultSchema = z.object({
  task: z.object({
    task_id: z.string(),
    status: z.enum([
      "TASK_STATUS_QUEUED",
      "TASK_STATUS_PROCESSING",
      "TASK_STATUS_SUCCEED",
      "TASK_STATUS_FAILED",
      "TASK_STATUS_CANCELED",
    ]),
  }),
  images: z
    .array(
      z.object({
        image_url: z.string(),
        seed: z.union([z.string(), z.number()]).optional(),
      }),
    )
    .optional(),
});

export type NovitaTaskResult = z.infer<typeof taskResultSchema>;

export class NovitaError extends Error {
  readonly status: number;
  // 429/5xx・切断は回復可能、400 系・レスポンス異形は回復不能と見なす。
  readonly retryable: boolean;
  constructor(message: string, options: { status: number; retryable: boolean }) {
    super(message);
    this.name = "NovitaError";
    this.status = options.status;
    this.retryable = options.retryable;
  }
}

export type NovitaTxt2ImgInput = {
  prompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  steps: number;
  guidanceScale: number;
  seed?: number;
};

// img2img は txt2img と同じパラメータ群に参照絵と保持度を足す。
// strength は元画像の保持度（低いほど元に忠実。v1 のキャラ一致パスと同じ既定 0.45 を使う）。
export type NovitaImg2ImgInput = NovitaTxt2ImgInput & {
  imageBase64: string;
  strength: number;
};

const readDetail = async (response: Response): Promise<string | undefined> => {
  try {
    const text = await response.text();
    return text ? text.slice(0, 300) : undefined;
  } catch {
    return undefined;
  }
};

export type NovitaClient = {
  initTxt2Img: (input: NovitaTxt2ImgInput) => Promise<string>;
  initImg2Img: (input: NovitaImg2ImgInput) => Promise<string>;
  taskResult: (taskId: string) => Promise<NovitaTaskResult>;
};

// MOCK_API_BASE があればそちらへ向ける（ローカル検証・mock-server 用。v1 と同じ仕組み）。
export const createNovitaClient = (options: {
  apiKey: string | undefined;
  apiBase?: string;
  fetchImpl?: typeof fetch;
}): NovitaClient => {
  const base = `${options.apiBase ?? "https://api.novita.ai"}/v3/async`;
  const fetchImpl = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

  const requireKey = (): string => {
    if (options.apiKey) return options.apiKey;
    throw new NovitaError("novita api key is not configured", { status: 503, retryable: false });
  };

  const postInit = async (endpoint: string, body: string): Promise<Response> => {
    const controller = new AbortController();
    setTimeout(() => controller.abort("novita_init_timeout"), NOVITA_INIT_TIMEOUT_MS);
    let response: Response | null = null;
    for (let attempt = 0; attempt < NOVITA_INIT_MAX_ATTEMPTS; attempt += 1) {
      try {
        response = await fetchImpl(endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${options.apiKey ?? ""}`,
            "Content-Type": "application/json",
            "User-Agent": NOVITA_USER_AGENT,
          },
          body,
          signal: controller.signal,
        });
      } catch (error) {
        if (attempt === NOVITA_INIT_MAX_ATTEMPTS - 1) {
          throw new NovitaError(`novita network error: ${String(error)}`, {
            status: 502,
            retryable: true,
          });
        }
        await wait(NOVITA_INIT_RETRY_BASE_MS * 2 ** attempt);
        continue;
      }
      if (response.ok || !NOVITA_RETRY_STATUSES.has(response.status)) return response;
      if (attempt === NOVITA_INIT_MAX_ATTEMPTS - 1) return response;
      await wait(NOVITA_INIT_RETRY_BASE_MS * 2 ** attempt);
    }
    throw new NovitaError("novita init attempts exhausted", { status: 502, retryable: true });
  };

  const initTxt2Img = async (input: NovitaTxt2ImgInput): Promise<string> => {
    requireKey();
    const body = JSON.stringify({
      extra: { response_image_type: "png" },
      request: {
        model_name: NOVITA_TXT2IMG_MODEL,
        prompt: clampToRunes(input.prompt, NOVITA_PROMPT_MAX_RUNES),
        negative_prompt: clampToRunes(input.negativePrompt, NOVITA_PROMPT_MAX_RUNES),
        width: input.width,
        height: input.height,
        sampler_name: "DPM++ 2M Karras",
        steps: input.steps,
        guidance_scale: input.guidanceScale,
        image_num: 1,
        seed: input.seed ?? -1,
      },
    });
    const response = await postInit(`${base}/txt2img`, body);
    if (!response.ok) {
      const detail = await readDetail(response);
      throw new NovitaError(`novita init failed${detail ? `: ${detail}` : ""}`, {
        status: response.status,
        retryable: NOVITA_RETRY_STATUSES.has(response.status),
      });
    }
    const parsed = initResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new NovitaError("unexpected novita init response", {
        status: 502,
        retryable: false,
      });
    }
    return parsed.data.task_id;
  };

  const initImg2Img = async (input: NovitaImg2ImgInput): Promise<string> => {
    requireKey();
    const body = JSON.stringify({
      extra: { response_image_type: "png" },
      request: {
        model_name: NOVITA_TXT2IMG_MODEL,
        prompt: clampToRunes(input.prompt, NOVITA_PROMPT_MAX_RUNES),
        negative_prompt: clampToRunes(input.negativePrompt, NOVITA_PROMPT_MAX_RUNES),
        image_base64: input.imageBase64,
        strength: input.strength,
        width: input.width,
        height: input.height,
        sampler_name: "DPM++ 2M Karras",
        steps: input.steps,
        guidance_scale: input.guidanceScale,
        image_num: 1,
        seed: input.seed ?? -1,
      },
    });
    const response = await postInit(`${base}/img2img`, body);
    if (!response.ok) {
      const detail = await readDetail(response);
      throw new NovitaError(`novita img2img init failed${detail ? `: ${detail}` : ""}`, {
        status: response.status,
        retryable: NOVITA_RETRY_STATUSES.has(response.status),
      });
    }
    const parsed = initResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new NovitaError("unexpected novita img2img init response", {
        status: 502,
        retryable: false,
      });
    }
    return parsed.data.task_id;
  };

  const taskResult = async (taskId: string): Promise<NovitaTaskResult> => {
    requireKey();
    const controller = new AbortController();
    setTimeout(() => controller.abort("novita_poll_timeout"), NOVITA_POLL_TIMEOUT_MS);
    const response = await fetchImpl(`${base}/task-result?task_id=${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${options.apiKey ?? ""}`, "User-Agent": NOVITA_USER_AGENT },
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = await readDetail(response);
      throw new NovitaError(`novita task-result failed${detail ? `: ${detail}` : ""}`, {
        status: response.status,
        retryable: NOVITA_RETRY_STATUSES.has(response.status),
      });
    }
    const parsed = taskResultSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new NovitaError("unexpected novita task-result response", {
        status: 502,
        retryable: false,
      });
    }
    return parsed.data;
  };

  return { initTxt2Img, initImg2Img, taskResult };
};
