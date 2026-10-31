// @vitest-environment node
// 普通のビルドの後に `wrangler deploy --env staging` を打つと、焼かれた本番設定のまま
// 本番 Worker を上書きする（round 2 で実測）。deploy の前に置く門が、頼んだ環境と
// ビルド済みの設定の食い違いを必ず止めることを固定する。
// 「ビルド済みの設定」は wrangler 自身に wrangler.jsonc を環境ごとに解かせ、vite プラグインが
// 出す形（平らにした設定 + targetEnvironment）で置く。実ビルドでの確認は CI の
// deploy:staging:dry-run が受け持つ。
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const { unstable_readConfig: readWranglerConfig } = await import("wrangler");

const SCRIPT = fileURLToPath(new URL("../../script/assert-built-env.mjs", import.meta.url));
const WRANGLER = fileURLToPath(new URL("../../wrangler.jsonc", import.meta.url));

type Env = "production" | "staging";

const builtConfig = (env: Env) => {
  const resolved = readWranglerConfig({
    config: WRANGLER,
    env: env === "production" ? undefined : env,
  });
  const flat = { ...(resolved as unknown as Record<string, unknown>) };
  delete flat.env;
  return env === "staging" ? { ...flat, targetEnvironment: "staging" } : flat;
};

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const appWith = (
  built: Record<string, unknown> | null,
  redirect = "../../dist/server/wrangler.json",
) => {
  const dir = mkdtempSync(join(tmpdir(), "built-env-"));
  dirs.push(dir);
  copyFileSync(WRANGLER, join(dir, "wrangler.jsonc"));
  if (built) {
    mkdirSync(join(dir, "dist/server"), { recursive: true });
    writeFileSync(join(dir, "dist/server/wrangler.json"), JSON.stringify(built));
    mkdirSync(join(dir, ".wrangler/deploy"), { recursive: true });
    writeFileSync(
      join(dir, ".wrangler/deploy/config.json"),
      JSON.stringify({ configPath: redirect, auxiliaryWorkers: [] }),
    );
  }
  return dir;
};

const guard = (dir: string, env: string, cloudflareEnv?: string) => {
  const base = { ...process.env };
  delete base.CLOUDFLARE_ENV;
  const result = spawnSync(process.execPath, [SCRIPT, env, "--app-dir", dir], {
    encoding: "utf8",
    env: cloudflareEnv === undefined ? base : { ...base, CLOUDFLARE_ENV: cloudflareEnv },
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
};

describe("deploy 前の環境の門", () => {
  it("普通のビルド（本番設定）を staging として出そうとしたら止める", () => {
    const { status, output } = guard(appWith(builtConfig("production")), "staging");
    expect(status).toBe(1);
    expect(output).toContain("name が staging の設定と違う");
    expect(output).toContain("d1_databases が staging の設定と違う");
    expect(output).toContain("r2_buckets が staging の設定と違う");
  });

  it("staging のビルドを本番として出そうとしたら止める", () => {
    const { status, output } = guard(appWith(builtConfig("staging")), "production");
    expect(status).toBe(1);
    expect(output).toContain("name が production の設定と違う");
    expect(output).toContain("targetEnvironment が production の設定と違う");
  });

  it.each<Env>(["production", "staging"])("同じ環境のビルドは通す: %s", (env) => {
    const cloudflareEnv = env === "staging" ? "staging" : undefined;
    const { status, output } = guard(appWith(builtConfig(env)), env, cloudflareEnv);
    expect(output).toContain(`ビルド済みの設定は ${env} 向け`);
    expect(status).toBe(0);
  });

  it("束ねが一つでも本番のものに戻っとる staging ビルドは止める", () => {
    const built = builtConfig("staging") as Record<string, unknown>;
    const production = builtConfig("production") as Record<string, unknown>;
    const { status, output } = guard(
      appWith({ ...built, r2_buckets: production.r2_buckets }),
      "staging",
      "staging",
    );
    expect(status).toBe(1);
    expect(output).toContain("r2_buckets が staging の設定と違う");
    expect(output).not.toContain("name が");
  });

  it("CLOUDFLARE_ENV が頼んだ環境と食い違えば、設定が合っとっても止める", () => {
    const { status, output } = guard(appWith(builtConfig("production")), "production", "staging");
    expect(status).toBe(1);
    expect(output).toContain("CLOUDFLARE_ENV（staging）");
  });

  it("wrangler の転送先が確かめた設定と別の場所なら止める", () => {
    const dir = appWith(builtConfig("staging"), "../../../elsewhere/server/wrangler.json");
    const { status, output } = guard(dir, "staging", "staging");
    expect(status).toBe(1);
    expect(output).toContain("転送先が dist/server/wrangler.json でない");
  });

  it("ビルド前は止める", () => {
    const { status, output } = guard(appWith(null), "production");
    expect(status).toBe(1);
    expect(output).toContain("ビルド成果物が無い");
  });

  it.each(["", "prod", "preview"])("知らん環境名 %j は止める", (env) => {
    expect(guard(appWith(builtConfig("production")), env).status).toBe(2);
  });
});
