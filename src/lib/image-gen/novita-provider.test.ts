import { describe, expect, it, vi } from "vitest";

import { NovitaImageGenProvider } from "./novita-provider";

const REQUEST = {
  prompt: "test prompt",
  negativePrompt: "negative",
  width: 768,
  height: 1024,
  model: "dreamshaper-8",
  steps: 20,
  guidanceScale: 7,
};

describe("NovitaImageGenProvider", () => {
  it("throws 503 when novitaApiKey is absent (regression: #260 image-gen 500 on missing key)", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const provider = new NovitaImageGenProvider({ fetchImpl });

    await expect(provider.generate(REQUEST)).rejects.toMatchObject({
      name: "ImageGenProviderError",
      status: 503,
      fallbackEligible: true,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("throws 502 when API returns unexpected JSON shape (regression: #311 ZodError -> unhandled 500)", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ unexpected: "shape" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    const provider = new NovitaImageGenProvider({ novitaApiKey: "test-key", fetchImpl });

    await expect(provider.generate(REQUEST)).rejects.toMatchObject({
      name: "ImageGenProviderError",
      status: 502,
      retryable: false,
      fallbackEligible: false,
    });
  });

  it("sends browser User-Agent header on every request (regression: #373 CF 1010 bot block with no-UA)", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ task_id: "abc123" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    const provider = new NovitaImageGenProvider({ novitaApiKey: "test-key", fetchImpl });

    await provider.generate(REQUEST);

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["User-Agent"]).toMatch(/Mozilla\/5\.0/);
  });

  it("wraps fetch in an arrow function to prevent workerd Illegal invocation (#376)", async () => {
    // The constructor must accept fetchImpl and use it, not store globalThis.fetch as-is.
    const custom = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ task_id: "xyz" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    const provider = new NovitaImageGenProvider({ novitaApiKey: "test-key", fetchImpl: custom });

    await provider.generate(REQUEST);

    expect(custom).toHaveBeenCalledOnce();
  });

  it("returns a task_id on successful generate (happy path)", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ task_id: "novita-task-001" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    const provider = new NovitaImageGenProvider({ novitaApiKey: "test-key", fetchImpl });

    const result = await provider.generate(REQUEST);

    expect(result).toMatchObject({
      taskId: "novita-task-001",
      provider: "novita",
    });
  });

  it("hits the txt2img endpoint with an unchanged body when no reference image is given (#355)", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ task_id: "txt2img-001" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    const provider = new NovitaImageGenProvider({ novitaApiKey: "test-key", fetchImpl });

    await provider.generate(REQUEST);

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.novita.ai/v3/async/txt2img");
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      extra: { response_image_type: "jpeg" },
      request: {
        model_name: "dreamshaper-8",
        prompt: "test prompt",
        negative_prompt: "negative",
        width: 768,
        height: 1024,
        sampler_name: "DPM++ 2M Karras",
        steps: 20,
        guidance_scale: 7,
        image_num: 1,
        seed: -1,
      },
    });
    // txt2img では img2img 専用キーが混入してはならない
    expect(body.request.image_base64).toBeUndefined();
    expect(body.request.strength).toBeUndefined();
  });

  it("hits the img2img endpoint with the route.ts likeness body when a reference image is given (#355)", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ task_id: "img2img-001" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    const provider = new NovitaImageGenProvider({ novitaApiKey: "test-key", fetchImpl });

    await provider.generate({ ...REQUEST, imageBase64: "BASE64DATA" });

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.novita.ai/v3/async/img2img");
    const body = JSON.parse(init.body as string);
    // route.ts の img2img body と同形 (image_base64 + strength 0.45)
    expect(body).toEqual({
      extra: { response_image_type: "jpeg" },
      request: {
        model_name: "dreamshaper-8",
        prompt: "test prompt",
        negative_prompt: "negative",
        width: 768,
        height: 1024,
        sampler_name: "DPM++ 2M Karras",
        steps: 20,
        guidance_scale: 7,
        image_num: 1,
        seed: -1,
        image_base64: "BASE64DATA",
        strength: 0.45,
      },
    });
  });

  // Novita img2img は negative_prompt を 1024 runes に制限する。超過すると 400 VALIDATOR → 502。
  // climax phase の長大な negative_prompt がこれを超えて本番で落ちていた (2026-06-24 本番再現)。
  it("clamps an over-1024-rune negative_prompt to <=1024 on a whole-tag boundary", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ task_id: "clamp-001" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    const provider = new NovitaImageGenProvider({ novitaApiKey: "test-key", fetchImpl });
    // 200 タグ ("tagNN, ") を連結すると 1024 runes を大きく超える
    const longNegative = Array.from({ length: 200 }, (_, i) => `tag${i}`).join(", ");
    expect(longNegative.length).toBeGreaterThan(1024);

    await provider.generate({ ...REQUEST, negativePrompt: longNegative });

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const sent = JSON.parse(init.body as string).request.negative_prompt as string;
    expect(Array.from(sent).length).toBeLessThanOrEqual(1024);
    // カンマ境界で切れているので末尾に途中タグ("tag1" の断片など)が残らない
    expect(sent.endsWith(",")).toBe(false);
    expect(longNegative.startsWith(sent)).toBe(true);
  });

  it("leaves a short negative_prompt untouched (no-op for non-climax phases)", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ task_id: "clamp-noop" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    const provider = new NovitaImageGenProvider({ novitaApiKey: "test-key", fetchImpl });

    await provider.generate({ ...REQUEST, negativePrompt: "short, negative, list" });

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string).request.negative_prompt).toBe("short, negative, list");
  });

  it("honors a caller-provided strength override on img2img (#355)", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ task_id: "img2img-002" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    const provider = new NovitaImageGenProvider({ novitaApiKey: "test-key", fetchImpl });

    await provider.generate({ ...REQUEST, imageBase64: "BASE64DATA", strength: 0.4 });

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.request.strength).toBe(0.4);
  });

  // rate-limit 429 は指数的バックオフで 3 回まで再試行する。最後まで 429 なら fallback 対象にする。
  it(
    "retries a 429 init error with exponential backoff and marks it fallback-eligible",
    { timeout: 20_000 },
    async () => {
      const fetchImpl = vi.fn<typeof fetch>(
        async () => new Response("rate limited", { status: 429 }),
      );
      const provider = new NovitaImageGenProvider({ novitaApiKey: "test-key", fetchImpl });

      await expect(provider.generate(REQUEST)).rejects.toMatchObject({
        name: "ImageGenProviderError",
        message: "novita upstream service error",
        status: 429,
        fallbackEligible: true,
      });
      expect(fetchImpl).toHaveBeenCalledTimes(3);
    },
  );

  it("recovers from a 429 init error when the upstream succeeds on retry", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      if (fetchImpl.mock.calls.length === 1) {
        return new Response("rate limited", { status: 429 });
      }
      return new Response(JSON.stringify({ task_id: "novita-recovered-001" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const provider = new NovitaImageGenProvider({ novitaApiKey: "test-key", fetchImpl });

    const result = await provider.generate(REQUEST);

    expect(result).toMatchObject({ taskId: "novita-recovered-001", provider: "novita" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  // クライアント起因の 4xx (401/404/403 権限) は fallback しても無駄なので非対象のまま
  it.each([401, 403, 404])("keeps a %i init error non-fallback-eligible", async (status) => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response("client error", { status }));
    const provider = new NovitaImageGenProvider({ novitaApiKey: "test-key", fetchImpl });

    await expect(provider.generate(REQUEST)).rejects.toMatchObject({
      name: "ImageGenProviderError",
      message: "novita upstream service error",
      status,
      fallbackEligible: false,
    });
  });

  // Novita 残高切れ（403 NOT_ENOUGH_BALANCE / INSUFFICIENT_BALANCE）だけは Runware fallback の対象にする。
  it.each([
    { label: "NOT_ENOUGH_BALANCE", detail: "NOT_ENOUGH_BALANCE" },
    { label: "INSUFFICIENT_BALANCE", detail: "INSUFFICIENT_BALANCE" },
  ])("marks a 403 $label error as fallback-eligible", async ({ detail }) => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(detail, { status: 403 }));
    const provider = new NovitaImageGenProvider({ novitaApiKey: "test-key", fetchImpl });

    await expect(provider.generate(REQUEST)).rejects.toMatchObject({
      name: "ImageGenProviderError",
      message: "novita upstream service error",
      status: 403,
      fallbackEligible: true,
      detail,
    });
  });

  // prod 失敗の一次証拠を残すため、上流の非 OK 応答では provider 名と応答本文(detail)を error に載せる
  it("captures provider name and upstream response body on a non-OK init error (observability)", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ code: "content_moderation", reason: "nsfw blocked" }), {
          status: 400,
        }),
    );
    const provider = new NovitaImageGenProvider({ novitaApiKey: "test-key", fetchImpl });

    await expect(provider.generate(REQUEST)).rejects.toMatchObject({
      name: "ImageGenProviderError",
      status: 400,
      provider: "novita",
      detail: '{"code":"content_moderation","reason":"nsfw blocked"}',
    });
  });

  // 巨大な上流本文はそのまま載せず先頭 600 字に丸める (ログ/D1 肥大化防止)
  it("truncates an oversized upstream body to 600 chars + ellipsis", async () => {
    const longBody = "x".repeat(2000);
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(longBody, { status: 400 }));
    const provider = new NovitaImageGenProvider({ novitaApiKey: "test-key", fetchImpl });

    await expect(provider.generate(REQUEST)).rejects.toMatchObject({
      name: "ImageGenProviderError",
      detail: `${"x".repeat(600)}…`,
    });
  });
});
