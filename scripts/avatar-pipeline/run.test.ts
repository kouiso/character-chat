import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("avatar pipeline runner", () => {
  it("dry-run emits a bare avatar key, calls the R2 upload path, and does not write public/avatars", () => {
    const root = mkdtempSync(join(tmpdir(), "avatar-pipeline-"));
    const publicAvatarPath = join(process.cwd(), "public", "avatars", "phase4-pipeline-char.png");
    rmSync(publicAvatarPath, { force: true });
    writeFileSync(
      join(root, "inventory.json"),
      JSON.stringify([{ id: "phase4-pipeline-char", name: "Phase 4" }]),
      "utf8",
    );

    const uploadMockPath = join(root, "upload-mock.cjs");
    writeFileSync(
      uploadMockPath,
      "require('node:fs').appendFileSync(process.env.R2_LOG, `${process.argv[3]}\\n`);",
      "utf8",
    );

    const result = spawnSync(
      "python3",
      ["scripts/avatar-pipeline/run.py", "--root", root, "--dry-run"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          R2_UPLOAD_CMD: `node ${uploadMockPath} {file} {key}`,
          R2_LOG: join(root, "r2.log"),
        },
      },
    );

    expect(result.status).toBe(0);
    const state = JSON.parse(readFileSync(join(root, "state.json"), "utf8"));
    expect(state["phase4-pipeline-char"].avatar).toMatch(/^[^/][\w.-]+\.png$/);
    expect(state["phase4-pipeline-char"].avatar).toBe("phase4-pipeline-char.png");
    expect(readFileSync(join(root, "r2.log"), "utf8")).toContain(
      "avatars/phase4-pipeline-char.png",
    );
    expect(() => readFileSync(publicAvatarPath)).toThrow();
  });
});
