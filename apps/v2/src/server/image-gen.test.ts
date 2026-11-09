// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { IMAGE_GEN_MODEL, ImageGenProviderError, NovitaImageGen } from "./image-gen";

import type { ImageGenRequest } from "./image-gen";

const baseRequest: ImageGenRequest = {
  prompt: "1girl, solo, masterpiece",
  negativePrompt: "lowres",
  width: 768,
  height: 1024,
  steps: 32,
  guidanceScale: 7,
};

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const providerWith = (
  respond: (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>,
) => {
  const fetchImpl = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => respond(input, init),
  );
  const provider = new NovitaImageGen({ apiKey: "test-key", fetchImpl });
  return { provider, fetchImpl };
};

describe("NovitaImageGen", () => {
  it("txt2img init は固定モデル・png 応答・既定 sampler/seed で送る", async () => {
    const { provider, fetchImpl } = providerWith(async () => jsonResponse({ task_id: "t-1" }));
    const result = await provider.generate(baseRequest);
    expect(result.taskId).toBe("t-1");

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.novita.ai/v3/async/txt2img");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
    const body = JSON.parse(String(init.body)) as {
      extra: { response_image_type: string };
      request: Record<string, unknown>;
    };
    expect(body.extra.response_image_type).toBe("png");
    expect(body.request.model_name).toBe(IMAGE_GEN_MODEL);
    expect(body.request.sampler_name).toBe("DPM++ 2M Karras");
    expect(body.request.seed).toBe(-1);
    expect(body.request.image_num).toBe(1);
  });

  it("参照画像があると img2img エンドポイントへ切り替わる", async () => {
    const { provider, fetchImpl } = providerWith(async () => jsonResponse({ task_id: "t-i2i" }));
    await provider.generate({ ...baseRequest, imageBase64: "AAAA", strength: 0.5 });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.novita.ai/v3/async/img2img");
    const body = JSON.parse(String(init.body)) as { request: Record<string, unknown> };
    expect(body.request.image_base64).toBe("AAAA");
    expect(body.request.strength).toBe(0.5);
  });

  it("プロンプトが 1024 rune を超える時カンマ境界で切り詰める", async () => {
    const { provider, fetchImpl } = providerWith(async () => jsonResponse({ task_id: "t-clamp" }));
    const longPrompt = `${"a".repeat(1020)}, last_tag, overflow`;
    await provider.generate({ ...baseRequest, prompt: longPrompt });
    const body = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body)) as {
      request: { prompt: string };
    };
    expect([...body.request.prompt].length).toBeLessThanOrEqual(1024);
    expect(body.request.prompt).not.toContain("overflow");
  });

  it("429/503 はリトライし、次の応答を拾う", async () => {
    let calls = 0;
    const { provider, fetchImpl } = providerWith(async () => {
      calls += 1;
      return calls < 3
        ? new Response("busy", { status: 503 })
        : jsonResponse({ task_id: "t-retried" });
    });
    const result = await provider.generate(baseRequest);
    expect(result.taskId).toBe("t-retried");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  }, 20_000);

  it("400 の init 失敗はリトライせず ImageGenProviderError になる", async () => {
    const { provider, fetchImpl } = providerWith(
      async () => new Response("bad request", { status: 400 }),
    );
    await expect(provider.generate(baseRequest)).rejects.toMatchObject({
      name: "ImageGenProviderError",
      status: 400,
      retryable: false,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("API キー未設定は fetch せず 503 になる", async () => {
    const provider = new NovitaImageGen({ apiKey: undefined });
    await expect(provider.generate(baseRequest)).rejects.toSatisfy(
      (error: unknown) => error instanceof ImageGenProviderError && error.status === 503,
    );
  });

  it("task-result は queued/processing/succeed/failed を読み分ける", async () => {
    const succeed = {
      task: { task_id: "t", status: "TASK_STATUS_SUCCEED", progress_percent: 100 },
      images: [{ image_url: "https://img/out.png", image_seed: 42 }],
    };
    const { provider } = providerWith(async () => jsonResponse(succeed));
    const result = await provider.getTaskResult("t");
    expect(result.task.status).toBe("TASK_STATUS_SUCCEED");
    expect(result.images?.[0]?.image_url).toBe("https://img/out.png");
  });

  it("task-result の 400 は retryable ではない失敗を投げる", async () => {
    const { provider, fetchImpl } = providerWith(async () => new Response("gone", { status: 400 }));
    await expect(provider.getTaskResult("t")).rejects.toMatchObject({
      status: 400,
      retryable: false,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("task-result の破損 JSON は ImageGenProviderError になる", async () => {
    const { provider } = providerWith(async () => jsonResponse({ unexpected: true }));
    await expect(provider.getTaskResult("t")).rejects.toMatchObject({
      name: "ImageGenProviderError",
      status: 502,
    });
  });
});
