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
const runtimeMode = process.env.RIT90_RUNTIME_HTTP === "1";
let mockGateway;
const runtimePayload = {
  conversationId: "runtime-conversation",
  requestId: "runtime-request",
  text: "合成データだけで背景返信を確認します。",
  turn: 1,
};
let runtimeDelivery;
let runtimeGeneration;
let sawInjectedFault = false;

const runtimePost = (base, payload = runtimePayload, cursor = 0) =>
  fetch(`${base}/api/chat/state-character`, {
    method: "POST",
    headers: {
      Authorization: authorization,
      "Content-Type": "application/json",
      "Last-Event-ID": String(cursor),
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20000),
  });

const decodeEvents = (text) =>
  text.split("\n\n").flatMap((block) => {
    const id = block.match(/^id: (\d+)$/m)?.[1];
    const type = block.match(/^event: (.+)$/m)?.[1];
    const data = block.match(/^data: (.+)$/m)?.[1];
    return id && type && data ? [{ id: Number(id), event: { type, ...JSON.parse(data) } }] : [];
  });

async function nativeRows(table, query, bindings) {
  const { DatabaseSync } = await import("node:sqlite");
  const rootState = path.join(isolated, ".wrangler/state/v3");
  const files = await readdir(rootState, { recursive: true });
  const rows = [];
  for (const file of files.filter((name) => name.endsWith(".sqlite"))) {
    const db = new DatabaseSync(path.join(rootState, file), { readOnly: true });
    try {
      if (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)) {
        rows.push(...db.prepare(query).all(...bindings));
      }
    } finally {
      db.close();
    }
  }
  return rows;
}

async function verifyRuntime(base, restarted) {
  if (!restarted) {
    const response = await runtimePost(base);
    assert.equal(response.status, 200);
    const reader = response.body.getReader();
    await reader.read();
    await reader.cancel();
    // 再POSTせず履歴だけを読み、切断後のalarmが自律的に保存を終えることを確認する。
    let saved;
    for (let i = 0; i < 200; i++) {
      const history = await fetch(
        `${base}/api/chat/state-character/history?conversationId=runtime-conversation`,
        {
          headers: { Authorization: authorization },
          signal: AbortSignal.timeout(5000),
        },
      );
      if (history.ok) {
        const candidate = await history.json();
        if (candidate.turn === 2) {
          const jobs = await nativeRows(
            "jobs",
            "SELECT status,attempts,generation_id FROM jobs WHERE id=?",
            [runtimePayload.requestId],
          );
          if (jobs.some((job) => job.status === "succeeded")) {
            assert.equal(jobs.length, 1);
            assert.equal(jobs[0].attempts, 1, "native alarm recovery must not regenerate");
            saved = candidate;
            break;
          }
        }
      }
      await delay(100);
    }
    assert.ok(saved, "native alarm must complete without a second POST");
    assert.equal(saved.history.length, 2);
    assert.deepEqual(
      saved.history.map((row) => row.turn),
      [1, 1],
    );
    runtimeDelivery = saved.deliveries[0];
    runtimeGeneration = runtimeDelivery.generationId;
    assert.ok(runtimeGeneration);
    assert.ok(runtimeDelivery.chunks.length > 0);
  }
  const response = await runtimePost(base);
  assert.equal(response.status, 200);
  const events = decodeEvents(await response.text());
  assert.ok(events.length >= 2);
  assert.equal(new Set(events.map((item) => item.id)).size, events.length);
  assert.ok(events.every((item, index) => index === 0 || item.id > events[index - 1].id));
  const delivery = events.find((item) => item.event.type === "delivery")?.event;
  assert.ok(delivery);
  assert.deepEqual(delivery.chunks, runtimeDelivery.chunks);
  assert.equal(delivery.generationId, runtimeGeneration);
  assert.equal(
    events.find((item) => item.event.type === "done")?.event.generationId,
    runtimeGeneration,
  );
  const generations = await nativeRows(
    "v2_generation",
    "SELECT id FROM v2_generation WHERE conversation_id=?",
    [runtimePayload.conversationId],
  );
  assert.deepEqual(
    generations.map((row) => row.id),
    [runtimeGeneration],
  );
  const after = events[0].id;
  const replay = await runtimePost(base, runtimePayload, after);
  assert.equal(replay.status, 200);
  assert.ok(decodeEvents(await replay.text()).every((item) => item.id > after));
  assert.equal(
    (await runtimePost(base, { ...runtimePayload, text: "different synthetic input" })).status,
    409,
  );
  assert.equal(
    (await runtimePost(base, { ...runtimePayload, requestId: "stale-request" })).status,
    409,
  );
  console.log(
    `PASS: native DO/alarm ${restarted ? "restart" : "disconnect"}, stable generation/chunk schedule, cursor replay, duplicate input and stale turn rejection`,
  );
}

