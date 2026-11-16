// Runware imageInference の最小クライアント。Novita 側が残高不足・障害で init に
// 失敗した時の逃げ道として、同じ固定モデル（wai NSFW Illustrious v9.0 = AIR
// aiadultapp:waiillustrious@9）を別プロバイダで動かす。形は image-novita と揃える
// （init が task_id、taskResult が状態+画像 URL を返す）ので poll 経路は使い回せる。
import { z } from "zod";

import type { NovitaImg2ImgInput, NovitaTaskResult, NovitaTxt2ImgInput } from "./image-novita";

const RUNWARE_API_DEFAULT_URL = "https://api.runware.ai/v1";
const RUNWARE_INIT_TIMEOUT_MS = 15_000;
const RUNWARE_POLL_TIMEOUT_MS = 10_000;
// deliveryMethod: async でキュー投入し、getResponse は呼び出し側の poll ループに任せる
// （v1 実測: 同期接続を保持すると Cloudflare 側で切れる）。
const RUNWARE_TASK_PREFIX = "runware-";

// アプリの公開モデル名 → Runware AIR ID。Runware には自前のチェックポイントしか無いので
// 未知名を素通しすると必ず失敗する。v1 の RUNWARE_MODEL_MAP と同じ対応。
const RUNWARE_MODEL_MAP: Record<string, string> = {
  waiNSFWIllustrious_v90_1187991: "aiadultapp:waiillustrious@9",
  "waiNSFWIllustrious_v90_1187991.safetensors": "aiadultapp:waiillustrious@9",
};

export class RunwareError extends Error {
  readonly status: number;
  readonly retryable: boolean;
  constructor(message: string, options: { status: number; retryable: boolean }) {
    super(message);
    this.name = "RunwareError";
    this.status = options.status;
    this.retryable = options.retryable;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const imageEntrySchema = z.object({
  taskType: z.literal("imageInference"),
  taskUUID: z.string(),
  imageURL: z.string(),
  seed: z.number().optional(),
});

const readDetail = async (response: Response): Promise<string | undefined> => {
  try {
    const text = await response.text();
    return text ? text.slice(0, 300) : undefined;
  } catch {
    return undefined;
  }
};

const findImages = (payload: unknown, taskUUID: string) => {
  if (!isRecord(payload) || !Array.isArray(payload.data)) return [];
  const images: { image_url: string; seed?: number }[] = [];
  for (const item of payload.data) {
    const parsed = imageEntrySchema.safeParse(item);
    if (parsed.success && parsed.data.taskUUID === taskUUID) {
      images.push({ image_url: parsed.data.imageURL, seed: parsed.data.seed });
    }
  }
  return images;
};

const findError = (payload: unknown, taskUUID: string): string | undefined => {
  if (!isRecord(payload) || !Array.isArray(payload.errors)) return undefined;
  const entries = payload.errors.filter(isRecord).map((item) => ({
    taskUUID: item.taskUUID,
    text:
      (typeof item.message === "string" ? item.message : undefined) ??
      (typeof item.code === "string" ? item.code : undefined),
  }));
  const match = entries.find((entry) => entry.taskUUID === taskUUID && entry.text);
  return match?.text ?? entries.find((entry) => entry.text)?.text;
};

export const createRunwareClient = (options: {
  apiKey: string | undefined;
  apiBase?: string;
  fetchImpl?: typeof fetch;
}) => {
  const base = options.apiBase ?? RUNWARE_API_DEFAULT_URL;
  const fetchImpl = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

  const requireKey = (): string => {
    if (options.apiKey) return options.apiKey;
    throw new RunwareError("runware api key is not configured", {
      status: 503,
      retryable: false,
    });
  };

  const post = async (tasks: Record<string, unknown>[], timeoutMs: number): Promise<unknown> => {
    const controller = new AbortController();
    setTimeout(() => controller.abort("runware_request_timeout"), timeoutMs);
    let response: Response;
    try {
      response = await fetchImpl(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([{ taskType: "authentication", apiKey: requireKey() }, ...tasks]),
        signal: controller.signal,
      });
    } catch (error) {
      throw new RunwareError(`runware network error: ${String(error)}`, {
        status: 502,
        retryable: true,
      });
    }
    if (!response.ok) {
      const detail = await readDetail(response);
      throw new RunwareError(`runware upstream error${detail ? `: ${detail}` : ""}`, {
        status: response.status,
        retryable: response.status === 429 || response.status >= 500,
      });
    }
    return response.json();
  };

  const buildInference = (
    input: NovitaTxt2ImgInput | NovitaImg2ImgInput,
    taskUUID: string,
    model: string,
  ): Record<string, unknown> => {
    const air = RUNWARE_MODEL_MAP[model];
    if (!air) {
      throw new RunwareError(`no runware mapping for model: ${model}`, {
        status: 400,
        retryable: false,
      });
    }
    const task: Record<string, unknown> = {
      taskType: "imageInference",
      taskUUID,
      positivePrompt: input.prompt,
      negativePrompt: input.negativePrompt,
      model: air,
      width: input.width,
      height: input.height,
      steps: input.steps,
      CFGScale: input.guidanceScale,
      numberResults: 1,
      outputType: "URL",
      outputFormat: "JPG",
      deliveryMethod: "async",
    };
    // Runware の seed 省略 = ランダム。Novita 流の -1 は invalid なので付けない。
    if (input.seed !== undefined && input.seed >= 0) task.seed = input.seed;
    if ("imageBase64" in input) {
      task.inputImage = `data:image/png;base64,${input.imageBase64}`;
      task.strength = input.strength;
    }
    return task;
  };

  const init = async (
    input: NovitaTxt2ImgInput | NovitaImg2ImgInput,
    model: string,
  ): Promise<string> => {
    const taskUUID = crypto.randomUUID();
    const payload = await post([buildInference(input, taskUUID, model)], RUNWARE_INIT_TIMEOUT_MS);
    const error = findError(payload, taskUUID);
    if (error) {
      throw new RunwareError(`runware init failed: ${error}`, { status: 502, retryable: true });
    }
    return `${RUNWARE_TASK_PREFIX}${taskUUID}`;
  };

  return {
    initTxt2Img: (input: NovitaTxt2ImgInput): Promise<string> =>
      init(input, "waiNSFWIllustrious_v90_1187991.safetensors"),
    initImg2Img: (input: NovitaImg2ImgInput): Promise<string> =>
      init(input, "waiNSFWIllustrious_v90_1187991.safetensors"),
    taskResult: async (taskId: string): Promise<NovitaTaskResult> => {
      const taskUUID = taskId.slice(RUNWARE_TASK_PREFIX.length);
      const payload = await post([{ taskType: "getResponse", taskUUID }], RUNWARE_POLL_TIMEOUT_MS);
      const images = findImages(payload, taskUUID);
      if (images.length > 0) {
        return {
          task: { task_id: taskId, status: "TASK_STATUS_SUCCEED" },
          images,
        };
      }
      const error = findError(payload, taskUUID);
      if (error) {
        return { task: { task_id: taskId, status: "TASK_STATUS_FAILED" } };
      }
      return { task: { task_id: taskId, status: "TASK_STATUS_PROCESSING" } };
    },
  };
};
