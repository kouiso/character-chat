import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const app = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);
const cli = path.join(path.dirname(require.resolve("wrangler/package.json")), "bin/wrangler.js");
const temporary = await mkdtemp(path.join(tmpdir(), "rit62-startup-"));
try {
  const form = new FormData();
  form.set(
    "metadata",
    JSON.stringify({
      main_module: "index.js",
      bindings: [],
      compatibility_date: "2026-10-26",
      compatibility_flags: ["nodejs_compat"],
    }),
  );
  form.set(
    "index.js",
    new Blob([await readFile(path.join(app, "dist/probe/index.js"))], {
      type: "application/javascript+module",
    }),
    "index.js",
  );
  const bundle = path.join(temporary, "worker.bundle");
  await writeFile(bundle, Buffer.from(await new Response(form).arrayBuffer()));
  // 明示した bundle からの計測なら Wrangler 内部の deploy --dry-run 分岐を通らない。
  const result = spawnSync(
    process.execPath,
    [
      cli,
      "check",
      "startup",
      "--workerBundle",
      bundle,
      "--config",
      "probe/wrangler.jsonc",
      "--outfile",
      "dist/probe/startup.cpuprofile",
    ],
    {
      cwd: app,
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        TMPDIR: process.env.TMPDIR,
        WRANGLER_SEND_METRICS: "false",
        CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false",
        CI: "true",
      },
    },
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
  process.stdout.write(result.stdout);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
