// 顔の絵 URL はキャラ id の受け口 1 本。avatar 値の形（ファイル名・/avatars/・R2 鍵）を
// 見て変えない事と、空なら URL を出さない事を確かめる。
// @vitest-environment node
import { describe, expect, it } from "vitest";

import { avatarUrl } from "./avatar-url";

describe("avatarUrl", () => {
  it("avatar が在れば /api/characters/<id>/avatar", () => {
    expect(avatarUrl("char-akane", "char-akane.jpg")).toBe("/api/characters/char-akane/avatar");
    expect(avatarUrl("char-akane", "/avatars/char-akane.jpg")).toBe(
      "/api/characters/char-akane/avatar",
    );
    // 旧アプリの R2 鍵（<利用者ID>/<UUID>.jpg）でも同じ受け口。
    expect(avatarUrl("char-legacy", "user-1/0f8fad5b-d9cb-469f-a165-70867728950e.jpg")).toBe(
      "/api/characters/char-legacy/avatar",
    );
  });

  it("id の予約字はエンコードする", () => {
    expect(avatarUrl("char/odd?id", "a.png")).toBe("/api/characters/char%2Fodd%3Fid/avatar");
  });

  it("null/undefined/空は null（<img> を出さない）", () => {
    expect(avatarUrl("char-akane", null)).toBeNull();
    expect(avatarUrl("char-akane", undefined)).toBeNull();
    expect(avatarUrl("char-akane", "")).toBeNull();
  });
});
