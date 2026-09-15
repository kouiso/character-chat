import { describe, expect, it } from "vitest";

import { DEFAULT_CHAT_MODEL, EROTIC_CHAT_MODEL, EURYALE_CHAT_MODEL } from "../../../src/lib/model";
import { getFirstTokenHedgeDelayMs } from "../[[route]]";

// #983: 短文ターンが11.1〜11.6秒になった窓では、ヘッジ(2本目の並走)が3/3で発火しとった。
// その形の回の体感時間は「待ち + 2本目が返すまで」なので、待ちを縮めた分がそのまま引ける。
// 待ちの値は1本目 euryale の頃の3.5秒のままで、1本目 qwen の会話経路にも当たっとった。
//
// このテストが留めるのは「モデルごとに待ちが分かれとること」と「削った量」だけ。
// 上流のTTFTから10秒要件を計算して留めることはせん。クライアントに1文字目が出る時刻は
// 上流の1トークン目とは別物で(実測: 表示7404msでヘッジ未発火の回がある)、
// 表示TTFCから上流のTTFTを復元できんため。
const PREVIOUS_HEDGE_DELAY_MS = 3_500;

describe("getFirstTokenHedgeDelayMs", () => {
  it("既定会話モデルが1本目の時は待ちを縮める", () => {
    expect(getFirstTokenHedgeDelayMs(DEFAULT_CHAT_MODEL)).toBe(1_500);
  });

  it("euryaleが1本目の時は3.5秒のまま待つ（乗り換えると erotic 品質が落ちるため）", () => {
    expect(getFirstTokenHedgeDelayMs(EURYALE_CHAT_MODEL)).toBe(3_500);
  });

  it("既定会話モデル以外は品質優先の待ちを使う", () => {
    for (const model of [EROTIC_CHAT_MODEL, "nousresearch/hermes-4-70b", "unknown/model"]) {
      expect(getFirstTokenHedgeDelayMs(model)).toBe(3_500);
    }
  });

  it("ヘッジが発火して2本目が勝った回から2秒引ける", () => {
    // #983 の窓(3/3で発火・11.1〜11.6秒)がこの形。この差分だけは上流の速さに依らず効く。
    const savedMs = PREVIOUS_HEDGE_DELAY_MS - getFirstTokenHedgeDelayMs(DEFAULT_CHAT_MODEL);
    expect(savedMs).toBe(2_000);
  });

  it("品質優先の経路からは1msも削っとらん", () => {
    // euryale→deepseek の乗り換えは 6/20 eval で確定した品質を落とす。速さのために触らん。
    expect(getFirstTokenHedgeDelayMs(EURYALE_CHAT_MODEL)).toBe(PREVIOUS_HEDGE_DELAY_MS);
  });
});
