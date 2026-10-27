import assert from "node:assert/strict";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const AUTHORIZATION = "Bearer synthetic-gateway-only";
const RESPONSE =
  "<response><action>合成データの確認を終える。</action><dialogue>ローカル試験用の返信です。</dialogue><inner>試験の続行を確認する。</inner></response>";
const ROUTES = new Map([
  ["synthetic/primary", "primary"],
  ["deepseek/deepseek-v4.1-flash-1017", "primary"],
  ["deepseek/deepseek-v4.1-flash", "fallback-1"],
  ["cognitivecomputations/dolphin-mistral-24b-venice-edition", "fallback-2"],
]);
const POLICY_KEYS = new Set([
  "ignore",
  "data_collection",
  "only",
  "order",
  "allow_fallbacks",
  "require_parameters",
]);

class MockRequestError extends Error {
  constructor(status, reason) {
    super(reason);
    this.status = status;
    this.reason = reason;
  }
}

const fail = (reason, status = 400) => {
  throw new MockRequestError(status, reason);
};
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function readJson(request) {
  return new Promise((resolve, reject) => {
    let bytes = 0;
    let chunks = [];
    let oversized = false;
    request.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        chunks = [];
        oversized = true;
        reject(new MockRequestError(413, "body-limit"));
      }
      if (!oversized) chunks.push(chunk);
    });
    request.once("end", () => {
      if (oversized) return;
      try {
        resolve(
          JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))),
        );
      } catch {
        reject(new MockRequestError(400, "invalid-json"));
      }
    });
    request.once("error", () => reject(new MockRequestError(400, "request-stream")));
    request.once("aborted", () => reject(new MockRequestError(400, "request-aborted")));
  });
}

function providerNames(value) {
  if (
    !Array.isArray(value) ||
    value.length > 32 ||
    value.some(
      (name) =>
        typeof name !== "string" ||
        name.length === 0 ||
        name !== name.trim() ||
        name.length > 200 ||
        !/^[\p{L}\p{N} _+./:()-]+$/u.test(name),
    )
  )
    fail("provider-policy");
  return value;
}

function providerPolicy(value, route) {
  if (!object(value) || Object.keys(value).some((key) => !POLICY_KEYS.has(key)))
    fail("provider-policy");
  const ignore = providerNames(value.ignore);
  if (!ignore.some((name) => name.toLowerCase() === "deepseek") || value.data_collection !== "deny")
    fail("provider-policy");
  const selected = [value.only, value.order]
    .filter((names) => names !== undefined)
    .flatMap(providerNames);
  if ([value.only, value.order].some((names) => Array.isArray(names) && names.length === 0))
    fail("provider-policy");
  if (selected.some((name) => /^deepseek(?:$|[\s(/:-])/i.test(name))) fail("provider-policy");
  if (
    [value.allow_fallbacks, value.require_parameters].some(
      (flag) => flag !== undefined && typeof flag !== "boolean",
    )
  )
    fail("provider-policy");
  if (
    route === "fallback-1" &&
    (!Array.isArray(value.only) ||
      value.only.length !== 1 ||
      value.only[0] !== "Venice" ||
      value.allow_fallbacks !== false)
  )
    fail("fallback-policy");
  return Object.freeze(
    Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        Array.isArray(entry) ? Object.freeze([...entry]) : entry,
      ]),
    ),
  );
}

function requestData(value) {
  if (!object(value) || !ROUTES.has(value.model)) fail("model");
  if (typeof value.stream !== "boolean") fail("stream-mode");
  return {
    model: value.model,
    stream: value.stream,
    provider: providerPolicy(value.provider, ROUTES.get(value.model)),
  };
}

function completion(model) {
  return {
    id: "synthetic-completion",
    created: 0,
    model,
    provider: ROUTES.get(model) === "fallback-1" ? "Venice" : "Synthetic",
  };
}

const usage = { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 };
const event = (base, content, finish = null) =>
  `data: ${JSON.stringify({
    ...base,
    object: "chat.completion.chunk",
    choices: [{ index: 0, delta: content === undefined ? {} : { content }, finish_reason: finish }],
    ...(finish ? { usage } : {}),
  })}\n\n`;

async function reply(response, data, failPrimary) {
  if (failPrimary && data.model === "synthetic/primary") {
    await delay(25);
    response.writeHead(503, { "content-type": "application/json" });
    response.end(
      JSON.stringify({ error: { code: 503, message: "synthetic-primary-unavailable" } }),
    );
    return;
  }
  const base = completion(data.model);
  if (!data.stream) {
    await delay(25);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        ...base,
        object: "chat.completion",
        usage,
        choices: [
          { index: 0, message: { role: "assistant", content: RESPONSE }, finish_reason: "stop" },
        ],
      }),
    );
    return;
  }
  response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" });
  const middle = Math.floor(RESPONSE.length / 2);
  response.write(event(base, RESPONSE.slice(0, middle)));
  await delay(25);
  response.write(event(base, RESPONSE.slice(middle)));
  response.write(event(base, undefined, "stop"));
  response.end("data: [DONE]\n\n");
}

export async function openMockGateway({ failPrimary = false } = {}) {
  assert.equal(typeof failPrimary, "boolean");
  const records = [];
  const unexpected = new Set();
  const server = createServer((request, response) => {
    void (async () => {
      try {
        if (request.method !== "POST" || request.url !== "/chat/completions")
          fail("method-or-path", 404);
        const authValid = request.headers.authorization === AUTHORIZATION;
        if (!authValid) {
          records.push(Object.freeze({ model: null, provider: null, authValid }));
          fail("authorization", 401);
        }
        const data = requestData(await readJson(request));
        records.push(Object.freeze({ model: data.model, provider: data.provider, authValid }));
        await reply(response, data, failPrimary);
      } catch (error) {
        const status = error instanceof MockRequestError ? error.status : 500;
        const reason = error instanceof MockRequestError ? error.reason : "internal";
        unexpected.add(reason);
        request.resume();
        if (!response.destroyed && !response.writableEnded) {
          response.writeHead(status, { "content-type": "application/json" });
          response.end(
            JSON.stringify({ error: { code: status, message: "synthetic-request-rejected" } }),
          );
        }
      }
    })();
  });
  server.requestTimeout = 5000;
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  let closed;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    records,
    assertNoUnexpectedRequests: () =>
      assert.equal(
        unexpected.size,
        0,
        `Mock gateway received unexpected requests: ${[...unexpected].join(", ")}`,
      ),
    close: () => {
      closed ??= new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeIdleConnections();
      });
      return closed;
    },
  };
}