async function verifyBrowser(base) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const errors = [];
  let posts = 0;
  let external = 0;
  try {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      httpCredentials: { username: "state-user", password: "state-pass" },
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        new URL(request.url()).pathname === "/api/chat/state-character"
      )
        posts++;
      if (new URL(request.url()).hostname !== "127.0.0.1") external++;
    });
    await page.goto(`${base}/chat/state-character`);
    await page.waitForLoadState("networkidle");
    const input = page.getByRole("textbox", { name: "メッセージ", exact: true });
    await input.fill("合成画面で二重送信と履歴復元を確認します。");
    await page.waitForFunction(
      () => !document.querySelector('form.v2-chat-form button[type="submit"]').disabled,
    );
    await page.locator("form.v2-chat-form").evaluate((form) => {
      form.requestSubmit();
      form.requestSubmit();
    });
    await page
      .getByText("ローカル試験用の返信です。", { exact: false })
      .first()
      .waitFor({ timeout: 20000 });
    await input.waitFor();
    await page.waitForFunction(
      () => !document.querySelector('input[aria-label="メッセージ"]').disabled,
    );
    assert.equal(posts, 1, "synchronous double submit must create one POST");
    assert.equal(
      await page.getByRole("group", { name: "あなたのメッセージ", exact: true }).count(),
      1,
    );
    await page.reload();
    await page
      .getByText("ローカル試験用の返信です。", { exact: false })
      .first()
      .waitFor({ timeout: 20000 });
    assert.equal(posts, 1, "restoring a completed conversation must not re-POST");
    assert.equal(
      await page.getByRole("group", { name: "あなたのメッセージ", exact: true }).count(),
      1,
    );
    const output = process.env.RIT90_BROWSER_EVIDENCE;
    if (output) await mkdir(output, { recursive: true });
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      const dimensions = await page.locator("form.v2-chat-form").boundingBox();
      assert.ok(dimensions && dimensions.y + dimensions.height <= 844);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      if (output) await page.screenshot({ path: path.join(output, `runtime-${width}.png`) });
    }
    assert.deepEqual(errors, []);
    assert.equal(external, 0);
    console.log(
      "PASS: native Worker browser double-submit POST1, reload POST0, persisted scheduled reply, mobile/desktop form visible, page errors0 and external requests0",
    );
  } finally {
    await browser.close();
  }
}

async function verifyConcurrentGateway(base) {
  const inputs = ["left", "right"].map((side) => ({
    conversationId: `parallel-${side}`,
    requestId: `parallel-request-${side}`,
    text: `synthetic ${side} input`,
    turn: 1,
  }));
  const completed = await Promise.all(
    inputs.map(async (input) => {
      const response = await runtimePost(base, input);
      assert.equal(response.status, 200);
      const events = decodeEvents(await response.text());
      assert.equal(
        events.find((item) => item.event.type === "done")?.event.conversationId,
        input.conversationId,
      );
      const generation = events.find((item) => item.event.type === "done")?.event.generationId;
      assert.ok(generation);
      return { input, generation };
    }),
  );
  assert.equal(new Set(completed.map((item) => item.generation)).size, 2);
  for (const { input, generation } of completed) {
    const users = await nativeRows(
      "v2_message",
      "SELECT content FROM v2_message WHERE conversation_id=? AND role='user'",
      [input.conversationId],
    );
    assert.deepEqual(
      users.map((row) => row.content),
      [input.text],
    );
    const audits = await nativeRows(
      "v2_model_attempt_audit",
      "SELECT run_id,attempt_json FROM v2_model_attempt_audit WHERE conversation_id=? ORDER BY call_index,attempt_index",
      [input.conversationId],
    );
    assert.ok(audits.length >= 2 && audits.every((row) => row.run_id.startsWith(`${generation}:`)));
    const attempts = audits.map((row) => JSON.parse(row.attempt_json));
    assert.equal(attempts[0].reason, "server-error");
    assert.equal(attempts[1].route, "fallback-1");
    assert.equal(attempts[1].provider, "Venice");
    const generations = await nativeRows(
      "v2_generation",
      "SELECT model_attempts_json FROM v2_generation WHERE conversation_id=?",
      [input.conversationId],
    );
    assert.equal(generations.length, 1);
    assert.deepEqual(
      JSON.parse(generations[0].model_attempts_json)[0].attempts,
      attempts.slice(0, 2),
    );
  }
  console.log(
    "PASS: concurrent real app graphs/Strict SDK against loopback mock gateway, primary503 -> Venice fallback, D1 call audit scoped to distinct generation/conversation; no real model used",
  );
}

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
      if (base) {
        const result = await run(base);
        if (runtimeMode && process.env.RIT90_FAULT === "1" && !sawInjectedFault) {
          const faults = await nativeRows(
            "runtime_fault_probe",
            "SELECT hits FROM runtime_fault_probe",
            [],
          );
          assert.deepEqual(
            faults.map((row) => row.hits),
            [1],
            "fault injection must actually execute once",
          );
          sawInjectedFault = true;
          console.log(
            "PASS: observed after-persist fault; native alarm retry recovered before a second POST, job attempts stayed 1",
          );
        }
        return result;
      }
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
  const history = await response.json();
  const deliveries = history.deliveries;
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].conversationId, "state-conversation");
  assert.equal(deliveries[0].turn, 1);
  assert.equal(deliveries[0].generationId, null);
  assert.equal(deliveries[0].chunks.length, 1);
  assert.equal(deliveries[0].chunks[0].text, "synthetic reply");
  assert.ok(Number.isSafeInteger(deliveries[0].chunks[0].scheduledAt));
  assert.ok(deliveries[0].serverNow >= deliveries[0].chunks[0].scheduledAt);
  assert.deepEqual(
    { ...history, deliveries: undefined },
    {
      conversationId: "state-conversation",
      turn: 2,
      deliveries: undefined,
      history: [
        { turn: 1, role: "user", content: "synthetic question" },
        { turn: 1, role: "assistant", content: "synthetic reply" },
      ],
    },
  );
}

