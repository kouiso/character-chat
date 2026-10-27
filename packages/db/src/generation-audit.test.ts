import { emptyLedger } from "@v2/prompt";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { openChunkD1 } from "./test/chunk-d1";
import { createD1TurnStore, TurnCommitConflictError } from "./turn-store";

import type { ModelCall } from "./model-attempt";
import type { LocalD1 } from "./test/local-d1";
import type { GenerationRecord, SaveTurnInput } from "./turn-store";

const calls: readonly ModelCall[] = [
  {
    purpose: "generate",
    attempts: [
      {
        route: "primary",
        requestedModel: "synthetic/primary",
        model: null,
        provider: null,
        status: "failed",
        reason: "protocol",
        latencyMs: 5,
        timeoutMs: 1000,
      },
      {
        route: "fallback-1",
        requestedModel: "synthetic/fallback",
        model: "synthetic/observed",
        provider: "Synthetic Provider",
        status: "ok",
        reason: null,
        latencyMs: 10,
        timeoutMs: 1000,
      },
    ],
  },
  {
    purpose: "extend",
    attempts: [
      {
        route: "primary",
        requestedModel: "synthetic/primary",
        model: null,
        provider: null,
        status: "ok",
        reason: null,
        latencyMs: 2,
        timeoutMs: 1000,
      },
    ],
  },
  {
    purpose: "regenerate",
    attempts: [
      {
        route: "primary",
        requestedModel: "synthetic/primary",
        model: null,
        provider: null,
        status: "ok",
        reason: null,
        latencyMs: 3,
        timeoutMs: 1000,
      },
    ],
  },
];

const generation = (id: string, modelCalls?: readonly ModelCall[]): GenerationRecord => ({
  generationId: id,
  model: "synthetic/fallback",
  promptVersion: "synthetic-version",
  systemPrompt: "synthetic-system",
  request: [{ role: "user", content: "synthetic-input" }],
  rawOutput: "synthetic-output",
  usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
  latencyMs: 17,
  status: "ok",
  modelCalls,
});

const turnInput = (conversationId: string, record: GenerationRecord): SaveTurnInput => ({
  conversationId,
  turn: 1,
  userText: "synthetic-input",
  events: [{ type: "generation", ...record }],
  ledger: emptyLedger(),
  commit: { expectedTurn: 1, writeId: record.generationId },
});

describe("generation model call audit persistence", () => {
  let local: LocalD1;
  const store = () =>
    createD1TurnStore(local.db, {
      userId: "synthetic",
      characterId: "rit-67-synthetic",
      promptVersion: "synthetic-version",
    });
  const id = () => `audit-${crypto.randomUUID()}`;

  beforeAll(async () => {
    local = await openChunkD1();
  });
  afterAll(async () => local?.dispose());

  const generationRow = (conversationId: string) =>
    local.d1
      .prepare("SELECT * FROM v2_generation WHERE conversation_id = ?")
      .bind(conversationId)
      .first<{
        id: string;
        model: string;
        system_prompt: string;
        request_json: string;
        raw_output: string;
        usage_json: string;
        latency_ms: number;
        status: string;
        error: null;
        created_at: number;
        model_attempts_json: string | null;
      }>();

  const snapshot = async (conversationId: string) => {
    const tables = [
      "v2_conversation",
      "v2_message",
      "v2_generation",
      "v2_ledger",
      "v2_turn_commit",
      "v2_turn_delivery",
    ];
    const statements = tables.map((table) =>
      local.d1
        .prepare(
          `SELECT * FROM ${table} WHERE ${table === "v2_conversation" ? "id" : "conversation_id"} = ?`,
        )
        .bind(conversationId),
    );
    statements.push(
      local.d1
        .prepare(
          "SELECT * FROM v2_chunk WHERE message_id IN (SELECT id FROM v2_message WHERE conversation_id = ?)",
        )
        .bind(conversationId),
    );
    statements.push(
      local.d1
        .prepare(
          "SELECT * FROM v2_chunk_rejection WHERE message_id IN (SELECT id FROM v2_message WHERE conversation_id = ?)",
        )
        .bind(conversationId),
    );
    return (await local.d1.batch(statements)).map((rows) => rows.results);
  };

  it("初回・extend・regenerateの各試行を成功した世代と同じtransactionへ保存する", async () => {
    const conversationId = id();
    const record = generation(id(), calls);
    const receipt = await store().saveTurn(turnInput(conversationId, record));
    expect(receipt?.generationId).toBe(record.generationId);
    const row = await generationRow(conversationId);
    expect(row).toMatchObject({
      id: record.generationId,
      model: record.model,
      system_prompt: record.systemPrompt,
      request_json: JSON.stringify(record.request),
      raw_output: record.rawOutput,
      usage_json: JSON.stringify(record.usage),
      latency_ms: record.latencyMs,
      status: "ok",
      error: null,
      created_at: expect.any(Number),
    });
    expect(JSON.parse(row?.model_attempts_json ?? "null")).toEqual(calls);
  });

  it("監査を持たない従来のgenerationはNULLで保存できる", async () => {
    const conversationId = id();
    await store().saveTurn(turnInput(conversationId, generation(id())));
    expect((await generationRow(conversationId))?.model_attempts_json).toBeNull();
  });

  it("同じ監査の再送では8表のID・時刻・nonceも保持し、キー順だけの違いを許す", async () => {
    const conversationId = id();
    const record = generation(id(), calls);
    await store().saveTurn(turnInput(conversationId, record));
    const before = await snapshot(conversationId);
    const reordered = calls.map((call) => ({
      attempts: call.attempts.map((attempt) => ({
        timeoutMs: attempt.timeoutMs,
        latencyMs: attempt.latencyMs,
        reason: attempt.reason,
        status: attempt.status,
        provider: attempt.provider,
        model: attempt.model,
        requestedModel: attempt.requestedModel,
        route: attempt.route,
      })),
      purpose: call.purpose,
    }));
    await store().saveTurn(turnInput(conversationId, { ...record, modelCalls: reordered }));
    expect(await snapshot(conversationId)).toEqual(before);
  });

  it("同じcommitの監査だけを変更してもconflictになり、既存8表を保持する", async () => {
    const conversationId = id();
    const record = generation(id(), calls);
    await store().saveTurn(turnInput(conversationId, record));
    const before = await snapshot(conversationId);
    const changed = calls.map((call) => ({
      ...call,
      attempts: call.attempts.map((attempt) => ({ ...attempt, latencyMs: attempt.latencyMs + 1 })),
    }));
    await expect(
      store().saveTurn(turnInput(conversationId, { ...record, modelCalls: changed })),
    ).rejects.toBeInstanceOf(TurnCommitConflictError);
    expect(await snapshot(conversationId)).toEqual(before);
  });

  it("壊れた監査を直接渡しても固定エラーで拒否し、会話やcommitを残さない", async () => {
    const conversationId = id();
    const invalid = [
      {
        purpose: "generate",
        attempts: [{ ...calls[0].attempts[0], unexpected: "synthetic-private-field" }],
      },
    ] as unknown as readonly ModelCall[];
    const saving = store().saveTurn(turnInput(conversationId, generation(id(), invalid)));
    await expect(saving).rejects.toThrow("モデル試行の監査情報が不正です");
    expect((await snapshot(conversationId)).every((rows) => rows.length === 0)).toBe(true);
  });
});
