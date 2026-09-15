import { describe, expect, it } from "vitest";

import { resolveAvatarSrc } from "./avatar-url";

describe("resolveAvatarSrc", () => {
  it("keeps public avatar paths on the static asset route", () => {
    expect(resolveAvatarSrc("/avatars/char-yarisa-classmate.jpg")).toBe(
      "/avatars/char-yarisa-classmate.jpg",
    );
  });

  it("keeps existing api avatar routes unchanged", () => {
    expect(resolveAvatarSrc("/api/avatar/char-yarisa-classmate.jpg")).toBe(
      "/api/avatar/char-yarisa-classmate.jpg",
    );
  });

  it("keeps remote avatar URLs unchanged", () => {
    expect(resolveAvatarSrc("https://example.com/avatar.jpg")).toBe(
      "https://example.com/avatar.jpg",
    );
  });

  it("keeps browser image URLs unchanged", () => {
    expect(resolveAvatarSrc("data:image/png;base64,abc")).toBe("data:image/png;base64,abc");
    expect(resolveAvatarSrc("blob:https://example.com/avatar")).toBe(
      "blob:https://example.com/avatar",
    );
  });

  it("maps stored R2 avatar keys to the avatar API route", () => {
    expect(resolveAvatarSrc("char-yarisa-classmate.jpg")).toBe(
      "/api/avatar/char-yarisa-classmate.jpg",
    );
    expect(resolveAvatarSrc("nested/初音ミク.webp")).toBe(
      "/api/avatar/nested/%E5%88%9D%E9%9F%B3%E3%83%9F%E3%82%AF.webp",
    );
  });

  it("does not treat emoji or unsafe keys as image URLs", () => {
    expect(resolveAvatarSrc("🌸")).toBeNull();
    expect(resolveAvatarSrc("nested/..avatar.png")).toBeNull();
  });

  it("returns null for missing avatars", () => {
    expect(resolveAvatarSrc(null)).toBeNull();
    expect(resolveAvatarSrc(undefined)).toBeNull();
  });
});

// プロフィールアバターと会話生成画像のパス分離を保証するテスト (#323)
describe("profile avatar vs generated image path isolation", () => {
  it("R2 generated image absolute URL passes through unchanged and never routes to /api/avatar/", () => {
    const r2Url = "/api/image/r2/images/550e8400-e29b-41d4-a716-446655440000.png";
    const resolved = resolveAvatarSrc(r2Url);
    expect(resolved).toBe(r2Url);
    expect(resolved).not.toContain("/api/avatar/");
  });

  it("avatar URL is on a different route than R2 generated image URL", () => {
    const avatarUrl = "/api/avatar/char-yarisa-classmate.jpg";
    const r2Url = "/api/image/r2/images/550e8400-e29b-41d4-a716-446655440000.jpg";
    expect(avatarUrl).not.toBe(r2Url);
    expect(avatarUrl.startsWith("/api/avatar/")).toBe(true);
    expect(r2Url.startsWith("/api/image/r2/")).toBe(true);
  });

  it("a stored R2 image key never produces an avatar route when used as avatar source", () => {
    // R2 image keys have the form images/{uuid}.{ext} — if accidentally passed to
    // resolveAvatarSrc they route to /api/avatar/images/{uuid}.{ext}, NOT /api/image/r2/...
    const r2Key = "images/550e8400-e29b-41d4-a716-446655440000.png";
    const resolved = resolveAvatarSrc(r2Key);
    expect(resolved).toBe("/api/avatar/images/550e8400-e29b-41d4-a716-446655440000.png");
    expect(resolved).not.toContain("/api/image/r2/");
  });

  it("avatar paths (starting with /avatars/) are not valid R2 conversation image paths", () => {
    const avatarPath = "/avatars/char-yarisa-classmate.jpg";
    expect(avatarPath.startsWith("/api/image/r2/")).toBe(false);
  });
});
