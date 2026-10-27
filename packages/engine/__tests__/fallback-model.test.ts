import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessageChunk, HumanMessage } from "@langchain/core/messages";
import { ChatGenerationChunk } from "@langchain/core/outputs";

import {
  FallbackChatModel,
  createOpenRouterFallbackModel,
  type FallbackAttempt,
  type FallbackModelOptions,
} from "../src/fallback-model";
import { createOpenRouterModel } from "../src/model";

import type { TurnModelCallOptions } from "../src/graph";
import type { BaseMessage } from "@langchain/core/messages";
import type { ChatResult } from "@langchain/core/outputs";

type Scenario = {
  text?: string;
  pieces?: string[];
  error?: Error;
  afterPieces?: boolean;
  hang?: boolean;
  provider?: string | null;
  actualModel?: string | null;
  refuseMetadata?: boolean;
  contentFilter?: boolean;
  lateRejectMs?: number;
  providers?: string[];
};

class SyntheticModel extends BaseChatModel<TurnModelCallOptions> {
  readonly model: string;
  readonly scenario: Scenario;
  readonly calls: TurnModelCallOptions[] = [];

  constructor(model: string, scenario: Scenario = {}) {
    super({ maxRetries: 0 });
    this.model = model;
    this.scenario = scenario;
  }

  _llmType(): string {
    return "synthetic";
  }

  private piece(text: string, index = 0): AIMessageChunk {
    return new AIMessageChunk({
      content: text,
      response_metadata: {
        ...(this.scenario.provider !== null
          ? {
              provider:
                this.scenario.providers?.[index] ?? this.scenario.provider ?? "SyntheticProvider",
            }
          : {}),
        ...(this.scenario.actualModel !== null
          ? { model_name: this.scenario.actualModel ?? `${this.model}/actual` }
          : {}),
        ...(this.scenario.contentFilter ? { finish_reason: "content_filter" } : {}),
      },
      additional_kwargs: this.scenario.refuseMetadata ? { refusal: "synthetic refusal" } : {},
      usage_metadata: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
    });
  }

  private async start(options: TurnModelCallOptions): Promise<void> {
    this.calls.push(options);
    if (this.scenario.lateRejectMs) {
      await new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error("synthetic-sensitive-late-error")),
          this.scenario.lateRejectMs,
        );
      });
    }
    if (this.scenario.hang) {
      await new Promise<never>((_, reject) => {
        const abort = () => reject(new Error("synthetic abort"));
        options.signal?.addEventListener("abort", abort, { once: true });
        if (options.signal?.aborted) abort();
      });
    }
    if (this.scenario.error && !this.scenario.afterPieces) throw this.scenario.error;
  }

  async _generate(_messages: BaseMessage[], options: TurnModelCallOptions): Promise<ChatResult> {
    await this.start(options);
    if (this.scenario.error) throw this.scenario.error;
    const text = this.scenario.text ?? "synthetic success";
    return { generations: [{ message: this.piece(text), text }] };
  }

  async *_streamResponseChunks(
    _messages: BaseMessage[],
    options: TurnModelCallOptions,
  ): AsyncGenerator<ChatGenerationChunk> {
    await this.start(options);
    for (const [index, text] of (
      this.scenario.pieces ?? [this.scenario.text ?? "synthetic success"]
    ).entries()) {
      yield new ChatGenerationChunk({ message: this.piece(text, index), text });
    }
    if (this.scenario.error) throw this.scenario.error;
  }
}

const messages = [new HumanMessage("synthetic user input")];

jest.mock("../src/model", () => ({ createOpenRouterModel: jest.fn() }));

const options: FallbackModelOptions = {
  attemptTimeoutMs: 100,
  maxOutputChars: 1000,
  isRefusal: (text) => text.includes("SYNTHETIC_REFUSAL"),
};
const httpError = (status: number): Error =>
  Object.assign(new Error("synthetic-sensitive-error"), { statusCode: status });

