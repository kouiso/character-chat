import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";

import { createOpenRouterFallbackModel } from "../src/fallback-model";
import { createOpenRouterModel } from "../src/model";
import { OpenRouterTransportError } from "../src/openrouter-transport";

import type { FallbackAttempt } from "../src/fallback-model";
import type { AIMessageChunk } from "@langchain/core/messages";

const env = {
  OPENROUTER_API_KEY: "synthetic-local-key",
  V2_MODEL: "synthetic/primary",
  V2_OPENROUTER_BASE_URL: "https://synthetic.invalid/v1",
};
const options = { attemptTimeoutMs: 1000, maxOutputChars: 1000, isRefusal: () => false };
const input = [new HumanMessage("synthetic input")];
const delta = (content: string) => ({
  id: "synthetic-id",
  model: "synthetic/actual",
  provider: "SyntheticProvider",
  choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }],
});
const finish = { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] };
const usage = { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 };
const sse = (...data: (Record<string, unknown> | string)[]) =>
  data
    .map((value) => `data: ${typeof value === "string" ? value : JSON.stringify(value)}\n\n`)
    .join("");
const success = () =>
  new Response(sse(delta("accepted response"), finish, { choices: [], usage }, "[DONE]"));

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const stubFetch = (responses: (() => Response | Promise<Response>)[]) => {
  const calls: {
    url: string;
    body: Record<string, unknown>;
    headers: Headers;
    signal: AbortSignal | null;
  }[] = [];
  globalThis.fetch = jest.fn(async (url, init) => {
    calls.push({
      url: String(url),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      headers: new Headers(init?.headers),
      signal: init?.signal ?? null,
    });
    const next = responses[calls.length - 1];
    if (!next) throw new Error("unexpected synthetic request");
    return next();
  });
  return calls;
};

const streamed = async (signal?: AbortSignal) => {
  const attempts: FallbackAttempt[] = [];
  const model = createOpenRouterFallbackModel(env, {
    ...options,
    onAttempt: (attempt) => {
      attempts.push(attempt);
    },
  });
  const pieces: AIMessageChunk[] = [];
  for await (const piece of await model.stream(input, { signal })) pieces.push(piece);
  return { text: pieces.map((piece) => piece.content).join(""), pieces, attempts };
};

test.each([
  {
    name: "named SSE error",
    body:
      sse(delta("discarded partial")) +
      'event: error\ndata: {"message":"synthetic-sensitive-error"}\n\n',
    reason: "server-error",
  },
  {
    name: "in-band HTTP 500",
    body: sse(
      delta("discarded partial"),
      { error: { code: 500, message: "synthetic-sensitive-error" } },
      "[DONE]",
    ),
    reason: "server-error",
  },
  {
    name: "in-band HTTP 429",
    body: sse(
      delta("discarded partial"),
      { error: { code: "429", message: "synthetic-sensitive-error" } },
      "[DONE]",
    ),
    reason: "rate-limit",
  },
  {
    name: "malformed JSON",
    body: sse(delta("discarded partial"), "{", finish, "[DONE]"),
    reason: "protocol",
  },
  { name: "EOF before finish", body: sse(delta("discarded partial")), reason: "protocol" },
  { name: "EOF before DONE", body: sse(delta("discarded partial"), finish), reason: "protocol" },
  {
    name: "DONE before finish",
    body: sse(delta("discarded partial"), "[DONE]"),
    reason: "protocol",
  },
  {
    name: "unfinished SSE record",
    body: sse(delta("discarded partial")) + 'data: {"choices":',
    reason: "protocol",
  },
  {
    name: "error finish",
    body: sse(
      delta("discarded partial"),
      { choices: [{ delta: {}, finish_reason: "error" }] },
      "[DONE]",
    ),
    reason: "protocol",
  },
  {
    name: "text after finish",
    body: sse(delta("discarded partial"), finish, delta("late output"), "[DONE]"),
    reason: "protocol",
  },
])("$name discards primary text and selects fallback-1", async ({ body, reason }) => {
  const calls = stubFetch([() => new Response(body), success]);
  const result = await streamed();
  expect(result.text).toBe("accepted response");
  expect(calls.map((call) => call.body.model)).toEqual([
    env.V2_MODEL,
    "deepseek/deepseek-v4.1-flash",
  ]);
  expect(result.attempts.map((attempt) => attempt.reason)).toEqual([reason, null]);
  expect(JSON.stringify(result.attempts)).not.toContain("synthetic-sensitive-error");
  expect(result.attempts.at(-1)).toMatchObject({
    model: "synthetic/actual",
    provider: "SyntheticProvider",
  });
  expect(result.pieces.at(-1)?.usage_metadata?.total_tokens).toBe(30);
});

