// 顔の絵 URL はキャラ id の受け口 1 本。avatar 値の形（ファイル名・/avatars/・R2 鍵）を
// 見て変えない事と、空なら URL を出さない事を確かめる。
// @vitest-environment node
import { describe, expect, it } from "vitest";

import { avatarUrl } from "./avatar-url";

describe("avatarUrl", () => {
  it("avatar が在れば /api/characters/<id>/avatar", () => {
    expect(avatarUrl("char-akane", "char-akane.jpg")).toMatch(
      /^\/api\/characters\/char-akane\/avatar\?v=[\da-z]+$/,
    );
    expect(avatarUrl("char-akane", "/avatars/char-akane.jpg")).toMatch(
      /^\/api\/characters\/char-akane\/avatar\?v=/,
    );
    // 旧アプリの R2 鍵（<利用者ID>/<UUID>.jpg）でも同じ受け口。
    expect(avatarUrl("char-legacy", "user-1/0f8fad5b-d9cb-469f-a165-70867728950e.jpg")).toMatch(
      /^\/api\/characters\/char-legacy\/avatar\?v=/,
    );
  });

  it("id の予約字はエンコードする", () => {
    expect(avatarUrl("char/odd?id", "a.png")).toMatch(
      /^\/api\/characters\/char%2Fodd%3Fid\/avatar\?/,
    );
  });

  it("avatar 値が変わると URL も変わる（max-age のキャッシュで古い顔が残らん）", () => {
    expect(avatarUrl("c1", "local/a.png")).not.toBe(avatarUrl("c1", "local/b.png"));
    expect(avatarUrl("c1", "local/a.png")).toBe(avatarUrl("c1", "local/a.png"));
  });

  it("null/undefined/空は null（<img> を出さない）", () => {
    expect(avatarUrl("char-akane", null)).toBeNull();
    expect(avatarUrl("char-akane", undefined)).toBeNull();
    expect(avatarUrl("char-akane", "")).toBeNull();
  });
});
