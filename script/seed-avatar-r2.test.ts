import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveAvatar, uploadSeedAvatarsToR2, type SeedAvatarUpload } from "./seed";

const avatarDir = join(import.meta.dirname, "..", "public", "avatars");
const testFiles = ["phase4-seed-avatar.png", "phase4-seed-avatar.jpg"];

describe("seed avatar R2 pipeline", () => {
  afterEach(() => {
    for (const file of testFiles) rmSync(join(avatarDir, file), { force: true });
    vi.unstubAllEnvs();
  });

  it("resolves existing static avatar files to bare R2 keys", () => {
    mkdirSync(avatarDir, { recursive: true });
    writeFileSync(join(avatarDir, "phase4-seed-avatar.png"), "png");

    const avatar = resolveAvatar("phase4-seed-avatar", null);

    expect(avatar).toMatch(/^[^/][\w.-]+\.(png|jpg|jpeg|webp)$/);
    expect(avatar).toBe("phase4-seed-avatar.png");
  });

  it("uploads seed avatars to the R2 avatars/ prefix without changing the DB value shape", () => {
    mkdirSync(avatarDir, { recursive: true });
    writeFileSync(join(avatarDir, "phase4-seed-avatar.jpg"), "jpg");
    const uploads: SeedAvatarUpload[] = [];

    uploadSeedAvatarsToR2((upload) => uploads.push(upload));

    expect(uploads).toContainEqual({
      key: "avatars/phase4-seed-avatar.jpg",
      filePath: join(avatarDir, "phase4-seed-avatar.jpg"),
    });
    expect(resolveAvatar("phase4-seed-avatar", null)).toBe("phase4-seed-avatar.jpg");
    expect(resolveAvatar("phase4-seed-avatar", null)).not.toMatch(/^\//);
  });
});
