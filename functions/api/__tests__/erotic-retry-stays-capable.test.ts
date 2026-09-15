// @vitest-environment node
import { describe, expect, it } from "vitest";

import { DEFAULT_CHAT_MODEL, EROTIC_CHAT_MODEL } from "../../../src/lib/model";
import {
  getUpstreamFallbackModel,
  selectQualityRetryModel,
  TOO_SHORT_VERBOSE_RETRY_MODEL,
} from "../lib/route-context";

// 抜き所の既定は deepseek やのに、MODEL_FALLBACKS["deepseek/deepseek-chat"] が qwen なので
// 最初の撮り直しで qwen へ移っとった。実測 2026-08-19: qwen が答えた抜き所は可視 534〜946 字で
// 前ターンの逐語が 6.6〜42%、deepseek が答えた phase43 は 1141 字で 0.9%。
// 撮り直すほど短く・繰り返しになる構造やった。

describe("抜き所の撮り直しは官能が書けるモデルから降りん", () => {
  for (const category of ["repetition", "too_short"] as const) {
    it(`${category} で落ちても deepseek のまま撮り直す`, () => {
      expect(
        selectQualityRetryModel(EROTIC_CHAT_MODEL, EROTIC_CHAT_MODEL, category, false, true),
      ).toBe(EROTIC_CHAT_MODEL);
    });
  }

  it("抜き所で qwen に居るなら deepseek へ引き上げる", () => {
    expect(
      selectQualityRetryModel(DEFAULT_CHAT_MODEL, DEFAULT_CHAT_MODEL, "repetition", false, true),
    ).toBe(EROTIC_CHAT_MODEL);
  });

  it("抜き所やない段は今までどおり fallback 連鎖に従う", () => {
    expect(
      selectQualityRetryModel(EROTIC_CHAT_MODEL, EROTIC_CHAT_MODEL, "repetition", false, false),
    ).toBe(DEFAULT_CHAT_MODEL);
  });
});

// 上流の 429/502/503/504 でも同じ穴が空いとった。very_long だけが「官能が書けるモデルへ
// 逃がす」扱いで、出荷既定(medium)の抜き所は一時エラー 1 回で qwen へ移る。
// 実測 2026-08-19 phase50: Sakura t7/t9 が qwen 配信で 625/588 字やった。
describe("上流の一時エラーでも抜き所は qwen へ落とさん", () => {
  it("抜き所の deepseek は euryale へ逃がす", () => {
    expect(getUpstreamFallbackModel(EROTIC_CHAT_MODEL, false, true)).toBe(
      TOO_SHORT_VERBOSE_RETRY_MODEL,
    );
  });

  it("very_long も今までどおり euryale へ逃がす", () => {
    expect(getUpstreamFallbackModel(EROTIC_CHAT_MODEL, true, false)).toBe(
      TOO_SHORT_VERBOSE_RETRY_MODEL,
    );
  });

  it("抜き所やない段は今までどおり fallback 連鎖に従う", () => {
    expect(getUpstreamFallbackModel(EROTIC_CHAT_MODEL, false, false)).toBe(DEFAULT_CHAT_MODEL);
  });
});
