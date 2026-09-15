import { describe, expect, it } from "vitest";

import { buildPath, parseRoute, pathForScreen, screenForRoute } from "./app-route";

// 素材管理は URL を持つ画面（#823）。アルバムから遷移して戻れることが前提なので、
// パスとルートの往復が壊れたら気づけるようにする。
describe("素材管理のルーティング", () => {
  it("/assets を素材管理ルートとして解析する", () => {
    expect(parseRoute("/assets")).toEqual({ page: "assets" });
  });

  it("ルートから /assets を組み立てる", () => {
    expect(buildPath({ page: "assets" })).toBe("/assets");
  });

  it("素材管理ルートは assets 画面を描く", () => {
    expect(screenForRoute({ page: "assets" })).toBe("assets");
  });

  it("assets 画面のパスは /assets に戻る", () => {
    expect(pathForScreen("assets")).toBe("/assets");
  });
});