test("request parameters and SDK attribution headers remain intact", async () => {
  const calls = stubFetch([success]);
  const model = createOpenRouterModel(env);
  const controller = new AbortController();
  const messages = [
    new SystemMessage("synthetic system"),
    new HumanMessage("synthetic question"),
    new AIMessage("synthetic history"),
  ];
  for await (const _piece of await model.stream(messages, {
    temperature: 0.4,
    maxTokens: 80,
    topK: 5,
    stop: ["synthetic-stop"],
    signal: controller.signal,
  })) {
    expect(_piece).toBeDefined();
  }
  expect(calls[0].url).toBe("https://synthetic.invalid/v1/chat/completions");
  expect(calls[0].headers.get("Authorization")).toBe("Bearer synthetic-local-key");
  expect(calls[0].headers.get("HTTP-Referer")).toBe("https://docs.langchain.com");
  expect(calls[0].headers.get("X-Title")).toBe("LangChain");
  expect(calls[0].body).toMatchObject({
    model: env.V2_MODEL,
    provider: { ignore: ["DeepSeek"], data_collection: "deny" },
    max_tokens: 80,
    temperature: 0.4,
    top_k: 5,
    stop: ["synthetic-stop"],
    stream: true,
    messages: [
      { role: "system", content: "synthetic system" },
      { role: "user", content: "synthetic question" },
      { role: "assistant", content: "synthetic history" },
    ],
  });
  expect(calls[0].signal).toBe(controller.signal);
});

test("reasoning model text retains the developer role and reasoning request settings", async () => {
  const calls = stubFetch([success]);
  const model = createOpenRouterModel({
    OPENROUTER_API_KEY: env.OPENROUTER_API_KEY,
    V2_MODEL: "openai/gpt-5-mini",
  });
  for await (const piece of await model.stream([new SystemMessage("synthetic system")]))
    expect(piece).toBeDefined();
  expect(calls[0].body).toMatchObject({
    reasoning: { effort: "minimal" },
    messages: [{ role: "developer", content: "synthetic system" }],
  });
  expect(calls[0].url).toBe("https://openrouter.ai/api/v1/chat/completions");
});

test("CRLF, comments, multiline data, and split UTF-8 retain actual identities", async () => {
  const first = JSON.stringify(delta("合成😀"));
  const data = `: synthetic comment\r\ndata: ${first.slice(0, 1)}\r\ndata: ${first.slice(1)}\r\n\r\n${sse(finish, "[DONE]").replace(/\n/g, "\r")}`;
  const bytes = new TextEncoder().encode(data);
  stubFetch([
    () =>
      new Response(
        new ReadableStream({
          start(controller) {
            for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
            controller.close();
          },
        }),
      ),
  ]);
  const result = await streamed();
  expect(result.text).toBe("合成😀");
  expect(result.attempts[0]).toMatchObject({
    model: "synthetic/actual",
    provider: "SyntheticProvider",
    status: "ok",
  });
});

test("missing identities stay unknown instead of using the requested route", async () => {
  stubFetch([
    () =>
      new Response(
        sse(
          { choices: [{ delta: { content: "synthetic text" }, finish_reason: "stop" }] },
          "[DONE]",
        ),
      ),
  ]);
  const result = await streamed();
  expect(result.attempts[0]).toMatchObject({
    model: null,
    provider: null,
    requestedModel: env.V2_MODEL,
  });
});

test.each(["DeepSeek/Turbo", "DeepSeek (Turbo)"])(
  "transport provider %s is rejected before partial text is released",
  async (provider) => {
    stubFetch([
      () => new Response(sse({ ...delta("discarded"), provider }, finish, "[DONE]")),
      success,
    ]);
    const result = await streamed();
    expect(result.text).toBe("accepted response");
    expect(result.attempts[0]).toMatchObject({
      reason: "unsafe-provider",
      provider,
    });
  },
);

test.each([400, 401, 403, 429, 500, 503])(
  "HTTP %i preserves classification and redacts the body",
  async (status) => {
    const calls = stubFetch([() => new Response("synthetic-sensitive-body", { status })]);
    const model = createOpenRouterModel(env);
    await expect(model.invoke(input)).rejects.toMatchObject({
      statusCode: status,
      message: "モデルの応答を取得できませんでした",
    });
    expect(calls).toHaveLength(1);
  },
);

test("nonstream JSON retains actual identity, refusal, and usage", async () => {
  const calls = stubFetch([
    () =>
      Response.json({
        model: "synthetic/actual",
        provider: "SyntheticProvider",
        choices: [
          {
            message: { content: "synthetic response", refusal: "synthetic refusal" },
            finish_reason: "content_filter",
          },
        ],
        usage,
      }),
  ]);
  const message = await createOpenRouterModel(env).invoke(input);
  expect(message.content).toBe("synthetic response");
  expect(message.response_metadata).toMatchObject({
    model: "synthetic/actual",
    provider: "SyntheticProvider",
    finish_reason: "content_filter",
  });
  expect(message.additional_kwargs.refusal).toBe("synthetic refusal");
  expect(message.usage_metadata?.total_tokens).toBe(30);
  expect(calls[0].body.stream).toBe(false);
});

