// @vitest-environment node
import {
  createD1TurnStore,
  createModelAttemptRecorder,
  modelAttemptSchema,
  modelCallsSchema,
} from "@v2/db";
import { createTurnGraph, runTurn } from "@v2/engine";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { openChunkD1 } from "../../../../packages/db/src/test/chunk-d1";

import { createRuntimeModel } from "./model";
import { toSseStream } from "./sse";

import type { ModelAttemptScope } from "@v2/db";
import type { TurnEvent } from "@v2/engine";

const API_KEY = "synthetic-flow-no-real-key";
const INPUT = "合成利用者の入力・audit-private-input-marker";
const UPSTREAM_ERROR = "synthetic-upstream-private-error-marker";
const MODEL_BODY =
  "<response><action>机の上へ青い資料を置き、確認欄に小さな印を付ける。</action><dialogue>わたしは準備を終えました。次はあなたと結果を確かめます。</dialogue><inner>手順の続きは準備できている。</inner></response>";
const ENV = {
  OPENROUTER_API_KEY: API_KEY,
  V2_MODEL: "synthetic/primary",
  V2_OPENROUTER_BASE_URL: "https://synthetic-model-flow.invalid/v1",
  V2_MODEL_ATTEMPT_TIMEOUT_MS: "4000",
};
const ENDPOINT = `${ENV.V2_OPENROUTER_BASE_URL}/chat/completions`;
const CHARACTER = {
  id: "rit-67-synthetic",
  name: "Fixture",
  systemPrompt: "一人称: わたし\n二人称: あなた",
  greeting: "合成試験を始めます。",
};

type LocalD1 = Awaited<ReturnType<typeof openChunkD1>>;
type AuditRow = {
  id: string;
  user_id: string;
  character_id: string;
  conversation_id: string;
  run_id: string;
  call_index: number;
  attempt_index: number;
  attempt_json: string;
  created_at: number;
};
type GenerationRow = {
  model: string;
  status: string;
  raw_output: string;
  model_attempts_json: string | null;
};

const newScope = (): ModelAttemptScope => ({
  userId: "synthetic-flow-user",
  characterId: CHARACTER.id,
  conversationId: `model-flow-${crypto.randomUUID()}`,
  runId: `run-${crypto.randomUUID()}`,
});

const failedResponse = () =>
  Response.json({ error: { code: 500, message: UPSTREAM_ERROR } }, { status: 500 });

const successResponse = () => {
  const events = [
    {
      model: "synthetic/fallback-actual",
      provider: "Venice",
      choices: [
        {
          index: 0,
          delta: { role: "assistant", content: MODEL_BODY.slice(0, 40) },
          finish_reason: null,
        },
      ],
    },
    { choices: [{ index: 0, delta: { content: MODEL_BODY.slice(40) }, finish_reason: null }] },
    { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
    { choices: [], usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } },
  ];
  return new Response(
    events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n",
    { headers: { "content-type": "text/event-stream" } },
  );
};

const replaceAllFetch = (responses: (() => Response)[]) => {
  const requests: Record<string, unknown>[] = [];
  // 既存fetchへの委譲を持たず、予期しない宛先や追加呼出しもローカルで拒否する。
  const mock = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    if (String(url) !== ENDPOINT) throw new Error("unexpected synthetic model target");
    const response = responses[requests.length];
    if (!response) throw new Error("unexpected synthetic model attempt");
    requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return response();
  });
  return { mock, requests };
};

const auditRows = async (local: LocalD1, scope: ModelAttemptScope): Promise<AuditRow[]> =>
  (
    await local.d1
      .prepare(
        "SELECT * FROM v2_model_attempt_audit WHERE user_id = ? AND character_id = ? AND conversation_id = ? AND run_id = ? ORDER BY call_index, attempt_index",
      )
      .bind(scope.userId, scope.characterId, scope.conversationId, scope.runId)
      .all<AuditRow>()
  ).results;

const attemptsOf = (rows: AuditRow[]) =>
  rows.map((row) => modelAttemptSchema.parse(JSON.parse(row.attempt_json) as unknown));

const assertAuditHasNoBodyOrCredential = (rows: AuditRow[]): void => {
  const serialized = JSON.stringify(rows);
  for (const excluded of [
    API_KEY,
    INPUT,
    MODEL_BODY,
    "机の上へ青い資料",
    "わたしは準備を終えました",
    "手順の続きは準備できている",
    UPSTREAM_ERROR,
    "systemPrompt",
    "rawOutput",
    "request_json",
  ]) {
    expect(serialized).not.toContain(excluded);
  }
  for (const row of rows) {
    expect(Object.keys(row).sort()).toEqual(
      [
        "id",
        "user_id",
        "character_id",
        "conversation_id",
        "run_id",
        "call_index",
        "attempt_index",
        "attempt_json",
        "created_at",
      ].sort(),
    );
  }
};

const graphFor = (local: LocalD1, scope: ModelAttemptScope) => {
  const model = createRuntimeModel(ENV, { onAttempt: createModelAttemptRecorder(local.db, scope) });
  return createTurnGraph({
    model,
    store: createD1TurnStore(local.db, {
      userId: scope.userId,
      characterId: scope.characterId,
      promptVersion: "v0001",
    }),
    extendBelowRatio: 0,
  });
};

