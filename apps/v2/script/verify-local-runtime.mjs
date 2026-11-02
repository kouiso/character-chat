import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";

const base = new URL(process.env.V2_VERIFY_URL ?? "http://127.0.0.1:3100");
if (!["127.0.0.1", "localhost", "[::1]"].includes(base.hostname)) {
  throw new Error("Verification requires a loopback URL");
}
const secrets = parseEnv(await readFile(new URL("../.dev.vars", import.meta.url), "utf8"));
const headers = {
  authorization: `Basic ${Buffer.from(`${secrets.BASIC_AUTH_USERNAME}:${secrets.BASIC_AUTH_PASSWORD}`).toString("base64")}`,
  "content-type": "application/json",
};
const characterId = process.env.V2_VERIFY_CHARACTER_ID ?? "runtime-probe";
const endpoint = `/api/chat/${encodeURIComponent(characterId)}`;
const request = (path, init = {}) =>
  fetch(new URL(path, base), { ...init, headers: { ...headers, ...init.headers } });
const health = await request("/api/health");
assert.equal(health.status, 200);
assert.equal(
  (await health.json()).mockModel,
  true,
  "Live model verification is not allowed by this script",
);

for (const path of ["/", "/assets/private.js", endpoint, `${endpoint}/history`, "/api/health", "/api/media/example"]) {
  const denied = await fetch(new URL(path, base));
  assert.equal(denied.status, 401);
  assert.equal((await denied.arrayBuffer()).byteLength, 0);
}
const wrong = await fetch(new URL(endpoint, base), { headers: { authorization: "Basic invalid" } });
assert.equal(wrong.status, 401);
assert.equal((await wrong.arrayBuffer()).byteLength, 0);

const body = {
  conversationId: crypto.randomUUID(),
  requestId: crypto.randomUUID(),
  text: "図書館で本を探しています。",
};
const post = (payload, signal) =>
  request(endpoint, { method: "POST", body: JSON.stringify(payload), signal });
const abort = new AbortController();
const started = performance.now();
const pending = post(body, abort.signal)
  .then((response) => response.text())
  .catch(() => null);
await new Promise((resolve) => setTimeout(resolve, 300));
abort.abort();
await pending;
for (let attempt = 0; attempt < 10; attempt++) {
  const reconnect = await post(body);
  await reconnect.body?.cancel();
}
let history;
for (let attempt = 0; attempt < 100; attempt++) {
  const response = await request(`${endpoint}/history?conversationId=${body.conversationId}`);
  history = await response.json();
  if (history.history?.length === 2) break;
  await new Promise((resolve) => setTimeout(resolve, 100));
}
assert.equal(history.history?.length, 2);
const replay = await post(body);
assert.equal(replay.status, 200);
const transcript = await replay.text();
assert.ok(transcript.includes("event: done"));
const repeated = await post(body);
assert.equal(await repeated.text(), transcript);
const conflict = await post({ ...body, text: "同じ受付番号で別の内容" });
assert.equal(conflict.status, 409);
const finalHistory = await (
  await request(`${endpoint}/history?conversationId=${body.conversationId}`)
).json();
assert.equal(finalHistory.history.length, 2);
const cursor = [...transcript.matchAll(/^id: (\d+)/gm)].at(-1)?.[1];
assert.ok(cursor);
const resumed = await request(endpoint, {
  method: "POST",
  headers: { "last-event-id": cursor },
  body: JSON.stringify(body),
});
assert.equal((await resumed.text()).includes("event:"), false);
process.stdout.write(
  JSON.stringify({
    runtime: "workerd",
    unauthorizedBodiesEmpty: true,
    backgroundCompletedBeforeReconnect: true,
    replayIdentical: true,
    conflictStatus: conflict.status,
    persistedMessages: 2,
    cursorReplay: true,
    consecutiveReconnects: 10,
    durationMs: Math.round(performance.now() - started),
  }),
);
