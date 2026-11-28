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

for (const path of [
  "/",
  "/assets/private.js",
  endpoint,
  `${endpoint}/history`,
  "/api/health",
  "/api/media/example",
]) {
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

// 2 ターン目以降で初めて通る所（ターンの採番・履歴の積み上げ・前ターンとの反復判定）を
// 鍵なしで踏む。1 ターン目だけやと、固定モデルが毎ターン同じ返事を返しても気付けん。
const laterTexts = ["歴史の棚はどこですか。", "その棚で一冊借りたいです。"];
for (const text of laterTexts) {
  const response = await post({
    conversationId: body.conversationId,
    requestId: crypto.randomUUID(),
    text,
  });
  assert.equal(response.status, 200);
  const stream = await response.text();
  // 落とされた塊は外へ配られんので、chunk が 1 個も無ければ全部落ちたと分かる。
  assert.ok(stream.includes("event: chunk"), `turn for "${text}" streamed no chunk`);
  assert.ok(stream.includes("event: done"), `turn for "${text}" did not finish`);
}
const multiTurn = await (
  await request(`${endpoint}/history?conversationId=${body.conversationId}`)
).json();
const totalTurns = 1 + laterTexts.length;
assert.equal(multiTurn.history.length, totalTurns * 2);
assert.deepEqual(
  multiTurn.history.map((row) => [row.turn, row.role]),
  Array.from({ length: totalTurns }, (_, index) => [
    [index + 1, "user"],
    [index + 1, "assistant"],
  ]).flat(),
);
assert.equal(multiTurn.turn, totalTurns + 1);
assert.deepEqual(
  multiTurn.history.filter((row) => row.role === "user").map((row) => row.content),
  [body.text, ...laterTexts],
);
const replies = multiTurn.history
  .filter((row) => row.role === "assistant")
  .map((row) => row.content);
assert.ok(replies.every((reply) => reply.trim().length > 0));
assert.equal(new Set(replies).size, replies.length);
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
    consecutiveTurns: totalTurns,
    durationMs: Math.round(performance.now() - started),
  }),
);
