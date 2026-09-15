// テスト用: ローカル D1（.wrangler/state/v3、root の pnpm db:migrate:local と同じ store）に
// migration を当ててから getPlatformProxy で束縛する。
// @v2/cf に同じ処理があるが、cf は check.ts で @v2/db に依存しとるので db 側から cf を使うと
// ワークスペースの依存が循環する。wrangler を直接使って db 側で閉じる。
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getPlatformProxy } from "wrangler";

import { createDb, type V2Db } from "../client";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const REPO_ROOT = path.resolve(PACKAGE_ROOT, "../..");
const WRANGLER_CONFIG = path.join(REPO_ROOT, "apps/v2/wrangler.jsonc");
// getPlatformProxy の persist.path は v3 ディレクトリそのもの、wrangler CLI の --persist-to は
// その親（CLI が自分で /v3 を足す）。@v2/cf と同じ非対称の吸収。
const PERSIST_ROOT = path.join(REPO_ROOT, ".wrangler/state");
const PERSIST_PATH = path.join(PERSIST_ROOT, "v3");
const WRANGLER_BIN = path.join(PACKAGE_ROOT, "node_modules/.bin/wrangler");

type LocalEnv = { DB: D1Database };

export type LocalD1 = { db: V2Db; d1: D1Database; dispose: () => Promise<void> };

export const openLocalD1 = async (): Promise<LocalD1> => {
  execFileSync(
    WRANGLER_BIN,
    [
      "d1",
      "migrations",
      "apply",
      "adult-ai-db",
      "--local",
      "-c",
      WRANGLER_CONFIG,
      "--persist-to",
      PERSIST_ROOT,
    ],
    { cwd: REPO_ROOT, stdio: "inherit" },
  );
  const proxy = await getPlatformProxy<LocalEnv>({
    configPath: WRANGLER_CONFIG,
    persist: { path: PERSIST_PATH },
    remoteBindings: false,
  });
  return { db: createDb(proxy.env.DB), d1: proxy.env.DB, dispose: () => proxy.dispose() };
};
