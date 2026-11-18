// RIT-99 CLI の終了コード確認。実プロセスで起こす（exit code は子プロセスでしか確かめられん）。
import { spawnSync } from "node:child_process";
import path from "node:path";

import { describe, expect, it } from "vitest";

const BENCH_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

const runCli = (argv: string[], env: NodeJS.ProcessEnv) =>
  spawnSync("pnpm", ["exec", "tsx", "src/memory-recall-check.ts", ...argv], {
    cwd: BENCH_DIR,
    env,
    encoding: "utf8",
    timeout: 120_000,
  });

describe("memory-recall-check CLI", () => {
  it(
    "--mode real で鍵が足りんと 4 で終わり、足りん変数名を stderr に出す",
    { timeout: 130_000 },
    () => {
      const env = { ...process.env };
      delete env.OPENROUTER_API_KEY;
      delete env.CLOUDFLARE_ACCOUNT_ID;
      delete env.CLOUDFLARE_API_TOKEN;
      const result = runCli(["--mode", "real"], env);
      expect(result.status).toBe(4);
      // 1 ターンも送られない（鍵確認はマイグレーションより先なので D1 には触れない）。
      expect(result.stderr).toContain("missing: OPENROUTER_API_KEY");
      expect(result.stderr).toContain("missing: CLOUDFLARE_ACCOUNT_ID");
      expect(result.stderr).toContain("missing: CLOUDFLARE_API_TOKEN");
      expect(result.stdout).toBe("");
    },
  );
});
