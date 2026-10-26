import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";

const app = fileURLToPath(new URL("..", import.meta.url));
const repo = path.resolve(app, "../..");
const isolated = await realpath(await mkdtemp(path.join(tmpdir(), "rit59-dev-state-")));
const testApp = path.join(isolated, "apps/v2");
const require = createRequire(import.meta.url);
const vite = path.join(path.dirname(require.resolve("vite/package.json")), "bin/vite.js");
const tsx = path.join(repo, "node_modules/.bin/tsx");
const childEnv = {
  PATH: process.env.PATH,
  TMPDIR: process.env.TMPDIR,
  WRANGLER_SEND_METRICS: "false",
  CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false",
  CI: "true",
};
const authorization = `Basic ${btoa("state-user:state-pass")}`;
const packages = ["cf", "db", "engine", "judge", "prompt"];

async function linkDependencies(source, target) {
  await mkdir(target, { recursive: true });
  for (const name of await readdir(source)) {
    const from = path.join(source, name);
    const to = path.join(target, name);
    if (name === "@v2") {
      await mkdir(to, { recursive: true });
      for (const pkg of await readdir(from))
        await symlink(path.join(isolated, "packages", pkg), path.join(to, pkg));
    } else {
      await symlink(
        await realpath(from),
        to,
        (await lstat(from)).isDirectory() ? "dir" : undefined,
      );
    }
  }
}

async function withDev(run) {
  let output = "";
  // --persist-to を渡さず、正規 vite.config.ts の既定保存先を検査する。
  const child = spawn(process.execPath, [vite, "dev", "--host", "127.0.0.1", "--port", "0"], {
    cwd: testApp,
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });
  const closed = new Promise((resolve) => child.once("exit", resolve));
  try {
    for (let i = 0; i < 500; i++) {
      const base = stripVTControlCharacters(output).match(
        /Local:\s+(http:\/\/127\.0\.0\.1:\d+)/,
      )?.[1];
      if (base) return await run(base);
      if (child.exitCode !== null) throw new Error(output);
      await delay(100);
    }
    throw new Error(`local Vite did not become ready: ${output}`);
  } catch (error) {
    throw new Error(`${error.message}\nDev output:\n${stripVTControlCharacters(output)}`, {
      cause: error,
    });
  } finally {
    child.kill("SIGTERM");
    await Promise.race([closed, delay(5000)]);
    if (child.exitCode === null) {
      child.kill("SIGKILL");
      await closed;
    }
  }
}

async function verifyHistory(base) {
  const page = await fetch(base, {
    headers: { Authorization: authorization },
    signal: AbortSignal.timeout(20000),
  });
  assert.equal(page.status, 200, "Vite must see the migrated root store");
  assert.match(await page.text(), /Synthetic state fixture/);
  const url = `${base}/api/chat/state-character/history?conversationId=state-conversation`;
  const rejected = await fetch(url, { signal: AbortSignal.timeout(10000) });
  assert.equal(rejected.status, 401);
  assert.equal(await rejected.text(), "");
  const response = await fetch(url, {
    headers: { Authorization: authorization },
    signal: AbortSignal.timeout(10000),
  });
  assert.equal(response.status, 200, "authenticated history API must succeed");
  assert.deepEqual(await response.json(), {
    conversationId: "state-conversation",
    turn: 2,
    history: [
      { role: "user", content: "synthetic question" },
      { role: "assistant", content: "synthetic reply" },
    ],
  });
}

try {
  // ソースだけを一時 checkout に複製し、既存 .wrangler と実データは読み書きしない。
  for (const relative of ["apps/v2", ...packages.map((name) => `packages/${name}`), "src/schema"]) {
    await cp(path.join(repo, relative), path.join(isolated, relative), {
      recursive: true,
      filter: (source) =>
        !source
          .split(path.sep)
          .some((part) => ["node_modules", "dist", ".wrangler", ".dev.vars"].includes(part)) &&
        !/\.test\.tsx?$/.test(source),
    });
  }
  for (const relative of ["package.json", "packages/tsconfig.base.json"])
    await cp(path.join(repo, relative), path.join(isolated, relative));
  await symlink(path.join(repo, "node_modules"), path.join(isolated, "node_modules"), "dir");
  for (const relative of ["apps/v2", ...packages.map((name) => `packages/${name}`)]) {
    await linkDependencies(
      path.join(repo, relative, "node_modules"),
      path.join(isolated, relative, "node_modules"),
    );
  }
  await mkdir(path.join(isolated, "drizzle"));
  await cp(
    path.join(app, "test/fixture/local-state.sql"),
    path.join(isolated, "drizzle/0001_synthetic_state.sql"),
  );
  await writeFile(
    path.join(testApp, ".dev.vars"),
    "BASIC_AUTH_USER=state-user\nBASIC_AUTH_PASS=state-pass\n",
  );
  if (process.env.RIT59_STATE_REGRESSION_CONTROL === "1") {
    const config = path.join(testApp, "vite.config.ts");
    const text = await readFile(config, "utf8");
    assert.match(text, /persistState: \{ path: PERSIST_ROOT \}/);
    await writeFile(config, text.replace(/persistState: \{ path: PERSIST_ROOT \},?/, ""));
  }
  const seedPath = path.join(isolated, "packages/cf/src/state-seed.ts");
  await writeFile(
    seedPath,
    `
import assert from "node:assert/strict";
import path from "node:path";
import { applyLocalMigrations } from "./migrate";
import { createPlatform, PERSIST_ROOT, PERSIST_PATH } from "./index";
import { createDb, createD1TurnStore } from "@v2/db";
import { emptyLedger } from "../../prompt/src/index";
assert.equal(PERSIST_ROOT, path.join(process.cwd(), ".wrangler/state"));
assert.equal(PERSIST_PATH, path.join(PERSIST_ROOT, "v3"));
applyLocalMigrations();
const platform = await createPlatform({ remote: false });
try {
  await platform.env.DB.prepare("INSERT INTO character (id,name,system_prompt,greeting,tags,is_official,display_order,created_at) VALUES (?,?,?,?,?,0,0,0)")
    .bind("state-character", "Synthetic state fixture", "Synthetic fixture only.", "Hello fixture", "[]").run();
  await createD1TurnStore(createDb(platform.env.DB), { userId: "local", characterId: "state-character", promptVersion: "synthetic" }).saveTurn({
    conversationId: "state-conversation", turn: 1, userText: "synthetic question", ledger: emptyLedger(),
    events: [{type:"chunk",seq:0,text:"synthetic reply",judge:{ok:true,failures:[]},attempt:1,preExtend:true}],
  });
} finally { await platform.dispose(); }
console.log("PASS: existing migration + TurnStore writer used isolated repo-root persistence");
`,
  );
  const seed = spawnSync(tsx, [seedPath], {
    cwd: isolated,
    env: childEnv,
    encoding: "utf8",
    timeout: 45000,
  });
  assert.equal(seed.status, 0, seed.stdout + seed.stderr);
  await withDev(verifyHistory);
  await withDev(verifyHistory);
  // 同じ成功 API を再起動後にも読み、app 配下に別の state が作られていないことを確認する。
  await assert.rejects(lstat(path.join(testApp, ".wrangler/state/v3")), { code: "ENOENT" });
  const rootState = await lstat(path.join(isolated, ".wrangler/state/v3"));
  assert.ok(rootState.isDirectory());
  console.log(
    "PASS: migration -> TurnStore save -> authenticated Vite page/history API -> restart persisted; one repo-root store, no app-local store",
  );
} finally {
  await rm(isolated, { recursive: true, force: true });
}
