import { describe, expect, it } from "vitest";

import {
  DEFAULT_CHAT_MODEL,
  EROTIC_CHAT_MODEL,
  EURYALE_CHAT_MODEL,
  MODEL_FALLBACKS,
} from "../../../src/lib/model";
import { QUALITY_RETRY_FALLBACK_MODEL, selectQualityRetryModel } from "../lib/route-context";

describe("selectQualityRetryModel", () => {
  const UNKNOWN_MODEL = "unknown/model-1b";

  describe("too_short category", () => {
    it("very_long で currentModel が qwen のとき erotic-capable モデルへ切り替える", () => {
      const result = selectQualityRetryModel(
        DEFAULT_CHAT_MODEL,
        DEFAULT_CHAT_MODEL,
        "too_short",
        true,
      );
      expect(result).toBe(EROTIC_CHAT_MODEL);
    });

    it("very_long で currentModel がすでに deepseek のときはそのまま", () => {
      const result = selectQualityRetryModel(
        DEFAULT_CHAT_MODEL,
        EROTIC_CHAT_MODEL,
        "too_short",
        true,
      );
      expect(result).toBe(EROTIC_CHAT_MODEL);
    });

    it("very_long で currentModel が euryale のときはそのまま", () => {
      const result = selectQualityRetryModel(
        DEFAULT_CHAT_MODEL,
        EURYALE_CHAT_MODEL,
        "too_short",
        true,
      );
      expect(result).toBe(EURYALE_CHAT_MODEL);
    });

    it("very_long でないときは currentModel を維持する", () => {
      const result = selectQualityRetryModel(
        DEFAULT_CHAT_MODEL,
        DEFAULT_CHAT_MODEL,
        "too_short",
        false,
      );
      expect(result).toBe(DEFAULT_CHAT_MODEL);
    });
  });

  describe("very_long 非 too_short", () => {
    it("currentModel が qwen のとき erotic-capable モデルへ切り替える", () => {
      const result = selectQualityRetryModel(
        DEFAULT_CHAT_MODEL,
        DEFAULT_CHAT_MODEL,
        undefined,
        true,
      );
      expect(result).toBe(EROTIC_CHAT_MODEL);
    });

    it("currentModel が deepseek のときは deepseek を維持する", () => {
      const result = selectQualityRetryModel(
        DEFAULT_CHAT_MODEL,
        EROTIC_CHAT_MODEL,
        undefined,
        true,
      );
      expect(result).toBe(EROTIC_CHAT_MODEL);
    });

    it("currentModel が euryale のときは euryale を維持する", () => {
      const result = selectQualityRetryModel(
        DEFAULT_CHAT_MODEL,
        EURYALE_CHAT_MODEL,
        undefined,
        true,
      );
      expect(result).toBe(EURYALE_CHAT_MODEL);
    });

    it("currentModel が不明な erotic-incapable モデルのときも erotic-capable へ切り替える", () => {
      const result = selectQualityRetryModel(UNKNOWN_MODEL, UNKNOWN_MODEL, undefined, true);
      expect(result).toBe(EROTIC_CHAT_MODEL);
    });
  });

  describe("通常の fallback chain（very_long ではない）", () => {
    it("qwen から qwen への retry は fallback chain の次のモデルへ", () => {
      const expected = MODEL_FALLBACKS[DEFAULT_CHAT_MODEL]?.[0];
      expect(expected).toBeDefined();
      expect(expected).not.toBe(DEFAULT_CHAT_MODEL);
      const result = selectQualityRetryModel(
        DEFAULT_CHAT_MODEL,
        DEFAULT_CHAT_MODEL,
        "other",
        false,
      );
      expect(result).toBe(expected);
    });

    it("qwen から deepseek への retry は次に DEFAULT_CHAT_MODEL へ降下する", () => {
      const result = selectQualityRetryModel(DEFAULT_CHAT_MODEL, EROTIC_CHAT_MODEL, "other", false);
      expect(result).toBe(DEFAULT_CHAT_MODEL);
    });

    it("euryale から euryale への retry は fallback chain の次のモデルへ", () => {
      const expected = MODEL_FALLBACKS[EURYALE_CHAT_MODEL]?.[0];
      expect(expected).toBeDefined();
      expect(expected).not.toBe(EURYALE_CHAT_MODEL);
      const result = selectQualityRetryModel(
        EURYALE_CHAT_MODEL,
        EURYALE_CHAT_MODEL,
        "other",
        false,
      );
      expect(result).toBe(expected);
    });

    it("deepseek から deepseek への retry は fallback chain の次のモデルへ", () => {
      const expected = MODEL_FALLBACKS[EROTIC_CHAT_MODEL]?.[0];
      expect(expected).toBeDefined();
      expect(expected).not.toBe(EROTIC_CHAT_MODEL);
      const result = selectQualityRetryModel(EROTIC_CHAT_MODEL, EROTIC_CHAT_MODEL, "other", false);
      expect(result).toBe(expected);
    });
  });

  describe("最終 fallback", () => {
    it("fallback chain もない状態で quality retry fallback にいる場合は DEFAULT_CHAT_MODEL へ", () => {
      const result = selectQualityRetryModel(
        UNKNOWN_MODEL,
        QUALITY_RETRY_FALLBACK_MODEL,
        "other",
        false,
      );
      expect(result).toBe(DEFAULT_CHAT_MODEL);
    });
  });
});