async function* captureEvents(source: AsyncGenerator<TurnEvent>, captured: TurnEvent[]) {
  for await (const event of source) {
    captured.push(event);
    yield event;
  }
}

describe("runtime model to synthetic D1 audit flow", () => {
  let local: LocalD1;

  beforeAll(async () => {
    local = await openChunkD1();
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => local?.dispose());

  it("persists failed and selected attempts before the real graph stores its generation", async () => {
    const scope = newScope();
    const { mock, requests } = replaceAllFetch([failedResponse, successResponse]);
    const captured: TurnEvent[] = [];
    const events = runTurn(
      graphFor(local, scope),
      { conversationId: scope.conversationId, userText: INPUT, character: CHARACTER },
      scope.conversationId,
    );
    const sse = await new Response(toSseStream(captureEvents(events, captured))).text();
    const rows = await auditRows(local, scope);
    const attempts = attemptsOf(rows);

    expect(mock).toHaveBeenCalledTimes(2);
    expect(mock.mock.calls.every(([url]) => String(url) === ENDPOINT)).toBe(true);
    expect(requests.map((request) => request.model)).toEqual([
      ENV.V2_MODEL,
      "deepseek/deepseek-v4.1-flash",
    ]);
    expect(requests[1].provider).toEqual({
      ignore: ["DeepSeek"],
      data_collection: "deny",
      only: ["Venice"],
      allow_fallbacks: false,
    });
    expect(rows.map((row) => [row.call_index, row.attempt_index])).toEqual([
      [0, 0],
      [0, 1],
    ]);
    expect(attempts).toEqual([
      expect.objectContaining({
        route: "primary",
        status: "failed",
        reason: "server-error",
        model: null,
        provider: null,
        timeoutMs: 4000,
      }),
      expect.objectContaining({
        route: "fallback-1",
        status: "ok",
        reason: null,
        model: "synthetic/fallback-actual",
        provider: "Venice",
        timeoutMs: 4000,
      }),
    ]);
    expect(attempts.every((attempt) => attempt.latencyMs >= 0)).toBe(true);
    assertAuditHasNoBodyOrCredential(rows);

    const generation = await local.d1
      .prepare(
        "SELECT model,status,raw_output,model_attempts_json FROM v2_generation WHERE conversation_id = ?",
      )
      .bind(scope.conversationId)
      .first<GenerationRow>();
    if (!generation?.model_attempts_json) throw new Error("synthetic generation audit missing");
    expect(generation.model).toBe("synthetic/fallback-actual");
    expect(generation.status).toBe("ok");
    expect(generation.raw_output).toBe(MODEL_BODY);
    expect(modelCallsSchema.parse(JSON.parse(generation.model_attempts_json) as unknown)).toEqual([
      { purpose: "generate", attempts },
    ]);
    expect(captured.some((event) => event.type === "done")).toBe(true);
    expect(captured.some((event) => event.type === "generation")).toBe(false);
    expect(sse).toContain("event: done");
    for (const excluded of [
      API_KEY,
      INPUT,
      UPSTREAM_ERROR,
      "fallbackAttempts",
      "modelCalls",
      "systemPrompt",
      "attempt_json",
    ])
      expect(sse).not.toContain(excluded);
  });

  it("retains three failure audits without creating a conversation or generation", async () => {
    const scope = newScope();
    const { mock, requests } = replaceAllFetch([failedResponse, failedResponse, failedResponse]);
    const captured: TurnEvent[] = [];
    const events = runTurn(
      graphFor(local, scope),
      { conversationId: scope.conversationId, userText: INPUT, character: CHARACTER },
      scope.conversationId,
    );
    const consume = async () => {
      for await (const event of events) captured.push(event);
    };
    await expect(consume()).rejects.toMatchObject({
      code: "exhausted",
      message: "モデルから返事を取得できませんでした",
    });
    expect(mock).toHaveBeenCalledTimes(3);
    expect(mock.mock.calls.every(([url]) => String(url) === ENDPOINT)).toBe(true);
    expect(requests.map((request) => request.model)).toEqual([
      ENV.V2_MODEL,
      "deepseek/deepseek-v4.1-flash",
      "cognitivecomputations/dolphin-mistral-24b-venice-edition",
    ]);
    const rows = await auditRows(local, scope);
    expect(rows.map((row) => [row.call_index, row.attempt_index])).toEqual([
      [0, 0],
      [0, 1],
      [0, 2],
    ]);
    const attempts = attemptsOf(rows);
    expect(attempts.map((attempt) => attempt.route)).toEqual([
      "primary",
      "fallback-1",
      "fallback-2",
    ]);
    for (const attempt of attempts)
      expect(attempt).toMatchObject({
        status: "failed",
        reason: "server-error",
        timeoutMs: 4000,
        model: null,
        provider: null,
      });
    assertAuditHasNoBodyOrCredential(rows);
    expect(
      await local.d1
        .prepare("SELECT COUNT(*) AS count FROM v2_generation WHERE conversation_id = ?")
        .bind(scope.conversationId)
        .first("count"),
    ).toBe(0);
    expect(
      await local.d1
        .prepare("SELECT COUNT(*) AS count FROM v2_conversation WHERE id = ?")
        .bind(scope.conversationId)
        .first("count"),
    ).toBe(0);
    expect(captured.some((event) => event.type === "generation" || event.type === "done")).toBe(
      false,
    );
  });
});
