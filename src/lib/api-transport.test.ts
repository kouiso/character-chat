/**
 * Unit tests for api.ts transport helpers:
 *   - trimMessagesForTransport
 *   - apiFetch (CF-Access silent-fail guard integration)
 *   - generateImage
 *
 * Added in #185 test-infra initiative.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ApiResponseError,
  apiFetch,
  generateImage,
  getCharacterListErrorMessage,
  getImageTaskResult,
  listCharacters,
  persistImageToR2,
  shouldRetryCharacterList,
  trimMessagesForTransport,
} from "./api";

// ─── helpers ─────────────────────────────────────────────────────────────────

type Msg = { role: "system" | "user" | "assistant"; content: string };

const makeMsg = (role: Msg["role"], chars: number): Msg => ({
  role,
  content: "x".repeat(chars),
});

/** 180_000 chars is the CHAT_TRANSPORT_MAX_CHARS constant from api.ts. */
const MAX = 180_000;

// ─── trimMessagesForTransport ────────────────────────────────────────────────

describe("trimMessagesForTransport", () => {
  it("returns empty array unchanged", () => {
    expect(trimMessagesForTransport([])).toEqual([]);
  });

  it("returns messages unchanged when total chars is within budget", () => {
    const messages: Msg[] = [
      makeMsg("system", 1000),
      makeMsg("user", 500),
      makeMsg("assistant", 500),
      makeMsg("user", 200),
    ];
    const result = trimMessagesForTransport(messages);
    expect(result).toEqual(messages);
  });

  it("trims old history when total exceeds budget, always keeping the latest user message", () => {
    // system (1000) + many old turns (each 10k) + latest user (500) = way over budget
    const messages: Msg[] = [
      makeMsg("system", 1_000),
      ...Array.from({ length: 20 }, (_, i) => makeMsg(i % 2 === 0 ? "user" : "assistant", 10_000)),
      makeMsg("user", 500),
    ];
    const result = trimMessagesForTransport(messages);
    // Total chars must be ≤ MAX
    const totalChars = result.reduce((sum, m) => sum + m.content.length, 0);
    expect(totalChars).toBeLessThanOrEqual(MAX);
    // System message is always the first
    expect(result[0]?.role).toBe("system");
    // Latest user message is always preserved
    const lastMsg = result[result.length - 1];
    expect(lastMsg?.role).toBe("user");
    expect(lastMsg?.content.length).toBe(500);
  });

  it("preserves oldest turns when they fit within the budget", () => {
    // system 1000 + 5 turns * 1000 chars = 6000 (well within 180k)
    const messages: Msg[] = [
      makeMsg("system", 1_000),
      makeMsg("user", 1_000),
      makeMsg("assistant", 1_000),
      makeMsg("user", 1_000),
      makeMsg("assistant", 1_000),
      makeMsg("user", 500),
    ];
    const result = trimMessagesForTransport(messages);
    // All messages should survive
    expect(result).toHaveLength(messages.length);
  });

  it("keeps system + latest user only when history alone exceeds budget", () => {
    // Make history so large that even without system it doesn't fit
    const messages: Msg[] = [
      makeMsg("system", 1_000),
      ...Array.from({ length: 10 }, () => makeMsg("user", 20_000)),
      makeMsg("user", 400), // latest user — must always be kept
    ];
    const result = trimMessagesForTransport(messages);
    const totalChars = result.reduce((sum, m) => sum + m.content.length, 0);
    expect(totalChars).toBeLessThanOrEqual(MAX);
    // Last element is the 400-char latest user
    expect(result[result.length - 1]?.content.length).toBe(400);
  });

  it("messages without a system prompt are handled correctly", () => {
    const messages: Msg[] = [makeMsg("user", 500), makeMsg("assistant", 500), makeMsg("user", 200)];
    const result = trimMessagesForTransport(messages);
    expect(result).toEqual(messages);
    expect(result[0]?.role).toBe("user");
  });
});

// ─── apiFetch ────────────────────────────────────────────────────────────────

describe("apiFetch", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes through a successful JSON response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response('{"ok":true}', { headers: { "content-type": "application/json" } }),
    );
    const res = await apiFetch("/api/me");
    expect(res.ok).toBe(true);
    // res.json() returns `unknown` in Node's fetch type; cast to concrete shape for assertion
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawBody = (await res.json()) as any;
    expect((rawBody as { ok: boolean }).ok).toBe(true);
  });

  it("sets Authorization header from localStorage auth_token", async () => {
    localStorage.setItem("auth_token", "my-token");
    let capturedHeaders: Headers | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      capturedHeaders = new Headers(init?.headers);
      return new Response('{"ok":true}', { headers: { "content-type": "application/json" } });
    });
    await apiFetch("/api/me");
    expect(capturedHeaders?.get("Authorization")).toBe("Bearer my-token");
  });

  it("does not overwrite an existing Authorization header", async () => {
    localStorage.setItem("auth_token", "stored-token");
    let capturedHeaders: Headers | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      capturedHeaders = new Headers(init?.headers);
      return new Response('{"ok":true}', { headers: { "content-type": "application/json" } });
    });
    await apiFetch("/api/me", { headers: { Authorization: "Bearer override-token" } });
    expect(capturedHeaders?.get("Authorization")).toBe("Bearer override-token");
  });

  it("aborts the request when timeoutMs elapses", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async (_input, init) =>
        new Promise((_resolve, reject) => {
          const onAbort = () =>
            reject(new DOMException("The operation was aborted.", "AbortError"));
          if (init?.signal?.aborted) return onAbort();
          init?.signal?.addEventListener("abort", onAbort);
        }),
    );
    await expect(apiFetch("/api/me", { timeoutMs: 1 })).rejects.toThrow("aborted");
  });
});

