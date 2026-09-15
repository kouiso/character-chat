import { describe, expect, it, vi } from "vitest";

import { NovitaImageGenProvider } from "./novita-provider";
import { ImageGenProviderError, type ImageGenProvider, type ImageGenRequest } from "./provider";
import { createImageGenRouter } from "./router";

const request: ImageGenRequest = {
  prompt: "prompt",
  negativePrompt: "negative",
  width: 768,
  height: 1024,
  model: "sdxl-base",
  steps: 20,
  guidanceScale: 7,
};

const makeProvider = (
  generate: ImageGenProvider["generate"],
  name: ImageGenProvider["name"] = "novita",
): ImageGenProvider => ({
  name,
  generate,
  estimateCostUSD: () => 0.001,
  healthCheck: async () => ({ ok: true, latencyMs: 1 }),
  getTaskResult: async (taskId) => ({
    task: { task_id: taskId, status: "TASK_STATUS_SUCCEED", progress_percent: 100 },
    images: [{ image_url: "https://example.com/image.jpg" }],
    provider: name,
  }),
});

describe("ImageGenRouter", () => {
  it("routes to novita", async () => {
    const novitaGenerate = vi.fn(async () => ({
      taskId: "novita-task",
      provider: "novita" as const,
      costEstimateUSD: 0.001,
      latencyMs: 1,
    }));
    const router = createImageGenRouter({}, { novita: makeProvider(novitaGenerate) });

    await expect(router.generate(request)).resolves.toMatchObject({
      taskId: "novita-task",
      provider: "novita",
    });
    expect(novitaGenerate).toHaveBeenCalledOnce();
  });

  it("routes LoRA requests to runware and never novita", async () => {
    const novitaGenerate = vi.fn(async () => {
      throw new Error("novita must not be called for lora requests");
    });
    const runwareGenerate = vi.fn(async () => ({
      taskId: "runware-uuid",
      provider: "runware" as const,
      costEstimateUSD: 0.0008,
      latencyMs: 1,
    }));
    const router = createImageGenRouter(
      { novitaApiKey: "nk", runwareApiKey: "rk" },
      {
        novita: makeProvider(novitaGenerate),
        runware: makeProvider(runwareGenerate, "runware"),
      },
    );

    await expect(
      router.generate({
        ...request,
        loras: [{ model: "aiadultapp:sakurakoharu@1", weight: 0.85 }],
      }),
    ).resolves.toMatchObject({ provider: "runware" });
    expect(runwareGenerate).toHaveBeenCalledOnce();
    expect(novitaGenerate).not.toHaveBeenCalled();
  });

  it("rejects LoRA requests with a clear 503 when no runware key is configured", async () => {
    const novitaGenerate = vi.fn(async () => {
      throw new Error("novita must not be called for lora requests");
    });
    const router = createImageGenRouter({}, { novita: makeProvider(novitaGenerate) });

    await expect(
      router.generate({
        ...request,
        loras: [{ model: "aiadultapp:sakurakoharu@1", weight: 0.85 }],
      }),
    ).rejects.toThrow("lora generation requires runware key");
    expect(novitaGenerate).not.toHaveBeenCalled();
  });

  it("falls back from novita to runware on fallback-eligible errors, dropping loras is not needed (no loras path)", async () => {
    const novitaGenerate = vi.fn(async () => {
      throw new ImageGenProviderError("credits exhausted", {
        status: 402,
        fallbackEligible: true,
        provider: "novita",
      });
    });
    const runwareGenerate = vi.fn(async () => ({
      taskId: "runware-uuid",
      provider: "runware" as const,
      costEstimateUSD: 0.0008,
      latencyMs: 1,
    }));
    const router = createImageGenRouter(
      { novitaApiKey: "nk", runwareApiKey: "rk" },
      {
        novita: makeProvider(novitaGenerate),
        runware: makeProvider(runwareGenerate, "runware"),
      },
    );

    await expect(router.generate(request)).resolves.toMatchObject({ provider: "runware" });
    expect(novitaGenerate).toHaveBeenCalledOnce();
    expect(runwareGenerate).toHaveBeenCalledOnce();
  });

  it("does not fall back when no runware key is configured", async () => {
    const novitaGenerate = vi.fn(async () => {
      throw new ImageGenProviderError("credits exhausted", {
        status: 402,
        fallbackEligible: true,
        provider: "novita",
      });
    });
    const router = createImageGenRouter({}, { novita: makeProvider(novitaGenerate) });

    await expect(router.generate(request)).rejects.toThrow("credits exhausted");
  });

  it("dispatches getTaskResult by task id prefix", async () => {
    const router = createImageGenRouter(
      { novitaApiKey: "nk", runwareApiKey: "rk" },
      {
        novita: makeProvider(vi.fn()),
        runware: makeProvider(vi.fn(), "runware"),
      },
    );

    await expect(router.getTaskResult("runware-abc")).resolves.toMatchObject({
      provider: "runware",
    });
    await expect(router.getTaskResult("novita-task-id")).resolves.toMatchObject({
      provider: "novita",
    });
  });

  it("propagates non-fallback-eligible 4xx errors", async () => {
    const router = createImageGenRouter(
      {},
      {
        novita: makeProvider(async () => {
          throw new ImageGenProviderError("bad request", {
            status: 400,
            fallbackEligible: false,
          });
        }),
      },
    );

    await expect(router.generate(request)).rejects.toThrow("bad request");
  });

  it("propagates rate-limit errors from the real novita provider after retries", async () => {
    vi.useFakeTimers();
    try {
      const novitaFetch = vi.fn<typeof fetch>(
        async () => new Response("rate limited", { status: 429 }),
      );
      const realNovita = new NovitaImageGenProvider({
        novitaApiKey: "novita-key",
        fetchImpl: novitaFetch,
      });
      const router = createImageGenRouter({}, { novita: realNovita });

      const generated = router.generate(request);
      const shouldReject = expect(generated).rejects.toThrow();
      await vi.runAllTimersAsync();
      await shouldReject;
      expect(novitaFetch).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("propagates 503 errors after retries from the real novita provider", async () => {
    vi.useFakeTimers();
    try {
      const novitaFetch = vi.fn<typeof fetch>(
        async () => new Response("unavailable", { status: 503 }),
      );
      const realNovita = new NovitaImageGenProvider({
        novitaApiKey: "novita-key",
        fetchImpl: novitaFetch,
      });
      const router = createImageGenRouter({}, { novita: realNovita });

      // rejects をタイマー前にセットアップして unhandled rejection を防ぐ
      const generated = router.generate(request);
      const shouldReject = expect(generated).rejects.toThrow();
      await vi.runAllTimersAsync();
      await shouldReject;
      expect(novitaFetch).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });
});
