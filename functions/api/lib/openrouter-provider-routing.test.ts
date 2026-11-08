import { describe, expect, it } from "vitest";

import { EROTIC_CHAT_MODEL, LLM_ROUTER_MODEL, QWEN_CHAT_MODEL } from "../../../src/lib/model";

import { buildOpenRouterProviderRouting } from "./openrouter-provider-routing";

describe("buildOpenRouterProviderRouting", () => {
  it("Qwenではchat completions非対応providerに加えて本家DeepSeekも除外する", () => {
    expect(buildOpenRouterProviderRouting(QWEN_CHAT_MODEL)).toEqual({
      allow_fallbacks: true,
      ignore: ["novita", "deepseek"],
    });
  });

  it("別モデルでも本家DeepSeekは除外する", () => {
    expect(buildOpenRouterProviderRouting("deepseek/deepseek-chat")).toEqual({
      allow_fallbacks: true,
      ignore: ["deepseek"],
    });
  });

  it("very_long 向け deepseek は streamlake 優先・DeepInfra フォールバック・本家DeepSeek除外", () => {
    expect(buildOpenRouterProviderRouting("deepseek/deepseek-chat", 1536)).toEqual({
      allow_fallbacks: true,
      order: ["streamlake", "DeepInfra"],
      ignore: ["deepseek"],
    });
  });

  it("very_long continuation も streamlake 優先・DeepInfra フォールバック・本家DeepSeek除外", () => {
    expect(buildOpenRouterProviderRouting("deepseek/deepseek-chat", 768)).toEqual({
      allow_fallbacks: true,
      order: ["streamlake", "DeepInfra"],
      ignore: ["deepseek"],
    });
  });

  it("very_long 上限(3584)を超える deepseek は通常の provider fallback を維持する", () => {
    expect(buildOpenRouterProviderRouting("deepseek/deepseek-chat", 3585)).toEqual({
      allow_fallbacks: true,
      ignore: ["deepseek"],
    });
  });

  it("very_long 上限(3584)の deepseek も streamlake 優先・DeepInfra フォールバック", () => {
    expect(buildOpenRouterProviderRouting("deepseek/deepseek-chat", 3584)).toEqual({
      allow_fallbacks: true,
      order: ["streamlake", "DeepInfra"],
      ignore: ["deepseek"],
    });
  });

  // RIT-88 の壊しにいく確かめ: アダルト区分（= このアプリの全会話）の実行先に
  // 本家 DeepSeek が 0 件であることを provider.ignore で保証する。
  // 除外設定を消すとこの検査が全部落ちる。
  it.each([
    [EROTIC_CHAT_MODEL, undefined],
    [EROTIC_CHAT_MODEL, 768],
    [EROTIC_CHAT_MODEL, 3584],
    [EROTIC_CHAT_MODEL, 3585],
    [QWEN_CHAT_MODEL, undefined],
    [LLM_ROUTER_MODEL, undefined],
    ["deepseek/deepseek-chat-v3.2", 2048],
    ["some/other-model", undefined],
  ])(
    "どのモデル・token 設定でも本家 deepseek を送り先から除外する（%s %s）",
    (model, maxTokens) => {
      const routing = buildOpenRouterProviderRouting(model, maxTokens);
      expect(routing.ignore).toContain("deepseek");
      // order 指定があっても本家 deepseek は選択肢に入らんこと。
      expect(routing.order ?? []).not.toContain("deepseek");
    },
  );
});