// ─── listCharacters edge handling ───────────────────────────────────────────

describe("listCharacters edge handling", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns an empty D1 result without treating it as a fetch failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ characters: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(listCharacters()).resolves.toEqual([]);
  });

  it("maps network failure to a non-generic offline message", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(listCharacters()).rejects.toMatchObject({ status: 0 });
    expect(getCharacterListErrorMessage(new ApiResponseError("network", 0))).toContain(
      "ネットワーク",
    );
  });

  it("maps timeout failure to a non-generic retry message", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new DOMException("timeout", "TimeoutError"));

    await expect(listCharacters()).rejects.toMatchObject({ status: 408 });
    expect(getCharacterListErrorMessage(new ApiResponseError("timeout", 408))).toContain(
      "タイムアウト",
    );
  });

  it("maps 5xx failure to a server-specific message", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("bad gateway", { status: 502 }));

    await expect(listCharacters()).rejects.toMatchObject({ status: 502 });
    expect(getCharacterListErrorMessage(new ApiResponseError("server", 502))).toContain(
      "サーバー側",
    );
  });

  it("does not retry terminal auth/offline/timeout character-list failures", () => {
    expect(shouldRetryCharacterList(0, new ApiResponseError("offline", 0))).toBe(false);
    expect(shouldRetryCharacterList(0, new ApiResponseError("auth", 401))).toBe(false);
    expect(shouldRetryCharacterList(0, new ApiResponseError("timeout", 408))).toBe(false);
    expect(shouldRetryCharacterList(2, new ApiResponseError("server", 502))).toBe(true);
    expect(shouldRetryCharacterList(3, new ApiResponseError("server", 502))).toBe(false);
  });
});

// ─── generateImage ───────────────────────────────────────────────────────────

describe("generateImage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns task_id on successful 200 response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ task_id: "task-abc-123" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const result = await generateImage("a scene prompt", "brown hair, blue eyes");
    expect(result).toEqual({ task_id: "task-abc-123" });
  });

  it("returns error string on non-200 response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Service Unavailable", { status: 503 }),
    );
    const result = await generateImage("prompt");
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toBe("Service Unavailable");
    }
  });

  it("returns error string when fetch throws", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network failure"));
    const result = await generateImage("prompt");
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("network failure");
    }
  });

  it("sends characterId in request body when provided", async () => {
    let capturedBody: Record<string, unknown> | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ task_id: "t1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    await generateImage("prompt", "desc", "conversation", "char-001");
    expect(capturedBody?.characterId).toBe("char-001");
  });

  it("sends phase in request body", async () => {
    let capturedBody: Record<string, unknown> | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ task_id: "t2" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    await generateImage("prompt", undefined, "erotic");
    expect(capturedBody?.phase).toBe("erotic");
  });

  it("parses optional prompt field from response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          task_id: "t3",
          prompt: "masterpiece, best quality",
          model: "waiNSFWIllustrious_v90_1187991.safetensors",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    const result = await generateImage("scene");
    expect(result).toEqual({
      task_id: "t3",
      prompt: "masterpiece, best quality",
      model: "waiNSFWIllustrious_v90_1187991.safetensors",
    });
  });

  it("passes timeoutMs to fetch via AbortSignal", async () => {
    let capturedSignal: AbortSignal | null | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      capturedSignal = init?.signal;
      return new Response(JSON.stringify({ task_id: "t1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    await generateImage("prompt");
    expect(capturedSignal).toBeInstanceOf(AbortSignal);
  });
});

// ─── getImageTaskResult / persistImageToR2 timeouts & error handling ─────────────

describe("image task and persist helpers", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("getImageTaskResult passes timeoutMs to fetch", async () => {
    let capturedSignal: AbortSignal | null | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      capturedSignal = init?.signal;
      return new Response(
        JSON.stringify({
          task: { task_id: "task-1", status: "TASK_STATUS_SUCCEED", progress_percent: 100 },
          images: [{ image_url: "https://example.com/img.png" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    await getImageTaskResult("task-1");
    expect(capturedSignal).toBeInstanceOf(AbortSignal);
  });

  it("persistImageToR2 returns error on non-2xx response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("bad gateway", { status: 502 }));
    const result = await persistImageToR2("https://example.com/img.png", "msg-1");
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("502");
    }
  });

  it("persistImageToR2 returns error when fetch throws", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    const result = await persistImageToR2("https://example.com/img.png", "msg-1");
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("Failed to fetch");
    }
  });
});
