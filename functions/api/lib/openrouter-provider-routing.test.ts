import { describe, expect, it } from "vitest";

import { DEFAULT_CHAT_MODEL } from "../../../src/lib/model";

import { buildOpenRouterProviderRouting } from "./openrouter-provider-routing";

describe("buildOpenRouterProviderRouting", () => {
  it("Qwenではchat completions非対応providerを除外する", () => {
    expect(buildOpenRouterProviderRouting(DEFAULT_CHAT_MODEL)).toEqual({
      allow_fallbacks: true,
      ignore: ["novita"],
    });
  });

  it("別モデルでは通常のprovider fallbackを維持する", () => {
    expect(buildOpenRouterProviderRouting("deepseek/deepseek-chat")).toEqual({
      allow_fallbacks: true,
    });
  });

  it("very_long 向け deepseek は streamlake 優先・DeepInfra フォールバック", () => {
    expect(buildOpenRouterProviderRouting("deepseek/deepseek-chat", 1536)).toEqual({
      allow_fallbacks: true,
      order: ["streamlake", "DeepInfra"],
    });
  });

  it("very_long continuation も streamlake 優先・DeepInfra フォールバック", () => {
    expect(buildOpenRouterProviderRouting("deepseek/deepseek-chat", 768)).toEqual({
      allow_fallbacks: true,
      order: ["streamlake", "DeepInfra"],
    });
  });

  it("very_long 上限(3584)を超える deepseek は通常の provider fallback を維持する", () => {
    expect(buildOpenRouterProviderRouting("deepseek/deepseek-chat", 3585)).toEqual({
      allow_fallbacks: true,
    });
  });

  it("very_long 上限(3584)の deepseek も streamlake 優先・DeepInfra フォールバック", () => {
    expect(buildOpenRouterProviderRouting("deepseek/deepseek-chat", 3584)).toEqual({
      allow_fallbacks: true,
      order: ["streamlake", "DeepInfra"],
    });
  });
});