const fixture = (
  scenarios: [Scenario?, Scenario?, Scenario?] = [],
  overrides: Partial<FallbackModelOptions> = {},
) => {
  const models: [SyntheticModel, SyntheticModel, SyntheticModel] = [
    new SyntheticModel("synthetic/primary", scenarios[0]),
    new SyntheticModel("synthetic/fallback-1", scenarios[1]),
    new SyntheticModel("synthetic/fallback-2", scenarios[2]),
  ];
  const attempts: FallbackAttempt[] = [];
  const model = new FallbackChatModel(models, {
    ...options,
    onAttempt: (attempt) => {
      attempts.push(attempt);
    },
    ...overrides,
  });
  return { model, models, attempts };
};

const streamed = async (model: FallbackChatModel, callOptions: TurnModelCallOptions = {}) => {
  const pieces: AIMessageChunk[] = [];
  for await (const piece of await model.stream(messages, callOptions)) pieces.push(piece);
  return pieces;
};

test.each(["invoke", "stream"] as const)(
  "%s keeps the first successful route and audit metadata",
  async (mode) => {
    const { model, models, attempts } = fixture([], {
      now: (() => {
        let time = 0;
        return () => ++time;
      })(),
    });
    const result = mode === "invoke" ? [await model.invoke(messages)] : await streamed(model);
    expect(result.map((piece) => piece.content).join("")).toBe("synthetic success");
    expect(models.map((candidate) => candidate.calls.length)).toEqual([1, 0, 0]);
    expect(attempts).toEqual([
      {
        route: "primary",
        requestedModel: "synthetic/primary",
        model: "synthetic/primary/actual",
        provider: "SyntheticProvider",
        status: "ok",
        reason: null,
        latencyMs: 1,
        timeoutMs: 100,
      },
    ]);
    expect(result[0]?.response_metadata.fallbackAttempts).toEqual(attempts);
    expect(result.at(-1)?.usage_metadata?.total_tokens).toBe(30);
  },
);

test.each(["invoke", "stream"] as const)(
  "%s falls through only primary -> fallback-1 -> fallback-2",
  async (mode) => {
    const { model, models, attempts } = fixture([
      { error: httpError(503) },
      { error: httpError(429) },
      { text: "third route success" },
    ]);
    const result = mode === "invoke" ? [await model.invoke(messages)] : await streamed(model);
    expect(result.map((piece) => piece.content).join("")).toBe("third route success");
    expect(models.map((candidate) => candidate.calls.length)).toEqual([1, 1, 1]);
    expect(attempts.map((attempt) => [attempt.route, attempt.reason])).toEqual([
      ["primary", "server-error"],
      ["fallback-1", "rate-limit"],
      ["fallback-2", null],
    ]);
    expect(JSON.stringify(attempts)).not.toContain("synthetic-sensitive-error");
    expect(JSON.stringify(attempts)).not.toContain("third route success");
  },
);

test.each([
  { scenario: { text: "SYNTHETIC_REFUSAL" }, reason: "refusal" },
  { scenario: { refuseMetadata: true }, reason: "refusal" },
  { scenario: { contentFilter: true }, reason: "refusal" },
  { scenario: { text: " " }, reason: "empty" },
  { scenario: { error: httpError(500) }, reason: "server-error" },
  { scenario: { error: httpError(429) }, reason: "rate-limit" },
  { scenario: { error: new TypeError("fetch failed") }, reason: "connection" },
  {
    scenario: { error: Object.assign(new Error("synthetic"), { cause: { code: "ECONNRESET" } }) },
    reason: "connection",
  },
  {
    scenario: { error: Object.assign(new Error("synthetic"), { name: "TimeoutError" }) },
    reason: "timeout",
  },
  { scenario: { provider: "DeepSeek/Turbo" }, reason: "unsafe-provider" },
  { scenario: { text: "[INFRA_ERROR:synthetic]" }, reason: "connection" },
  { scenario: { text: "[API_ERROR:synthetic]" }, reason: "connection" },
  { scenario: { text: "[FETCH_ERROR:synthetic]" }, reason: "connection" },
])("$reason selects fallback-1", async ({ scenario, reason }) => {
  const { model, models, attempts } = fixture([scenario]);
  await model.invoke(messages);
  expect(models.map((candidate) => candidate.calls.length)).toEqual([1, 1, 0]);
  expect(attempts[0].reason).toBe(reason);
});

test("stream refusal spanning chunks is discarded before any text is exposed", async () => {
  const { model, attempts } = fixture([
    { pieces: ["SYNTHETIC_", "REFUSAL"] },
    { text: "accepted response" },
  ]);
  const result = await streamed(model);
  expect(result.map((piece) => piece.content).join("")).toBe("accepted response");
  expect(attempts.map((attempt) => attempt.reason)).toEqual(["refusal", null]);
});

