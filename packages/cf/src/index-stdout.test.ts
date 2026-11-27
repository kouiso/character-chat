// 標準出力を JSON の報告に使う CLI（ベンチ・移行）のため、createPlatform が標準出力へ何も書かん事を確かめる。
// wrangler は proxy の環境変数があると、読み込んだ時点で案内を標準出力へ 1 行書く。
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { REPO_ROOT } from "./index";

const runScript = (env: NodeJS.ProcessEnv) => {
  const dir = mkdtempSync(path.join(tmpdir(), "cf-stdout-"));
  try {
    const indexPath = path.join(REPO_ROOT, "packages/cf/src/index.ts");
    const scriptPath = path.join(dir, "run.mts");
    writeFileSync(
      scriptPath,
      `import { createPlatform } from ${JSON.stringify(indexPath)};\nconst platform = await createPlatform({ persistRoot: ${JSON.stringify(dir)} });\nawait platform.dispose();\nprocess.stdout.write(JSON.stringify({ ok: true }));\n`,
    );
    return spawnSync("pnpm", ["exec", "tsx", scriptPath], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env,
      timeout: 100_000,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

describe("createPlatform の標準出力", () => {
  it(
    "proxy の環境変数があっても、呼び出し側の JSON だけが標準出力に出る",
    { timeout: 120_000 },
    () => {
      const env: NodeJS.ProcessEnv = { ...process.env, HTTPS_PROXY: "http://127.0.0.1:9" };
      delete env.WRANGLER_LOG;
      const result = runScript(env);
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(result.stdout).toBe('{"ok":true}');
    },
  );

  it("呼び出し側が WRANGLER_LOG を決めとる時は、それを上書きせん", { timeout: 120_000 }, () => {
    const env = { ...process.env, HTTPS_PROXY: "http://127.0.0.1:9", WRANGLER_LOG: "log" };
    const result = runScript(env);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Proxy environment variables detected");
  });
});
