import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const app = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);
const cli = path.join(path.dirname(require.resolve("wrangler/package.json")), "bin/wrangler.js");
const config = path.join(app, "dist/server/wrangler.json");
const state = await mkdtemp(path.join(tmpdir(), "rit59-auth-"));
const childEnv = {
  PATH: process.env.PATH,
  TMPDIR: process.env.TMPDIR,
  WRANGLER_SEND_METRICS: "false",
  CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false",
  CI: "true",
};
const valid = `Basic ${btoa("local-user:local-pass:colon")}`;
const assets = await readdir(path.join(app, "dist/client/assets"));
const assetPath = `/assets/${assets.find((name) => name.endsWith(".js"))}`;
const targets = [
  ["/", "GET"],
  ["/chat/synthetic", "GET"],
  ["/api/chat/synthetic/history", "GET"],
  ["/api/chat/synthetic", "POST"],
  [assetPath, "GET"],
  [assetPath, "HEAD"],
  ["/api/chat/synthetic", "OPTIONS"],
];
let checks = 0;

async function withWorker(vars, run) {
  let output = "";
  const child = spawn(
    process.execPath,
    [
      cli,
      "dev",
      "--local",
      "--config",
      config,
      "--persist-to",
      state,
      "--ip",
      "127.0.0.1",
      "--port",
      "0",
      "--inspector-port",
      "0",
      ...vars.flatMap((value) => ["--var", value]),
    ],
    { cwd: app, env: childEnv, stdio: ["ignore", "pipe", "pipe"] },
  );
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });
  const closed = new Promise((resolve) => child.once("exit", resolve));
  try {
    let base;
    for (let i = 0; i < 300; i++) {
      base = output.match(/Ready on (http:\/\/127\.0\.0\.1:\d+)/)?.[1];
      if (base) break;
      if (child.exitCode !== null) throw new Error(output);
      await delay(100);
    }
    assert.ok(base, `local worker did not become ready: ${output}`);
    await run(base);
  } finally {
    child.kill("SIGTERM");
    await Promise.race([closed, delay(5000)]);
    if (child.exitCode === null) {
      child.kill("SIGKILL");
      await closed;
    }
  }
}

async function denied(base, authorization, expected) {
  for (const [url, method] of targets) {
    const response = await fetch(`${base}${url}`, {
      method,
      headers: authorization ? { Authorization: authorization } : {},
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(response.status, expected, `${method} ${url}`);
    assert.equal(await response.text(), "", `${method} ${url} leaked a body`);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.has("www-authenticate"), expected === 401);
    checks++;
  }
}

try {
  // 空の一時 DB に一覧表示用の最小スキーマだけを作り、既存データには接続しない。
  const setup = spawnSync(
    process.execPath,
    [
      cli,
      "d1",
      "execute",
      "adult-ai-db",
      "--local",
      "--config",
      config,
      "--persist-to",
      state,
      "--command",
      "CREATE TABLE character (id TEXT PRIMARY KEY, name TEXT, avatar TEXT, display_order INTEGER, created_at INTEGER);",
    ],
    { cwd: app, env: childEnv, encoding: "utf8" },
  );
  assert.equal(setup.status, 0, setup.stderr);

  await withWorker(
    ["BASIC_AUTH_USER:local-user", "BASIC_AUTH_PASS:local-pass:colon"],
    async (base) => {
      for (const header of [
        undefined,
        `Basic ${btoa("local-user:wrong")}`,
        `Basic ${btoa("wrong:local-pass:colon")}`,
        "Basic !!!",
        `Basic ${btoa("no-colon")}`,
      ]) {
        await denied(base, header, 401);
      }
      for (const [url, method, expected] of [
        ["/", "GET", 200],
        [assetPath, "GET", 200],
        [assetPath, "HEAD", 200],
        ["/api/chat/synthetic/history", "GET", 400],
        ["/api/chat/synthetic", "POST", 400],
      ]) {
        const response = await fetch(`${base}${url}`, {
          method,
          headers: { Authorization: valid },
          signal: AbortSignal.timeout(5000),
        });
        assert.equal(response.status, expected, `authenticated ${method} ${url}`);
        if (url === "/") assert.match(await response.text(), /キャラクター/);
        if (method === "HEAD") assert.equal(await response.text(), "");
        checks++;
      }
    },
  );
  await withWorker([], (base) => denied(base, valid, 503));
  await withWorker(["BASIC_AUTH_USER:local-user", "BASIC_AUTH_PASS:"], (base) =>
    denied(base, valid, 503),
  );
  console.log(
    `PASS: ${checks} built-worker HTTP checks (synthetic credentials, isolated empty DB, no model API)`,
  );
} finally {
  await rm(state, { recursive: true, force: true });
}