test("a partial stream failure never commits or duplicates the failed text", async () => {
  const { model, models, attempts } = fixture([
    { pieces: ["discarded partial "], afterPieces: true, error: httpError(502) },
    { pieces: ["accepted ", "response"] },
  ]);
  const result = await streamed(model);
  expect(result.map((piece) => piece.content).join("")).toBe("accepted response");
  expect(models.map((candidate) => candidate.calls.length)).toEqual([1, 1, 0]);
  expect(attempts[0].model).toBe("synthetic/primary/actual");
  expect(attempts[0].provider).toBe("SyntheticProvider");
  expect(attempts[0].status).toBe("failed");
});

test("an early stream exit retains the complete audit in the first successful piece", async () => {
  const { model, models, attempts } = fixture([
    { error: httpError(503) },
    { pieces: ["accepted ", "response"] },
  ]);
  let first: AIMessageChunk | undefined;
  for await (const piece of await model.stream(messages)) {
    first = piece;
    break;
  }
  expect(first?.content).toBe("accepted ");
  expect(first?.response_metadata.fallbackAttempts).toEqual(attempts);
  expect(attempts.map((attempt) => attempt.reason)).toEqual(["server-error", null]);
  expect(models.map((candidate) => candidate.calls.length)).toEqual([1, 1, 0]);
});

test("concatenating a successful stream records its completed audit exactly once", async () => {
  const { model, attempts } = fixture([
    { error: httpError(503) },
    { pieces: ["accepted ", "response"] },
  ]);
  const pieces = await streamed(model);
  expect(
    pieces.filter((piece) => piece.response_metadata.fallbackAttempts !== undefined),
  ).toHaveLength(1);
  expect(pieces[0].response_metadata.fallbackAttempts).toEqual(attempts);
  const combined = pieces.reduce((left, right) => left.concat(right));
  expect(combined.response_metadata.fallbackAttempts).toEqual(attempts);
  expect(combined.response_metadata.fallbackAttempts).toHaveLength(2);
});

test("a later safe provider label cannot hide an earlier DeepSeek stream chunk", async () => {
  const { model, attempts } = fixture([
    { pieces: ["discarded ", "response"], providers: ["DeepSeek", "SyntheticProvider"] },
  ]);
  const result = await streamed(model);
  expect(result.map((piece) => piece.content).join("")).toBe("synthetic success");
  expect(attempts[0]).toMatchObject({
    provider: "DeepSeek",
    reason: "unsafe-provider",
    status: "failed",
  });
});

test.each(["invoke", "stream"] as const)("%s stops after all three routes fail", async (mode) => {
  const { model, models, attempts } = fixture([
    { error: httpError(503) },
    { error: httpError(503) },
    { error: httpError(503) },
  ]);
  const operation = mode === "invoke" ? model.invoke(messages) : streamed(model);
  await expect(operation).rejects.toMatchObject({
    code: "exhausted",
    attempts: expect.arrayContaining([
      expect.objectContaining({ route: "fallback-2", reason: "server-error" }),
    ]),
  });
  expect(models.map((candidate) => candidate.calls.length)).toEqual([1, 1, 1]);
  expect(attempts).toHaveLength(3);
});

test.each([401, 403, 400])("HTTP %i fails without retrying unrelated routes", async (status) => {
  const { model, models } = fixture([{ error: httpError(status) }]);
  await expect(model.invoke(messages)).rejects.toMatchObject({ code: "non-retryable" });
  expect(models.map((candidate) => candidate.calls.length)).toEqual([1, 0, 0]);
});

test("programming TypeErrors do not cause provider retries", async () => {
  const { model, models } = fixture([{ error: new TypeError("synthetic programming error") }]);
  await expect(model.invoke(messages)).rejects.toMatchObject({ code: "non-retryable" });
  expect(models.map((candidate) => candidate.calls.length)).toEqual([1, 0, 0]);
});

