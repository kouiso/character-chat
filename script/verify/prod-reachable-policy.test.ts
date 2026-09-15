import { describe, expect, it } from "vitest";

import { isProtectedApiGuarded, isPublicAppShell } from "./prod-reachable-policy";

describe("prod reachable policy", () => {
  it("公開アプリシェルのHTMLだけを正常扱いする", () => {
    expect(isPublicAppShell({ status: 200, body: "<!doctype html><html></html>" })).toBe(true);
    expect(isPublicAppShell({ status: 200, body: "" })).toBe(false);
    expect(isPublicAppShell({ status: 401, body: "<html></html>" })).toBe(false);
  });

  it("保護APIの401と403を認証ガードとして扱う", () => {
    expect(isProtectedApiGuarded(401)).toBe(true);
    expect(isProtectedApiGuarded(403)).toBe(true);
    expect(isProtectedApiGuarded(200)).toBe(false);
  });
});
