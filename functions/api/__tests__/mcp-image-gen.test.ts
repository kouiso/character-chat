import { describe, expect, it } from "vitest";

import type {
  ImageGenInitResponse,
  ImageGenProvider,
  ImageGenTaskResult,
} from "../../../src/lib/image-gen/provider";
import { checkMcpAuth, createMcpImageGenHandler } from "../../mcp/_shared";

const succeedResult = (taskId: string): ImageGenTaskResult => ({
  task: {
    task_id: taskId,
    status: "TASK_STATUS_SUCCEED",
    progress_percent: 100,
  },
  images: [{ image_url: "https://example.com/out.png", seed: 12345 }],
});

const makeProvider = (overrides: Partial<ImageGenProvider> = {}): ImageGenProvider => ({
  name: "novita",
  generate: async (): Promise<ImageGenInitResponse> => ({
    taskId: "task-1",
    provider: "novita",
    costEstimateUSD: 0.01,
    latencyMs: 5,
  }),
  getTaskResult: async (taskId: string) => succeedResult(taskId),
  estimateCostUSD: () => 0.01,
  healthCheck: async () => ({ ok: true, latencyMs: 1 }),
  ...overrides,
});

const makeRequest = (token?: string, body: unknown = { prompt: "1girl" }) =>
  new Request("https://example.com/mcp/novita", {
    method: "POST",
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: JSON.stringify(body),
  });

const timing = { pollIntervalMs: 0, maxWaitMs: 1000 };

const callHandler = (request: Request, env: Record<string, string | undefined>) =>
  createMcpImageGenHandler("novita", () => makeProvider(), timing)({ request, env });

describe("checkMcpAuth", () => {
  it("MCP_TOKEN 未設定なら 503", () => {
    const res = checkMcpAuth(makeRequest("any"), {});
    expect(res?.status).toBe(503);
  });

  it("トークン不一致なら 401", () => {
    expect(checkMcpAuth(makeRequest("wrong"), { MCP_TOKEN: "secret" })?.status).toBe(401);
    expect(checkMcpAuth(makeRequest(), { MCP_TOKEN: "secret" })?.status).toBe(401);
  });

  it("トークン一致なら通す", () => {
    expect(checkMcpAuth(makeRequest("secret"), { MCP_TOKEN: "secret" })).toBeNull();
  });
});

describe("createMcpImageGenHandler", () => {
  it("正しいトークンで生成結果を返す", async () => {
    const res = await callHandler(makeRequest("secret"), { MCP_TOKEN: "secret" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { taskId: string; images: Array<{ image_url: string }> };
    expect(body.taskId).toBe("task-1");
    expect(body.images[0]?.image_url).toBe("https://example.com/out.png");
  });

  it("トークン不正なら provider を呼ばず拒否する", async () => {
    let called = false;
    const handler = createMcpImageGenHandler("novita", () =>
      makeProvider({
        generate: async () => {
          called = true;
          return { taskId: "x", provider: "novita", costEstimateUSD: 0, latencyMs: 0 };
        },
      }),
    );
    const res = await handler({
      request: makeRequest("wrong"),
      env: { MCP_TOKEN: "secret" },
    });
    expect(res.status).toBe(401);
    expect(called).toBe(false);
  });

  it("不正ボディは 400", async () => {
    const res = await callHandler(makeRequest("secret", {}), { MCP_TOKEN: "secret" });
    expect(res.status).toBe(400);
  });

  it("上流タスクが失敗したら 502", async () => {
    const handler = createMcpImageGenHandler(
      "novita",
      () =>
        makeProvider({
          getTaskResult: async (taskId) => ({
            task: { task_id: taskId, status: "TASK_STATUS_FAILED", progress_percent: 100 },
          }),
        }),
      timing,
    );
    const res = await handler({ request: makeRequest("secret"), env: { MCP_TOKEN: "secret" } });
    expect(res.status).toBe(502);
  });
});
