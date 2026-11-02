import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const packageRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

// 手元の設定が本番と同じ D1 id を持つと、--remote で本番に書き込める。移行の CLI は、何かに触る前に断る。
describe("migrate:legacy の CLI", () => {
  it("--remote を付けると何もせずに失敗する", () => {
    const result = spawnSync(
      path.join(packageRoot, "node_modules/.bin/tsx"),
      ["src/migrate-legacy.ts", "--remote", "--target-user", "local"],
      { cwd: packageRoot, encoding: "utf8", timeout: 60_000 },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("v2 D1 is local-only");
  });
});