try {
  if (runtimeMode && process.env.RIT62_MOCK_GATEWAY === "1") {
    const { openMockGateway } = await import("./mock-gateway.mjs");
    mockGateway = await openMockGateway({ failPrimary: true });
  }
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
  for (const migration of [
    "0076_v2_chunk_scheduled_at.sql",
    "0077_v2_chunk_rejection.sql",
    "0078_v2_turn_delivery.sql",
    "0079_v2_turn_commit.sql",
    "0080_character_profile.sql",
    "0081_character_version.sql",
    "0082_v2_generation_attempt.sql",
    "0083_v2_model_attempt_audit.sql",
  ]) {
    await cp(path.join(repo, "drizzle", migration), path.join(isolated, "drizzle", migration));
  }
  await writeFile(
    path.join(testApp, ".dev.vars"),
    "BASIC_AUTH_USER=state-user\nBASIC_AUTH_PASS=state-pass\n" +
      (runtimeMode ? `APP_ENV=test\nV2_FAKE_MODEL=${mockGateway ? "0" : "1"}\n` : "") +
      (mockGateway
        ? `OPENROUTER_API_KEY=synthetic-gateway-only\nV2_MODEL=synthetic/primary\nV2_OPENROUTER_BASE_URL=${mockGateway.baseUrl}\n`
        : "") +
      (process.env.RIT90_FAULT === "1" ? "V2_TEST_FAULT=after-persist-once\n" : ""),
  );
  if (runtimeMode && process.env.RIT90_FAULT === "1") {
    // Viteはalarm例外を標準出力へ出さないため、一時コピーだけに到達記録を加える。
    const roomPath = path.join(testApp, "src/server/chat-room.ts");
    const source = await readFile(roomPath, "utf8");
    const interruption = 'throw new Error("test interruption after persistence");';
    assert.equal(source.split(interruption).length, 2);
    await writeFile(
      roomPath,
      source.replace(
        interruption,
        'this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS runtime_fault_probe (hits INTEGER NOT NULL)");\n' +
          'this.ctx.storage.sql.exec("INSERT INTO runtime_fault_probe VALUES (1)");\n' +
          interruption,
      ),
    );
  }
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
  await platform.env.DB.prepare("INSERT INTO user (id,email,created_at) VALUES ('local','local@example.invalid',0)").run();
  await platform.env.DB.prepare("INSERT INTO character (id,user_id,name,system_prompt,greeting,tags,age,is_official,display_order,created_at) VALUES (?,'local',?,?,?,?,18,0,0,0)")
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
  await withDev(async (base) => {
    await verifyHistory(base);
    if (runtimeMode) await verifyRuntime(base, false);
    if (mockGateway) await verifyConcurrentGateway(base);
    if (runtimeMode && process.env.RIT90_BROWSER === "1") await verifyBrowser(base);
  });
  await withDev(async (base) => {
    await verifyHistory(base);
    if (runtimeMode) await verifyRuntime(base, true);
  });
  // 同じ成功 API を再起動後にも読み、app 配下に別の state が作られていないことを確認する。
  await assert.rejects(lstat(path.join(testApp, ".wrangler/state/v3")), { code: "ENOENT" });
  const rootState = await lstat(path.join(isolated, ".wrangler/state/v3"));
  assert.ok(rootState.isDirectory());
  console.log(
    "PASS: migration -> TurnStore save -> authenticated Vite page/history API -> restart persisted; one repo-root store, no app-local store",
  );
  if (mockGateway) {
    mockGateway.assertNoUnexpectedRequests();
    assert.ok(mockGateway.records.length >= 4);
    assert.ok(mockGateway.records.every((row) => row.authValid));
    console.log(
      `PASS: ${mockGateway.records.length} loopback-only mock gateway requests; synthetic authentication and provider policies checked`,
    );
  }
} finally {
  await mockGateway?.close();
  await rm(isolated, { recursive: true, force: true });
}