test.each(["invoke", "stream"] as const)(
  "%s uses a fresh timeout for each attempt",
  async (mode) => {
    jest.useFakeTimers();
    try {
      const { model, models, attempts } = fixture([{ hang: true }, { hang: true }]);
      const operation = mode === "invoke" ? model.invoke(messages) : streamed(model);
      await jest.advanceTimersByTimeAsync(201);
      await operation;
      expect(models.map((candidate) => candidate.calls.length)).toEqual([1, 1, 1]);
      expect(attempts.map((attempt) => attempt.reason)).toEqual(["timeout", "timeout", null]);
      expect(attempts.slice(0, 2).every((attempt) => attempt.timeoutMs === 100)).toBe(true);
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  },
);

test.each(["invoke", "stream"] as const)(
  "%s preserves external cancellation without falling back",
  async (mode) => {
    const controller = new AbortController();
    const { model, models } = fixture([{ hang: true }]);
    const operation =
      mode === "invoke"
        ? model.invoke(messages, { signal: controller.signal })
        : streamed(model, { signal: controller.signal });
    const checked = expect(operation).rejects.toMatchObject({
      name: "AbortError",
      code: "cancelled",
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    controller.abort(new Error("synthetic-sensitive-cancel-reason"));
    await checked;
    expect(models.map((candidate) => candidate.calls.length)).toEqual([1, 0, 0]);
  },
);

test("pre-aborted calls start no route", async () => {
  const controller = new AbortController();
  controller.abort();
  const { model, models } = fixture();
  await expect(model.invoke(messages, { signal: controller.signal })).rejects.toBeInstanceOf(Error);
  expect(models.map((candidate) => candidate.calls.length)).toEqual([0, 0, 0]);
});

test.each(["invoke", "stream"] as const)(
  "%s output limits fail without leaking partial text or trying another route",
  async (mode) => {
    const { model, models } = fixture([{ text: "too long", pieces: ["too ", "long"] }], {
      maxOutputChars: 3,
    });
    await expect(
      mode === "invoke" ? model.invoke(messages) : streamed(model),
    ).rejects.toMatchObject({ code: "output-limit" });
    expect(models.map((candidate) => candidate.calls.length)).toEqual([1, 0, 0]);
  },
);

test("missing provider/model metadata stays explicitly unknown", async () => {
  const { model, attempts } = fixture([{ provider: null, actualModel: null }]);
  await model.invoke(messages);
  expect(attempts[0]).toMatchObject({
    model: null,
    provider: null,
    requestedModel: "synthetic/primary",
  });
});

test("concurrent calls keep separate immutable audit histories", async () => {
  const { model } = fixture([{ error: httpError(503) }]);
  const [first, second] = await Promise.all([model.invoke(messages), model.invoke(messages)]);
  const firstAudit: unknown = first.response_metadata.fallbackAttempts;
  const secondAudit: unknown = second.response_metadata.fallbackAttempts;
  expect(firstAudit).toHaveLength(2);
  expect(secondAudit).toHaveLength(2);
  expect(firstAudit).not.toBe(secondAudit);
  expect(Object.isFrozen(firstAudit)).toBe(true);
});

test("audit callback failure stops without trying another provider", async () => {
  const { model, models } = fixture([], {
    onAttempt: () => {
      throw new Error("synthetic-sensitive-audit-error");
    },
  });
  await expect(model.invoke(messages)).rejects.toMatchObject({ code: "audit-failed" });
  expect(models.map((candidate) => candidate.calls.length)).toEqual([1, 0, 0]);
});

const deferred = () => {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

test.each(["invoke", "stream"] as const)(
  "%s waits for failed-attempt audit persistence before trying the next route",
  async (mode) => {
    const gate = deferred();
    const started = deferred();
    const trace: string[] = [];
    const { model, models } = fixture([{ error: httpError(503) }], {
      onAttempt: async (attempt) => {
        trace.push(`${attempt.route}:started`);
        started.resolve();
        await gate.promise;
        trace.push(`${attempt.route}:saved`);
      },
    });
    const operation = mode === "invoke" ? model.invoke(messages) : streamed(model);
    await started.promise;
    expect(models.map((candidate) => candidate.calls.length)).toEqual([1, 0, 0]);
    expect(trace).toEqual(["primary:started"]);
    gate.resolve();
    await operation;
    expect(trace).toEqual([
      "primary:started",
      "primary:saved",
      "fallback-1:started",
      "fallback-1:saved",
    ]);
    expect(models.map((candidate) => candidate.calls.length)).toEqual([1, 1, 0]);
  },
);

test("stream waits for successful-attempt audit persistence before exposing text", async () => {
  const gate = deferred();
  const started = deferred();
  const { model } = fixture([], {
    onAttempt: async () => {
      started.resolve();
      await gate.promise;
    },
  });
  const visible: unknown[] = [];
  const operation = (async () => {
    for await (const piece of await model.stream(messages)) visible.push(piece.content);
  })();
  await started.promise;
  expect(visible).toEqual([]);
  gate.resolve();
  await operation;
  expect(visible).toEqual(["synthetic success"]);
});

test.each([
  { mode: "invoke", scenario: {} },
  { mode: "stream", scenario: {} },
  { mode: "invoke", scenario: { error: httpError(503) } },
  { mode: "stream", scenario: { error: httpError(503) } },
] as const)("$mode stops when async audit persistence rejects", async ({ mode, scenario }) => {
  const { model, models } = fixture([scenario], {
    onAttempt: async () => {
      await Promise.resolve();
      throw new Error("synthetic-sensitive-async-audit-error");
    },
  });
  const operation = mode === "invoke" ? model.invoke(messages) : streamed(model);
  await expect(operation).rejects.toMatchObject({
    code: "audit-failed",
    message: "モデルから返事を取得できませんでした",
    attempts: [expect.objectContaining({ route: "primary" })],
  });
  expect(models.map((candidate) => candidate.calls.length)).toEqual([1, 0, 0]);
});

test("invalid numerical limits are rejected before any model call", () => {
  const models: [SyntheticModel, SyntheticModel, SyntheticModel] = [
    new SyntheticModel("a"),
    new SyntheticModel("b"),
    new SyntheticModel("c"),
  ];
  for (const invalid of [
    0,
    -1,
    0.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER,
  ]) {
    expect(
      () => new FallbackChatModel(models, { ...options, attemptTimeoutMs: invalid }),
    ).toThrow();
  }
  expect(() => new FallbackChatModel(models, { ...options, maxOutputChars: 0 })).toThrow();
  expect(models.every((model) => model.calls.length === 0)).toBe(true);
});

test.each(["invoke", "stream"] as const)(
  "%s observes a timed-out model's late rejection without restarting it",
  async (mode) => {
    jest.useFakeTimers();
    try {
      const { model, models, attempts } = fixture([{ lateRejectMs: 200 }]);
      const operation = mode === "invoke" ? model.invoke(messages) : streamed(model);
      await jest.advanceTimersByTimeAsync(101);
      await operation;
      await jest.advanceTimersByTimeAsync(100);
      expect(models.map((candidate) => candidate.calls.length)).toEqual([1, 1, 0]);
      expect(attempts.map((attempt) => attempt.reason)).toEqual(["timeout", null]);
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  },
);

test("the OpenRouter factory connects all three existing builders with their restrictive policies", () => {
  const actual = jest.requireActual<{ createOpenRouterModel: typeof createOpenRouterModel }>(
    "../src/model",
  );
  const builder = jest.mocked(createOpenRouterModel);
  builder.mockClear();
  builder.mockImplementation(actual.createOpenRouterModel);
  const env = {
    OPENROUTER_API_KEY: "synthetic-test-key",
    V2_OPENROUTER_BASE_URL: "https://gateway.example.test/v1/openrouter",
  };
  const model = createOpenRouterFallbackModel(env, options);
  expect(model).toBeInstanceOf(BaseChatModel);
  expect(builder.mock.calls.map((call) => call[1])).toEqual([
    "primary",
    "fallback-1",
    "fallback-2",
  ]);
  expect(
    builder.mock.results.map((result) => (result.type === "return" ? result.value.provider : null)),
  ).toEqual([
    { ignore: ["DeepSeek"], data_collection: "deny" },
    { ignore: ["DeepSeek"], data_collection: "deny", only: ["Venice"], allow_fallbacks: false },
    { ignore: ["DeepSeek"], data_collection: "deny" },
  ]);
  expect(
    builder.mock.results.every(
      (result) => result.type === "return" && result.value.baseURL === env.V2_OPENROUTER_BASE_URL,
    ),
  ).toBe(true);
});
