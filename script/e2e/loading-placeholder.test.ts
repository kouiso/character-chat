import { describe, expect, it } from "vitest";

import {
  LOADING_PLACEHOLDER_PATTERN,
  isLoadingPlaceholder,
  stripLoadingPlaceholder,
} from "./loading-placeholder";

// 実際に #899 の採点を壊した文字列。run-20260716-005827-5af1 の S4 t6/t7/t8、
// S6 t8/t10、S7 t7 で assistantMsg として記録されとった。
const OBSERVED = "ことばを探している…";

describe("isLoadingPlaceholder", () => {
  it("実際に記録されてしまった待ち文言を待ち文言と判定する", () => {
    expect(isLoadingPlaceholder(OBSERVED)).toBe(true);
  });

  it("前後の空白があっても判定できる", () => {
    expect(isLoadingPlaceholder(`  ${OBSERVED}  `)).toBe(true);
  });

  it("旧UIの待ち文言も拾う", () => {
    expect(isLoadingPlaceholder("受信中…")).toBe(true);
    expect(isLoadingPlaceholder("受信中...")).toBe(true);
  });

  it("待ち文言で始まるだけの本文は本文として残す", () => {
    expect(isLoadingPlaceholder("ことばを探している…と彼女は言った")).toBe(false);
  });

  it("実際の返事を待ち文言と誤判定せん", () => {
    expect(isLoadingPlaceholder("あら、久しぶり。どう？最近どうしてるの？")).toBe(false);
  });
});

describe("stripLoadingPlaceholder", () => {
  it("待ち文言を空にして呼び出し側の fallback へ流す", () => {
    expect(stripLoadingPlaceholder(OBSERVED)).toBe("");
  });

  it("本文はそのまま返す", () => {
    const body = "彼女は静かに本を閉じた。";
    expect(stripLoadingPlaceholder(body)).toBe(body);
  });
});

describe("LOADING_PLACEHOLDER_PATTERN", () => {
  // browser-wait.ts はブラウザ側で評価する文字列へこの正規表現を埋め込む。
  // toString() が壊れると待ち文言の除去が丸ごと無効になるため固定する。
  it("ブラウザ側へ埋め込める形に文字列化できる", () => {
    expect(LOADING_PLACEHOLDER_PATTERN.toString()).toBe("/^(ことばを探している|受信中)[….]*$/");
  });
});