test("null refusal output remains a refusal instead of a protocol success", async () => {
  stubFetch([
    () =>
      Response.json({
        choices: [
          {
            message: { content: null, refusal: "synthetic refusal" },
            finish_reason: "content_filter",
          },
        ],
      }),
    () =>
      Response.json({
        choices: [{ message: { content: "accepted response" }, finish_reason: "stop" }],
      }),
  ]);
  const attempts: FallbackAttempt[] = [];
  const message = await createOpenRouterFallbackModel(env, {
    ...options,
    onAttempt: (attempt) => {
      attempts.push(attempt);
    },
  }).invoke(input);
  expect(message.content).toBe("accepted response");
  expect(attempts[0].reason).toBe("refusal");
});

test("a transport attempt timeout aborts fetch and uses the next route", async () => {
  let count = 0;
  let aborted = false;
  globalThis.fetch = jest.fn(async (_url, init) => {
    count++;
    if (count > 1) return success();
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener(
        "abort",
        () => {
          aborted = true;
          reject(new Error("synthetic-sensitive-timeout"));
        },
        { once: true },
      );
    });
  });
  const attempts: FallbackAttempt[] = [];
  const model = createOpenRouterFallbackModel(env, {
    ...options,
    attemptTimeoutMs: 30,
    onAttempt: (attempt) => {
      attempts.push(attempt);
    },
  });
  let text = "";
  for await (const piece of await model.stream(input)) text += piece.content;
  expect(text).toBe("accepted response");
  expect(aborted).toBe(true);
  expect(count).toBe(2);
  expect(attempts.map((attempt) => attempt.reason)).toEqual(["timeout", null]);
});

test.each([
  "{",
  JSON.stringify({ error: { code: 503, message: "synthetic-sensitive-body" } }),
  JSON.stringify({ choices: [{ message: { content: "partial" }, finish_reason: null }] }),
])("nonstream invalid/error responses have safe errors", async (body) => {
  stubFetch([() => new Response(body)]);
  await expect(createOpenRouterModel(env).invoke(input)).rejects.toBeInstanceOf(
    OpenRouterTransportError,
  );
});

test("unsupported input blocks and tool messages fail before a request", async () => {
  const calls = stubFetch([]);
  const model = createOpenRouterModel(env);
  for (const message of [
    new ToolMessage({ content: "synthetic", tool_call_id: "synthetic-id" }),
    new HumanMessage({
      content: [{ type: "image_url", image_url: "https://synthetic.invalid/image" }],
    }),
    new AIMessage({
      content: "synthetic",
      tool_calls: [{ id: "synthetic-id", name: "synthetic", args: {} }],
    }),
  ]) {
    await expect(model.invoke([message])).rejects.toMatchObject({ statusCode: 400 });
  }
  await expect(
    model.invoke(input, { tools: [{ type: "function", function: { name: "synthetic" } }] }),
  ).rejects.toMatchObject({ statusCode: 400 });
  expect(calls).toHaveLength(0);
});

test("transport network errors are redacted and classified for fallback", async () => {
  stubFetch([
    () => {
      throw new TypeError("synthetic-sensitive-network-body");
    },
    success,
  ]);
  const result = await streamed();
  expect(result.text).toBe("accepted response");
  expect(result.attempts[0].reason).toBe("connection");
});

test("cancellation aborts a real transport request without another route", async () => {
  const controller = new AbortController();
  let started: (() => void) | undefined;
  const running = new Promise<void>((resolve) => {
    started = resolve;
  });
  const calls: AbortSignal[] = [];
  globalThis.fetch = jest.fn(
    async (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) throw new Error("synthetic missing signal");
        calls.push(signal);
        signal.addEventListener("abort", () => reject(new Error("synthetic-sensitive-abort")), {
          once: true,
        });
        started?.();
      }),
  );
  const result = streamed(controller.signal);
  const checked = expect(result).rejects.toMatchObject({
    name: "AbortError",
    code: "cancelled",
    message: "生成を中止しました",
  });
  await running;
  controller.abort();
  await checked;
  expect(calls).toHaveLength(1);
  expect(calls[0].aborted).toBe(true);
});

test("an oversized SSE event is rejected before partial text is accepted", async () => {
  stubFetch([() => new Response(`data: ${"x".repeat(131_073)}\n\n`), success]);
  const result = await streamed();
  expect(result.text).toBe("accepted response");
  expect(result.attempts[0].reason).toBe("protocol");
});
