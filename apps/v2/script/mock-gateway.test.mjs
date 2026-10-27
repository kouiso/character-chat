import assert from "node:assert/strict";
import { test } from "node:test";

import { openMockGateway } from "./mock-gateway.mjs";

const AUTHORIZATION = "Bearer synthetic-gateway-only";
const policy = { ignore: ["DeepSeek"], data_collection: "deny" };
const fallbackModel = "deepseek/deepseek-v4.1-flash";
const fallbackPolicy = { ...policy, only: ["Venice"], allow_fallbacks: false };
const input = (extra = {}) => ({
  model: "synthetic/primary",
  provider: policy,
  messages: [{ role: "user", content: "synthetic-body-not-recorded" }],
  stream: true,
  ...extra,
});
const post = (gateway, body, authorization = AUTHORIZATION, path = "/chat/completions") =>
  fetch(`${gateway.baseUrl}${path}`, {
    method: "POST",
    headers: { authorization, "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
const open = async (context, options) => {
  const gateway = await openMockGateway(options);
  context.after(() => gateway.close());
  return gateway;
};

test("loopback SSEは2delta・finish stop・DONEと観測metadata/usageを返す", async (context) => {
  const gateway = await open(context);
  assert.match(gateway.baseUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
  const response = await post(gateway, input());
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/event-stream/);
  const events = (await response.text())
    .trim()
    .split("\n\n")
    .map((entry) => entry.slice(6));
  assert.equal(events.at(-1), "[DONE]");
  const chunks = events.slice(0, -1).map((value) => JSON.parse(value));
  assert.equal(chunks.length, 3);
  assert.equal(chunks[0].choices[0].finish_reason, null);
  assert.equal(chunks[1].choices[0].finish_reason, null);
  assert.equal(chunks[2].choices[0].finish_reason, "stop");
  assert.equal(chunks[2].usage.total_tokens, 3);
  assert.ok(
    chunks.every((chunk) => chunk.model === "synthetic/primary" && chunk.provider === "Synthetic"),
  );
  const text = chunks.map((chunk) => chunk.choices[0].delta.content ?? "").join("");
  assert.match(text, /^<response><action>/);
  assert.match(text, /<dialogue>ローカル試験用の返信です。<\/dialogue>/);
  assert.match(text, /<inner>.+<\/inner><\/response>$/);
  assert.deepEqual(gateway.records, [
    { model: "synthetic/primary", provider: policy, authValid: true },
  ]);
  assert.ok(!JSON.stringify(gateway.records).includes("synthetic-body-not-recorded"));
  assert.ok(!JSON.stringify(gateway.records).includes("synthetic-gateway-only"));
  gateway.assertNoUnexpectedRequests();
});

test("primary503は想定内で、fallback1はVeniceのJSON completionを返す", async (context) => {
  const gateway = await open(context, { failPrimary: true });
  const failed = await post(gateway, input());
  assert.equal(failed.status, 503);
  await failed.text();
  const success = await post(
    gateway,
    input({ model: fallbackModel, provider: fallbackPolicy, stream: false }),
  );
  assert.equal(success.status, 200);
  const completion = await success.json();
  assert.equal(completion.provider, "Venice");
  assert.equal(completion.model, fallbackModel);
  assert.equal(completion.choices[0].finish_reason, "stop");
  assert.match(completion.choices[0].message.content, /ローカル試験用の返信です。/);
  assert.equal(completion.usage.total_tokens, 3);
  assert.equal(gateway.records.length, 2);
  gateway.assertNoUnexpectedRequests();
});

test("並行SSEを受け付けfallback2も同じ合成protocolで完了する", async (context) => {
  const gateway = await open(context);
  const responses = await Promise.all([
    post(gateway, input()),
    post(gateway, input({ model: "cognitivecomputations/dolphin-mistral-24b-venice-edition" })),
  ]);
  const bodies = await Promise.all(responses.map((response) => response.text()));
  assert.ok(responses.every((response) => response.status === 200));
  assert.ok(bodies.every((body) => body.endsWith("data: [DONE]\n\n")));
  assert.equal(gateway.records.length, 2);
  gateway.assertNoUnexpectedRequests();
});

test("不正認証は値を記録せずbooleanだけ残し、unexpected検査を失敗させる", async (context) => {
  const gateway = await open(context);
  const response = await post(gateway, input(), "Bearer synthetic-wrong-value");
  assert.equal(response.status, 401);
  assert.ok(!(await response.text()).includes("synthetic-wrong-value"));
  assert.deepEqual(gateway.records, [{ model: null, provider: null, authValid: false }]);
  assert.throws(() => gateway.assertNoUnexpectedRequests(), /authorization/);
});

test("本家除外・data deny・fallback1Venice固定を検証する", async (context) => {
  const gateway = await open(context);
  for (const body of [
    input({ provider: { ignore: [], data_collection: "deny" } }),
    input({ provider: { ignore: ["DeepSeek"], data_collection: "allow" } }),
    input({ provider: { ...policy, only: ["DeepSeek/fixture"] } }),
    input({ model: fallbackModel, provider: policy }),
    input({ model: fallbackModel, provider: { ...fallbackPolicy, allow_fallbacks: true } }),
  ]) {
    const response = await post(gateway, body);
    assert.equal(response.status, 400);
    await response.text();
  }
  assert.deepEqual(gateway.records, []);
  assert.throws(() => gateway.assertNoUnexpectedRequests(), /provider-policy/);
});

test("endpoint・未知model・不正JSONを固定応答で拒否する", async (context) => {
  const gateway = await open(context);
  const endpoint = await post(gateway, input(), AUTHORIZATION, "/unknown");
  assert.equal(endpoint.status, 404);
  await endpoint.text();
  const model = await post(gateway, input({ model: "synthetic/unknown" }));
  assert.equal(model.status, 400);
  await model.text();
  const json = await post(gateway, "{synthetic-broken-json");
  assert.equal(json.status, 400);
  assert.ok(!(await json.text()).includes("synthetic-broken-json"));
  assert.deepEqual(gateway.records, []);
  assert.throws(() => gateway.assertNoUnexpectedRequests());
});

test("JSONは2MiB境界だけ許し、超過本文を保存せず413で拒否する", async (context) => {
  const gateway = await open(context);
  const base = { ...input({ stream: false }), padding: "" };
  const remaining = 2 * 1024 * 1024 - Buffer.byteLength(JSON.stringify(base));
  const exact = await post(gateway, { ...base, padding: "x".repeat(remaining) });
  assert.equal(exact.status, 200);
  await exact.text();
  const excessive = await post(gateway, { ...base, padding: "x".repeat(remaining + 1) });
  assert.equal(excessive.status, 413);
  await excessive.text();
  assert.equal(gateway.records.length, 1);
  assert.ok(!("padding" in gateway.records[0]));
  assert.throws(() => gateway.assertNoUnexpectedRequests(), /body-limit/);
});

test("closeを繰り返しても安全で、閉じたserverは受付しない", async (context) => {
  const gateway = await open(context);
  await Promise.all([gateway.close(), gateway.close()]);
  await assert.rejects(post(gateway, input()));
});
