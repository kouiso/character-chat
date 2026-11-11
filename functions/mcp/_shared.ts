import { z } from "zod/v4";

import {
  imageGenTaskResultSchema,
  ImageGenProviderError,
  type ImageGenProvider,
  type ImageGenRequest,
  type TaskStore,
} from "../../src/lib/image-gen/provider";
import { NovitaImageGenProvider } from "../../src/lib/image-gen/novita-provider";
import { RunwareImageGenProvider } from "../../src/lib/image-gen/runware-provider";

// route-context の Bindings を引くと 8 千行モジュールの初期化まで連れてくるので、
// MCP 窓口が必要とするキーだけを構造型で持つ。
export type McpEnv = {
  MCP_TOKEN?: string;
  NOVITA_API_KEY?: string;
  RUNWARE_API_KEY?: string;
  MOCK_API_BASE?: string;
  // Runware は async delivery のため taskStore 必須。main router と同じ R2 スキームを使う。
  BUCKET?: R2Bucket;
};

// route-context.createR2ImageGenTaskStore と同一キー形式。重い route-context を
// mcp 束ねに引き込まないようここに複製する（片方だけ変わると片方のタスクが見えん）。
const createR2TaskStore = (bucket: R2Bucket): TaskStore => ({
  async get(id) {
    const object = await bucket.get(`image-gen-task/${id}.json`);
    if (!object) return null;
    return imageGenTaskResultSchema.parse(await object.json());
  },
  async set(id, result) {
    await bucket.put(`image-gen-task/${id}.json`, JSON.stringify(result), {
      httpMetadata: { contentType: "application/json" },
    });
  },
  async delete(id) {
    await bucket.delete(`image-gen-task/${id}.json`);
  },
});

// Pages Functions の壁時計上限(約60s)に収めるため、上流生成の待ちはこれより内側に収める。
const MCP_RESULT_POLL_INTERVAL_MS = 2_000;
const MCP_RESULT_MAX_WAIT_MS = 50_000;

export const mcpImageGenBodySchema = z.object({
  prompt: z.string().min(1),
  negativePrompt: z.string().default(""),
  width: z.number().int().min(64).max(2048).default(832),
  height: z.number().int().min(64).max(2048).default(1216),
  model: z.string().min(1).default("waiNSFWIllustrious_v90_1187991.safetensors"),
  steps: z.number().int().min(1).max(150).default(30),
  guidanceScale: z.number().min(0).max(30).default(5),
  seed: z.number().int().optional(),
  imageBase64: z.string().optional(),
  strength: z.number().min(0).max(1).optional(),
  loras: z.array(z.object({ model: z.string(), weight: z.number() })).optional(),
});

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

// subtle.crypto.timingSafeEqual は Workers に無いため、長さ一致を挟んで差分累積で比較する。
export const checkMcpAuth = (request: Request, env: McpEnv): Response | null => {
  const token = env.MCP_TOKEN?.trim();
  if (!token) return json({ error: "mcp token not configured" }, 503);

  const auth = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${token}`;
  if (auth.length !== expected.length) return json({ error: "unauthorized" }, 401);
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) {
    diff |= auth.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  if (diff !== 0) return json({ error: "unauthorized" }, 401);
  return null;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export const runMcpGeneration = async (
  provider: ImageGenProvider,
  req: ImageGenRequest,
  options: { pollIntervalMs?: number; maxWaitMs?: number } = {},
): Promise<Response> => {
  const pollIntervalMs = options.pollIntervalMs ?? MCP_RESULT_POLL_INTERVAL_MS;
  const maxWaitMs = options.maxWaitMs ?? MCP_RESULT_MAX_WAIT_MS;

  const init = await provider.generate(req);
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    await sleep(pollIntervalMs);
    const result = await provider.getTaskResult(init.taskId);
    const status = result.task.status;
    if (status === "TASK_STATUS_SUCCEED") {
      return json({
        taskId: init.taskId,
        provider: init.provider,
        costEstimateUSD: init.costEstimateUSD,
        images: result.images ?? [],
      });
    }
    if (status === "TASK_STATUS_FAILED" || status === "TASK_STATUS_CANCELED") {
      return json({ taskId: init.taskId, provider: init.provider, error: status }, 502);
    }
  }
  return json({ taskId: init.taskId, provider: init.provider, error: "timeout" }, 504);
};

const createProvider = (name: "novita" | "runware", env: McpEnv): ImageGenProvider =>
  name === "novita"
    ? new NovitaImageGenProvider({
        novitaApiKey: env.NOVITA_API_KEY,
        novitaApiBase: env.MOCK_API_BASE,
      })
    : new RunwareImageGenProvider({
        runwareApiKey: env.RUNWARE_API_KEY,
        runwareApiBase: env.MOCK_API_BASE,
        taskStore: env.BUCKET ? createR2TaskStore(env.BUCKET) : undefined,
      });

type McpFunctionContext = { request: Request; env: McpEnv };

export const createMcpImageGenHandler =
  (
    name: "novita" | "runware",
    providerFactory: (env: McpEnv) => ImageGenProvider = (env) => createProvider(name, env),
    timing: { pollIntervalMs?: number; maxWaitMs?: number } = {},
  ) =>
  async ({ request, env }: McpFunctionContext): Promise<Response> => {
    const authError = checkMcpAuth(request, env);
    if (authError) return authError;

    const body = await request.json().catch(() => null);
    const parsed = mcpImageGenBodySchema.safeParse(body);
    if (!parsed.success) {
      return json({ error: "invalid request", issues: parsed.error.issues }, 400);
    }

    try {
      return await runMcpGeneration(providerFactory(env), parsed.data, timing);
    } catch (error) {
      if (error instanceof ImageGenProviderError) {
        return json(
          { error: error.message, provider: error.provider, detail: error.detail },
          error.status,
        );
      }
      throw error;
    }
  };
