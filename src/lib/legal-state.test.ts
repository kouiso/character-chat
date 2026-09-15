import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  AGE_VERIFICATION_MAX_AGE_MS,
  AGE_VERIFICATION_STORAGE_KEY,
  getAgeVerificationState,
  isAgeVerified,
  setAgeVerified,
} from "./legal-state";

describe("legal-state", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("保存済みの年齢確認状態を読み取る", () => {
    localStorage.setItem(
      AGE_VERIFICATION_STORAGE_KEY,
      JSON.stringify({ verified: true, timestamp: 1000 }),
    );

    expect(getAgeVerificationState()).toEqual({ verified: true, timestamp: 1000 });
  });

  it("legacy true を現在の形式に移行する", () => {
    vi.spyOn(Date, "now").mockReturnValue(2000);
    localStorage.setItem(AGE_VERIFICATION_STORAGE_KEY, "true");

    expect(getAgeVerificationState()).toEqual({ verified: true, timestamp: 2000 });
    expect(localStorage.getItem(AGE_VERIFICATION_STORAGE_KEY)).toBe(
      JSON.stringify({ verified: true, timestamp: 2000 }),
    );
  });

  it("不正な保存値は未確認として扱う", () => {
    localStorage.setItem(AGE_VERIFICATION_STORAGE_KEY, "{broken");
    expect(getAgeVerificationState()).toBeNull();

    localStorage.setItem(AGE_VERIFICATION_STORAGE_KEY, JSON.stringify({ verified: false }));
    expect(getAgeVerificationState()).toBeNull();
  });

  it("期限内のみ確認済みとして扱う", () => {
    localStorage.setItem(
      AGE_VERIFICATION_STORAGE_KEY,
      JSON.stringify({ verified: true, timestamp: 1000 }),
    );

    expect(isAgeVerified(1000 + AGE_VERIFICATION_MAX_AGE_MS)).toBe(true);
    expect(isAgeVerified(1001 + AGE_VERIFICATION_MAX_AGE_MS)).toBe(false);
  });

  it("setAgeVerified は現在時刻を保存する", () => {
    setAgeVerified(3000);
    expect(JSON.parse(localStorage.getItem(AGE_VERIFICATION_STORAGE_KEY) ?? "{}")).toEqual({
      verified: true,
      timestamp: 3000,
    });
  });
});
