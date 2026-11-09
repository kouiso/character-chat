// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import { createProviderLookup } from "./openrouter-lookup";

const generationStats = (body: unknown, ok = true) =>
  new Response(JSON.stringify(body), {
    status: ok ? 200 : 500,
    headers: { "content-type": "application/json" },
  });

describe("createProviderLookup", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("生成 id から provider_name を引く", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(generationStats({ data: { provider_name: "novita" } }));
    vi.stubGlobal("fetch", fetchMock);
    const lookup = createProviderLookup({ OPENROUTER_API_KEY: "key" });
    expect(await lookup("gen-abc")).toBe("novita");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/generation?id=gen-abc",
      expect.objectContaining({ headers: { Authorization: "Bearer key" } }),
    );
  });

  it("AI Gateway の baseURL を使う", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(generationStats({ data: { provider_display_name: "AtlasCloud" } }));
    vi.stubGlobal("fetch", fetchMock);
    const lookup = createProviderLookup({
      OPENROUTER_API_KEY: "key",
      V2_OPENROUTER_BASE_URL: "https://gateway.ai.cloudflare.com/v1/a/g/openrouter",
    });
    expect(await lookup("gen-abc")).toBe("AtlasCloud");
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://gateway.ai.cloudflare.com/v1/a/g/openrouter/generation?id=gen-abc",
    );
  });

  it("失敗・鍵無し・id 空は null（ターンを潰さん）", async () => {
    const fetchMock = vi.fn().mockResolvedValue(generationStats({}, false));
    vi.stubGlobal("fetch", fetchMock);
    const lookup = createProviderLookup({ OPENROUTER_API_KEY: "key" });
    expect(await lookup("gen-abc")).toBeNull();
    expect(await createProviderLookup({})("gen-abc")).toBeNull();
    expect(await lookup("")).toBeNull();
  });
});
