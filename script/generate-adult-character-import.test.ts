import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

// .work/scrape/ の CLI は gitignore 済みのローカル資産。無い環境では skip。
const SCRIPT_PRESENT = existsSync(
  join(process.cwd(), ".work/scrape/generate_adult_character_import.mjs"),
);

describe.skipIf(!SCRIPT_PRESENT)("adult character import avatar pipeline", () => {
  it("CLI writes import JSON with a bare key, calls R2 upload, and does not write public/avatars", () => {
    const root = mkdtempSync(join(tmpdir(), "character-import-"));
    const imagePath = join(root, "generated.png");
    const outputPath = join(root, "import.json");
    const uploadMockPath = join(root, "upload-mock.cjs");
    const uploadLogPath = join(root, "r2.log");
    const publicAvatarPath = join(process.cwd(), "public", "avatars", "import-charap-dry.png");
    rmSync(publicAvatarPath, { force: true });
    writeFileSync(imagePath, "png");
    writeFileSync(
      uploadMockPath,
      "require('node:fs').appendFileSync(process.env.R2_LOG, `${process.argv[3]}\\n`);",
      "utf8",
    );

    const result = spawnSync(
      "node",
      [
        ".work/scrape/generate_adult_character_import.mjs",
        "import-charap-dry",
        "Import Dry",
        imagePath,
        outputPath,
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: { ...process.env, R2_UPLOAD_CMD: `node ${uploadMockPath}`, R2_LOG: uploadLogPath },
      },
    );

    expect(result.status).toBe(0);
    const character = JSON.parse(readFileSync(outputPath, "utf8")) as {
      avatar: string;
      r2ObjectKey: string;
    };
    expect(character.avatar).toMatch(/^[^/][\w.-]+\.png$/);
    expect(character.r2ObjectKey).toBe("avatars/import-charap-dry.png");
    expect(readFileSync(uploadLogPath, "utf8")).toContain("avatars/import-charap-dry.png");
    expect(() => readFileSync(publicAvatarPath)).toThrow();
  });
});
