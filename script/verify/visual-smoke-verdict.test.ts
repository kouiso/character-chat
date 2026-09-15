import { describe, expect, it } from "vitest";

import {
  isExpectedAnonymousAvatarDenial,
  isExpectedAuthBootstrapFailure,
  partitionRequestFailures,
  resolveVerdict,
} from "./visual-smoke-verdict";

describe("isExpectedAnonymousAvatarDenial", () => {
  it("匿名アクセスの 401 だけを除外する", () => {
    expect(isExpectedAnonymousAvatarDenial("http://x/api/avatar/sub/a.png", 401)).toBe(true);
  });

  it("公式アバターの 404 は実際の欠損なので除外せん", () => {
    expect(isExpectedAnonymousAvatarDenial("http://x/api/avatar/sakura.png", 404)).toBe(false);
    expect(isExpectedAnonymousAvatarDenial("http://x/api/avatar/sakura.png", 403)).toBe(false);
  });

  it("アバター以外は除外せん", () => {
    expect(isExpectedAnonymousAvatarDenial("http://x/api/characters", 401)).toBe(false);
  });
});

describe("isExpectedAuthBootstrapFailure", () => {
  it("署名鍵が無いローカル worker の session bootstrap 503 だけを除外する", () => {
    expect(isExpectedAuthBootstrapFailure("http://localhost:5173/api/auth/session", 503)).toBe(
      true,
    );
  });

  it("session の別 status と他 API の 503 は除外せん", () => {
    expect(isExpectedAuthBootstrapFailure("/api/auth/session", 401)).toBe(false);
    expect(isExpectedAuthBootstrapFailure("/api/auth/session", 500)).toBe(false);
    expect(isExpectedAuthBootstrapFailure("/api/characters", 503)).toBe(false);
  });
});

describe("partitionRequestFailures", () => {
  const failures = [
    { url: "http://localhost:5173/api/characters", detail: "net::ERR_EMPTY_RESPONSE" },
    { url: "http://localhost:5173/assets/logo.png", detail: "404" },
  ];

  it("worker が居らん時は /api の失敗をバックエンド不在として切り分ける", () => {
    const result = partitionRequestFailures(failures, false);

    expect(result.backendUnavailable.map((f) => f.url)).toEqual([
      "http://localhost:5173/api/characters",
    ]);
    expect(result.uiDefects.map((f) => f.url)).toEqual(["http://localhost:5173/assets/logo.png"]);
  });

  it("worker が居る時は全部 UI の欠陥として扱う", () => {
    const result = partitionRequestFailures(failures, true);

    expect(result.backendUnavailable).toEqual([]);
    expect(result.uiDefects).toHaveLength(2);
  });
});

describe("resolveVerdict", () => {
  // 単独実行の再現: worker を上げずに pnpm verify:visual を走らせると
  // OuApp が /api/characters を叩いて必ず失敗する。
  it("バックエンド不在は needs_work やなく channel_failure にする", () => {
    expect(
      resolveVerdict({
        pageErrors: [],
        uiDefects: [],
        backendUnavailable: [{ url: "/api/characters", detail: "net::ERR_EMPTY_RESPONSE" }],
        screenshotExists: true,
      }),
    ).toBe("channel_failure");
  });

  it("バックエンド不在が UI 欠陥より優先される", () => {
    expect(
      resolveVerdict({
        pageErrors: ["TypeError: x is not a function"],
        uiDefects: [],
        backendUnavailable: [{ url: "/api/characters", detail: "net::ERR_EMPTY_RESPONSE" }],
        screenshotExists: true,
      }),
    ).toBe("channel_failure");
  });

  it("UI の失敗リクエストは needs_work に効かせる", () => {
    expect(
      resolveVerdict({
        pageErrors: [],
        uiDefects: [{ url: "/api/avatar/sakura.png", detail: "404" }],
        backendUnavailable: [],
        screenshotExists: true,
      }),
    ).toBe("needs_work");
  });

  it("何も無ければ verified", () => {
    expect(
      resolveVerdict({
        pageErrors: [],
        uiDefects: [],
        backendUnavailable: [],
        screenshotExists: true,
      }),
    ).toBe("verified");
  });

  it("スクショが撮れていなければ channel_failure", () => {
    expect(
      resolveVerdict({
        pageErrors: [],
        uiDefects: [],
        backendUnavailable: [],
        screenshotExists: false,
      }),
    ).toBe("channel_failure");
  });
});
