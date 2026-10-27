import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createModelAttemptRecorder, ModelAttemptAuditError } from "./model-attempt-recorder";
import { openChunkD1 } from "./test/chunk-d1";

import type { ModelAttempt } from "./model-attempt";
import type { ModelAttemptScope } from "./model-attempt-recorder";
import type { LocalD1 } from "./test/local-d1";

const attempt = (
  route: ModelAttempt["route"],
  status: ModelAttempt["status"] = "failed",
): ModelAttempt => ({
  route,
  requestedModel: `synthetic/${route}`,
  model: null,
  provider: null,
  status,
  reason: status === "failed" ? "server-error" : null,
  latencyMs: 2,
  timeoutMs: 1000,
});

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

describe("durable per-attempt model audit", () => {
  let local: LocalD1;
  const scope = (): ModelAttemptScope => ({
    userId: "synthetic-user",
    characterId: "synthetic-character",
    conversationId: `synthetic-${crypto.randomUUID()}`,
    runId: crypto.randomUUID(),
  });
  const rows = async (identity: ModelAttemptScope): Promise<AuditRow[]> =>
    (
      await local.d1
        .prepare(
          "SELECT * FROM v2_model_attempt_audit WHERE user_id = ? AND character_id = ? AND conversation_id = ? AND run_id = ? ORDER BY call_index,attempt_index",
        )
        .bind(identity.userId, identity.characterId, identity.conversationId, identity.runId)
        .all<AuditRow>()
    ).results;

  beforeAll(async () => {
    local = await openChunkD1();
  });
  afterAll(async () => local?.dispose());

  it("会話未作成で3段全て失敗しても、本文なしの3行を残す", async () => {
    const identity = scope();
    const record = createModelAttemptRecorder(local.db, identity);
    const attempts = [attempt("primary"), attempt("fallback-1"), attempt("fallback-2")];
    for (const value of attempts) await record(value);
    const saved = await rows(identity);
    expect(saved.map((row) => row.call_index)).toEqual([0, 0, 0]);
    expect(saved.map((row) => row.attempt_index)).toEqual([0, 1, 2]);
    expect(saved.map((row) => JSON.parse(row.attempt_json))).toEqual(attempts);
    expect(Object.keys(saved[0]).sort()).toEqual(
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
    expect(
      await local.d1
        .prepare("SELECT COUNT(*) AS count FROM v2_generation WHERE conversation_id = ?")
        .bind(identity.conversationId)
        .first("count"),
    ).toBe(0);
    expect(
      await local.d1
        .prepare("SELECT COUNT(*) AS count FROM v2_conversation WHERE id = ?")
        .bind(identity.conversationId)
        .first("count"),
    ).toBe(0);
  });

  it("同run同payloadの再構築再送は同じID・時刻を保持する", async () => {
    const identity = scope();
    const attempts = [attempt("primary"), attempt("fallback-1", "ok")];
    const first = createModelAttemptRecorder(local.db, identity);
    for (const value of attempts) await first(value);
    const before = await rows(identity);
    const replay = createModelAttemptRecorder(local.db, identity);
    for (const value of attempts) {
      const reordered = {
        timeoutMs: value.timeoutMs,
        latencyMs: value.latencyMs,
        reason: value.reason,
        status: value.status,
        provider: value.provider,
        model: value.model,
        requestedModel: value.requestedModel,
        route: value.route,
      };
      await replay(reordered);
    }
    expect(await rows(identity)).toEqual(before);
  });

  it("同scope・run・indexへの異payloadは既存行を変更せず固定エラーで拒否する", async () => {
    const identity = scope();
    const value = attempt("primary");
    await createModelAttemptRecorder(local.db, identity)(value);
    const before = await rows(identity);
    await expect(
      createModelAttemptRecorder(local.db, identity)({ ...value, latencyMs: 3 }),
    ).rejects.toBeInstanceOf(ModelAttemptAuditError);
    expect(await rows(identity)).toEqual(before);
  });

  it("factory時点のscopeを固定し、元オブジェクト変更に引きずられない", async () => {
    const identity = scope();
    const before = { ...identity };
    const record = createModelAttemptRecorder(local.db, identity);
    identity.userId = "changed-synthetic-user";
    identity.characterId = "changed-synthetic-character";
    identity.conversationId = "changed-synthetic-conversation";
    identity.runId = "changed-synthetic-run";
    await record(attempt("primary", "ok"));
    expect(await rows(before)).toHaveLength(1);
    expect(await rows(identity)).toHaveLength(0);
  });

  it("user・character・conversation・run各scopeが異なる試行を混ぜない", async () => {
    const identity = scope();
    const identities = [
      identity,
      { ...identity, userId: "other-user" },
      { ...identity, characterId: "other-character" },
      { ...identity, conversationId: "other-conversation" },
      { ...identity, runId: "other-run" },
    ];
    for (const one of identities)
      await createModelAttemptRecorder(local.db, one)(attempt("primary", "ok"));
    for (const one of identities) expect(await rows(one)).toHaveLength(1);
  });

  it("primaryで次callへ進み最大5callまでを保存する", async () => {
    const identity = scope();
    const record = createModelAttemptRecorder(local.db, identity);
    for (let index = 0; index < 5; index++) await record(attempt("primary", "ok"));
    await expect(record(attempt("primary", "ok"))).rejects.toBeInstanceOf(ModelAttemptAuditError);
    expect((await rows(identity)).map((row) => row.call_index)).toEqual([0, 1, 2, 3, 4]);
  });

  it("不正順序や成功後fallbackと不正metadataは追加行なしで拒否する", async () => {
    const identity = scope();
    const record = createModelAttemptRecorder(local.db, identity);
    await expect(record(attempt("fallback-1"))).rejects.toBeInstanceOf(ModelAttemptAuditError);
    await record(attempt("primary", "ok"));
    await expect(record(attempt("fallback-1"))).rejects.toBeInstanceOf(ModelAttemptAuditError);
    await expect(
      record({
        ...attempt("primary"),
        unexpected: "synthetic-private-value",
      } as unknown as ModelAttempt),
    ).rejects.toThrow("モデル試行の監査情報を保存できません");
    expect(await rows(identity)).toHaveLength(1);
  });
});
