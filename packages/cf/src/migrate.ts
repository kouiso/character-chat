// `wrangler d1 migrations apply` を child_process 経由で叩く。ローカル D1 に schema を反映する用途のみ。
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PERSIST_ROOT, REPO_ROOT, WRANGLER_CONFIG } from "./index";

const WRANGLER_BIN = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../node_modules/.bin/wrangler",
);

/**
 * `pnpm db:migrate:local` と同じ store（.wrangler/state/v3）にローカル D1 の schema を反映する。
 * drizzle-kit のジャーナルには触れず、wrangler 自身の migrations テーブルで冪等に適用される。
 */
export const applyLocalMigrations = (): void => {
  // --persist-to を明示しないと wrangler は config ファイルのディレクトリ（apps/v2）基準で
  // 永続化先を決める。createPlatform() 側は REPO_ROOT/.wrangler/state/v3 を見るので、
  // 明示しないと別々の空 DB を見て「テーブルが無い」になる（実測済み）。
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
};
