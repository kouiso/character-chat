// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import { createProviderLookup, retryProviderLookup } from "./openrouter-lookup";

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

// stats の索引は生成から ~10s 遅れる（2026-11-09 実測 404→200 が 13s）。
// 即時引けん分を諦めず、決められた回数だけ引き直す。
describe("retryProviderLookup", () => {
  const noSleep = () => Promise.resolve();

  it("途中で引けたらその provider を返し、それ以上は叩かん", async () => {
    const lookup = vi
      .fn<(id: string) => Promise<string | null>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce("DeepInfra")
      .mockResolvedValueOnce("Wafer");
    const provider = await retryProviderLookup(lookup, "gen-abc", {
      attempts: 5,
      sleep: noSleep,
    });
    expect(provider).toBe("DeepInfra");
    expect(lookup).toHaveBeenCalledTimes(3);
  });

  it("全部失敗しても null で返す（呼び出し側の記録は NULL/unknown のまま）", async () => {
    const lookup = vi.fn().mockResolvedValue(null);
    const provider = await retryProviderLookup(lookup, "gen-abc", {
      attempts: 3,
      sleep: noSleep,
    });
    expect(provider).toBeNull();
    expect(lookup).toHaveBeenCalledTimes(3);
  });

  it("lookup 自体の throw も失敗として数えて粘る", async () => {
    const lookup = vi
      .fn<(id: string) => Promise<string | null>>()
      .mockRejectedValueOnce(new Error("net"))
      .mockResolvedValueOnce("Decart");
    expect(await retryProviderLookup(lookup, "gen-abc", { attempts: 3, sleep: noSleep })).toBe(
      "Decart",
    );
  });

  it("attempts の間は sleep を挟む", async () => {
    const lookup = vi.fn().mockResolvedValue(null);
    const sleeps: number[] = [];
    await retryProviderLookup(lookup, "gen-abc", {
      attempts: 3,
      delayMs: 2500,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    expect(sleeps).toEqual([2500, 2500]);
  });
});
