import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const checks = {
  lint: ["pnpm", "run", "lint"],
  typecheck: ["pnpm", "run", "typecheck"],
  test: ["pnpm", "run", "test:coverage"],
  build: ["pnpm", "run", "build"],
  migrations: ["pnpm", "run", "db:migrate:local"],
  e2e: ["pnpm", "run", "test:e2e"],
  "boot-smoke": ["node", "scripts/boot-smoke.mjs"],
  "deploy-guard": ["pnpm", "verify:no-github-actions-deploy"],
  "runner-guard": ["bash", "./.github/script/check-runner-hardcode.sh"],
};
const profiles = {
  fast: ["lint", "typecheck", "test"],
  // なぜ: ローカルの全検査も同じビルドを再利用して起動を確認する。
  full: [
    "lint",
    "typecheck",
    "test",
    "build",
    "migrations",
    "e2e",
    "boot-smoke",
    "deploy-guard",
    "runner-guard",
  ],
};
const selected = profiles[process.argv[2]] ?? (checks[process.argv[2]] ? [process.argv[2]] : null);
if (!selected) {
  console.error("Unknown CI phase");
  process.exit(2);
}
for (const phase of selected) {
  const [command, ...args] = checks[phase];
  // なぜ: 永続 workspace の既存 DB では初回 migration の順序を検査できない。
  const database = phase === "migrations" ? mkdtempSync(join(tmpdir(), "character-ci-d1-")) : null;
  let result;
  try {
    result = spawnSync(command, database ? [...args, "--persist-to", database] : args, {
      stdio: "inherit",
    });
  } finally {
    if (database) rmSync(database, { recursive: true, force: true });
  }
  if (result.error) console.error(result.error.message);
  if (result.status !== 0) process.exit(result.status ?? 1);
}
