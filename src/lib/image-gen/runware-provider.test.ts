import { describe, expect, it, vi } from "vitest";

import {
  ImageGenProviderError,
  type ImageGenRequest,
  type ImageGenTaskResult,
  type TaskStore,
} from "./provider";
import { isRunwareTaskId, RunwareImageGenProvider } from "./runware-provider";

const request: ImageGenRequest = {
  prompt: "sakurakoharu, 1girl, nude",
  negativePrompt: "lowres, bad anatomy",
  width: 832,
  height: 1216,
  model: "waiNSFWIllustrious_v90_1187991.safetensors",
  steps: 30,
  guidanceScale: 5,
  seed: 777,
  loras: [{ model: "aiadultapp:sakurakoharu@1", weight: 0.85 }],
};

const createMemoryTaskStore = (): TaskStore & { entries: Map<string, ImageGenTaskResult> } => {
  const entries = new Map<string, ImageGenTaskResult>();
  return {
    entries,
    get: async (id) => entries.get(id) ?? null,
    set: async (id, result) => {
      entries.set(id, result);
    },
    delete: async (id) => {
      entries.delete(id);
    },
  };
};

const getTaskUUIDFromBody = (init: RequestInit | undefined): string => {
  const parsed = JSON.parse(String(init?.body)) as Array<Record<string, unknown>>;
  const task = parsed.find((t) => typeof t.taskUUID === "string");
  return String(task?.taskUUID);
};

const runwareSuccessResponse = (taskUUID: string): Response =>
  new Response(
    JSON.stringify({
      data: [
        {
          taskType: "imageInference",
          taskUUID,
          imageURL: "https://im.runware.ai/image/ws/2/ii/abc.jpg",
          seed: 777,
        },
      ],
    }),
    { status: 200 },
  );

const runwareProcessingResponse = (taskUUID: string): Response =>
  new Response(
    JSON.stringify({
      data: [
        {
          taskType: "imageInference",
          taskUUID,
          status: "processing",
        },
      ],
    }),
    { status: 200 },
  );

const runwareErrorResponse = (taskUUID: string, message: string): Response =>
  new Response(
    JSON.stringify({
      data: [{ taskType: "imageInference", taskUUID, status: "processing" }],
      errors: [{ taskUUID, message }],
    }),
    { status: 200 },
  );

