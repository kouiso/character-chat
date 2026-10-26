import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const app = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);
const cli = path.join(path.dirname(require.resolve("wrangler/package.json")), "bin/wrangler.js");
const configPath = path.join(app, "dist/probe/wrangler.json");
const state = await mkdtemp(path.join(tmpdir(), "rit62-probe-"));
const childEnv = {
  PATH: process.env.PATH,
  TMPDIR: process.env.TMPDIR,
  WRANGLER_SEND_METRICS: "false",
  CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false",
  CI: "true",
};
let mockCalls = 0;
const mock = createServer((request, response) => {
  if (
    request.url !== "/v1/chat/completions" ||
    request.headers.authorization !== "Bearer synthetic-local-only"
  ) {
    response.writeHead(400);
    response.end();
    return;
  }
  mockCalls++;
  request.resume();
  response.writeHead(200, { "content-type": "text/event-stream" });
  const chunk = (content, finish = null) =>
    `data: ${JSON.stringify({
      id: "synthetic",
      object: "chat.completion.chunk",
      created: 0,
      model: "synthetic/local-mock",
      choices: [{ index: 0, delta: { content }, finish_reason: finish }],
    })}\n\n`;
  response.write(chunk("local"));
  setTimeout(() => {
    response.write(chunk(" mock"));
    response.write(chunk("", "stop"));
    response.end("data: [DONE]\n\n");
  }, 20);
});
await new Promise((resolve) => mock.listen(0, "127.0.0.1", resolve));
const mockAddress = mock.address();
assert.ok(mockAddress && typeof mockAddress !== "string");
const mockBaseURL = `http://127.0.0.1:${mockAddress.port}/v1`;

async function withWorker(config, run, expectStartupFailure = false) {
  const started = performance.now();
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
      "--var",
      `MOCK_BASE_URL:${mockBaseURL}`,
    ],
    { cwd: app, env: childEnv, stdio: ["ignore", "pipe", "pipe"] },
  );
  child.stdout.on("data", (data) => {
    output += data;
  });
  child.stderr.on("data", (data) => {
    output += data;
  });
  const closed = new Promise((resolve) => child.once("exit", resolve));
  try {
    for (let i = 0; i < 300; i++) {
      if (expectStartupFailure && /No such module ["']node:async_hooks["']/.test(output)) {
        return { missingAsyncLocalStorageRejected: true };
      }
      const base = output.match(/Ready on (http:\/\/127\.0\.0\.1:\d+)/)?.[1];
      if (base) {
        assert.equal(expectStartupFailure, false, "missing ALS unexpectedly started");
        return await run(base, performance.now() - started);
      }
      if (child.exitCode !== null) throw new Error(output);
      await delay(100);
    }
    throw new Error(`probe did not settle: ${output}`);
  } finally {
    child.kill("SIGTERM");
    await Promise.race([closed, delay(5000)]);
    if (child.exitCode === null) {
      child.kill("SIGKILL");
      await closed;
    }
  }
}

try {
  const bundle = await readFile(path.join(app, "dist/probe/index.js"));
  const measurements = await withWorker(configPath, async (base, cliReadyMs) => {
    const turns = await Promise.all(
      ["left", "right"].map(async (id) => {
        const began = performance.now();
        const response = await fetch(`${base}/turn`, {
          headers: { "x-probe-id": id },
          signal: AbortSignal.timeout(10000),
        });
        assert.equal(response.status, 200);
        assert.match(response.headers.get("content-type"), /text\/event-stream/);
        let text = "";
        let firstByteMs;
        for await (const chunk of response.body) {
          firstByteMs ??= performance.now() - began;
          text += new TextDecoder().decode(chunk);
        }
        const events = text
          .split("\n\n")
          .filter(Boolean)
          .map((event) => {
            const [type, data] = event.split("\n");
            return { type: type.slice(7), data: JSON.parse(data.slice(6)) };
          });
        assert.deepEqual(
          events.map((event) => event.type),
          ["token", "token", "done"],
        );
        assert.deepEqual(
          events.map((event) => event.data.text),
          ["local", " mock", "local mock"],
        );
        assert.ok(
          events.every((event) => event.data.requestId === id),
          "ALS request identity crossed",
        );
        return { id, firstByteMs, totalMs: performance.now() - began, events: events.length };
      }),
    );
    assert.equal(mockCalls, 2);
    return {
      mode: "local mock only; no AI Gateway or model API",
      bundleBytes: bundle.length,
      gzipBytes: gzipSync(bundle).length,
      cliReadyMs,
      turns,
      mockCalls,
    };
  });
  const oldConfig = JSON.parse(await readFile(configPath, "utf8"));
  oldConfig.main = path.join(app, "dist/probe/index.js");
  oldConfig.compatibility_date = "2024-01-01";
  oldConfig.compatibility_flags = [];
  const oldConfigPath = path.join(state, "no-als.json");
  await writeFile(oldConfigPath, JSON.stringify(oldConfig));
  const negative = await withWorker(oldConfigPath, undefined, true);
  console.log(JSON.stringify({ ...measurements, ...negative }, null, 2));
} finally {
  await new Promise((resolve) => mock.close(resolve));
  await rm(state, { recursive: true, force: true });
}
