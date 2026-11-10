// avatar カラムの2形態（ファイル名・/avatars/ パス）をどちらも静的配信へ解決する確かめ。
// @vitest-environment node
import { describe, expect, it } from "vitest";

import { avatarUrl } from "./avatar-url";

describe("avatarUrl", () => {
  it("ファイル名は /avatars/ へ前置する", () => {
    expect(avatarUrl("char-akane.jpg")).toBe("/avatars/char-akane.jpg");
  });

  it("パス形は前置を重ねない", () => {
    expect(avatarUrl("/avatars/char-aria01.png")).toBe("/avatars/char-aria01.png");
  });

  it("日本語ファイル名はエンコードする", () => {
    expect(avatarUrl("import-charap-アイリス.png")).toBe(
      `/avatars/${encodeURIComponent("import-charap-アイリス.png")}`,
    );
  });

  it("null/undefined/空は null", () => {
    expect(avatarUrl(null)).toBeNull();
    expect(avatarUrl(undefined)).toBeNull();
    expect(avatarUrl("")).toBeNull();
  });
});