describe("RunwareImageGenProvider", () => {
  it("uses async delivery method and returns task_id immediately", async () => {
    const taskStore = createMemoryTaskStore();
    let capturedBody: string | undefined;
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      capturedBody = String(init?.body);
      return runwareProcessingResponse(getTaskUUIDFromBody(init));
    });

    const provider = new RunwareImageGenProvider({
      runwareApiKey: "rw-key",
      fetchImpl,
      taskStore,
    });

    const init = await provider.generate(request);
    expect(init.provider).toBe("runware");
    expect(isRunwareTaskId(init.taskId)).toBe(true);

    const stored = taskStore.entries.get(init.taskId);
    expect(stored?.task.status).toBe("TASK_STATUS_PROCESSING");

    const parsed = JSON.parse(String(capturedBody)) as Array<Record<string, unknown>>;
    const inference = parsed.find((t) => t.taskType === "imageInference");
    expect(inference?.model).toBe("aiadultapp:waiillustrious@9");
    expect(inference?.lora).toEqual([{ model: "aiadultapp:sakurakoharu@1", weight: 0.85 }]);
    expect(inference?.seed).toBe(777);
    expect(inference?.CFGScale).toBe(5);
    expect(inference?.deliveryMethod).toBe("async");
  });

  it("getTaskResult polls getResponse until the image is ready", async () => {
    const taskStore = createMemoryTaskStore();
    let callCount = 0;
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      callCount++;
      if (callCount === 1) return runwareProcessingResponse(getTaskUUIDFromBody(init));
      return runwareSuccessResponse(getTaskUUIDFromBody(init));
    });

    const provider = new RunwareImageGenProvider({
      runwareApiKey: "rw-key",
      fetchImpl,
      taskStore,
    });

    const init = await provider.generate(request);
    const result = await provider.getTaskResult(init.taskId);
    expect(result.task.status).toBe("TASK_STATUS_SUCCEED");
    expect(result.images?.[0]?.image_url).toContain("im.runware.ai");
    expect(callCount).toBe(2);
  });

  it("getTaskResult returns cached success result without re-polling", async () => {
    const taskStore = createMemoryTaskStore();
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) =>
      runwareSuccessResponse(getTaskUUIDFromBody(init)),
    );

    const provider = new RunwareImageGenProvider({
      runwareApiKey: "rw-key",
      fetchImpl,
      taskStore,
    });

    const init = await provider.generate(request);
    const first = await provider.getTaskResult(init.taskId);
    expect(first.task.status).toBe("TASK_STATUS_SUCCEED");

    const second = await provider.getTaskResult(init.taskId);
    expect(second.task.status).toBe("TASK_STATUS_SUCCEED");
    // generate 時の init 応答ですでに SUCCEED が保存されるため getTaskResult は追加 fetch しない
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("stores a success result immediately when init returns an imageURL", async () => {
    const taskStore = createMemoryTaskStore();
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) =>
      runwareSuccessResponse(getTaskUUIDFromBody(init)),
    );

    const provider = new RunwareImageGenProvider({
      runwareApiKey: "rw-key",
      fetchImpl,
      taskStore,
    });

    const init = await provider.generate(request);
    const stored = taskStore.entries.get(init.taskId);
    expect(stored?.task.status).toBe("TASK_STATUS_SUCCEED");
    expect(stored?.images?.[0]?.image_url).toContain("im.runware.ai");
  });

  it("throws a retryable error when init response contains an error", async () => {
    const taskStore = createMemoryTaskStore();
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) =>
      runwareErrorResponse(getTaskUUIDFromBody(init), "GPU queue full"),
    );

    const provider = new RunwareImageGenProvider({
      runwareApiKey: "rw-key",
      fetchImpl,
      taskStore,
    });

    const error = await provider.generate(request).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ImageGenProviderError);
    expect((error as ImageGenProviderError).status).toBe(502);
    expect((error as ImageGenProviderError).retryable).toBe(true);
  });

  it("throws a retryable error when getResponse contains an error", async () => {
    const taskStore = createMemoryTaskStore();
    let callCount = 0;
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      callCount++;
      const taskUUID = getTaskUUIDFromBody(init);
      if (callCount === 1) return runwareProcessingResponse(taskUUID);
      return runwareErrorResponse(taskUUID, "GPU queue full");
    });

    const provider = new RunwareImageGenProvider({
      runwareApiKey: "rw-key",
      fetchImpl,
      taskStore,
    });

    const init = await provider.generate(request);
    const error = await provider.getTaskResult(init.taskId).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ImageGenProviderError);
    expect((error as ImageGenProviderError).status).toBe(502);
    expect((error as ImageGenProviderError).retryable).toBe(true);
  });

  it("getTaskResult returns processing when polling times out", async () => {
    const taskStore = createMemoryTaskStore();
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) =>
      runwareProcessingResponse(getTaskUUIDFromBody(init)),
    );

    const provider = new RunwareImageGenProvider({
      runwareApiKey: "rw-key",
      fetchImpl,
      taskStore,
    });

    const init = await provider.generate(request);
    const result = await provider.getTaskResult(init.taskId);
    expect(result.task.status).toBe("TASK_STATUS_PROCESSING");
  }, 25_000);

  it("throws 503 fallbackEligible when the api key is missing", async () => {
    const provider = new RunwareImageGenProvider({ taskStore: createMemoryTaskStore() });
    const error = await provider.generate(request).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ImageGenProviderError);
    expect((error as ImageGenProviderError).status).toBe(503);
    expect((error as ImageGenProviderError).fallbackEligible).toBe(true);
  });

  it("rejects unmapped model names instead of passing them through", async () => {
    const provider = new RunwareImageGenProvider({
      runwareApiKey: "rw-key",
      taskStore: createMemoryTaskStore(),
      fetchImpl: vi.fn<typeof fetch>(),
    });
    const error = await provider
      .generate({ ...request, model: "unknown-model.safetensors" })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ImageGenProviderError);
    expect((error as ImageGenProviderError).status).toBe(400);
    expect((error as ImageGenProviderError).retryable).toBe(false);
  });

  it("marks 429/5xx upstream failures as fallback eligible", async () => {
    const provider = new RunwareImageGenProvider({
      runwareApiKey: "rw-key",
      taskStore: createMemoryTaskStore(),
      fetchImpl: vi.fn<typeof fetch>(async () => new Response("rate limited", { status: 429 })),
    });
    const error = await provider.generate(request).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ImageGenProviderError);
    expect((error as ImageGenProviderError).status).toBe(429);
    expect((error as ImageGenProviderError).fallbackEligible).toBe(true);
  });
});
