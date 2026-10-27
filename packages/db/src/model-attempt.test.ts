import { describe, expect, it } from "vitest";

import {
  modelAttemptSchema,
  modelAttemptsSchema,
  modelCallSchema,
  modelCallsSchema,
} from "./model-attempt";

import type { ModelAttempt } from "./model-attempt";

const attempt: ModelAttempt = {
  route: "primary",
  requestedModel: "synthetic/model",
  model: null,
  provider: null,
  status: "ok",
  reason: null,
  latencyMs: 0,
  timeoutMs: 1000,
};

describe("model audit contract", () => {
  it("未観測の実 model/provider は null のまま保持し、最大3段・5callを許す", () => {
    const attempts = [
      { ...attempt, status: "failed", reason: "protocol" },
      { ...attempt, route: "fallback-1", status: "failed", reason: "timeout" },
      {
        ...attempt,
        route: "fallback-2",
        model: "synthetic/actual",
        provider: "Synthetic Provider",
      },
    ];
    const calls = [
      { purpose: "generate", attempts },
      { purpose: "extend", attempts: [attempt] },
      ...Array.from({ length: 3 }, () => ({ purpose: "regenerate", attempts: [attempt] })),
    ];
    expect(modelCallsSchema.parse(calls)).toEqual(calls);
    expect(Object.isFrozen(modelCallsSchema.parse(calls))).toBe(true);
    expect(modelAttemptSchema.parse(attempt).provider).toBeNull();
  });

  it.each([
    { ...attempt, route: "unknown" },
    { ...attempt, reason: "unknown" },
    { ...attempt, status: "unknown" },
    { ...attempt, requestedModel: "" },
    { ...attempt, requestedModel: "x".repeat(201) },
    { ...attempt, requestedModel: "synthetic\nmodel" },
    { ...attempt, provider: "Synthetic?token=fixture" },
    { ...attempt, model: "Synthetic\u0000Model" },
    { ...attempt, provider: " leading" },
    { ...attempt, latencyMs: -1 },
    { ...attempt, latencyMs: 0.5 },
    { ...attempt, latencyMs: Number.MAX_SAFE_INTEGER + 1 },
    { ...attempt, latencyMs: Infinity },
    { ...attempt, timeoutMs: 0 },
    { ...attempt, timeoutMs: Number.MAX_SAFE_INTEGER + 1 },
    { ...attempt, status: "failed", reason: null },
    { ...attempt, status: "ok", reason: "timeout" },
    { ...attempt, unexpected: "synthetic" },
  ])("壊れた試行・非label値・無限値・追加フィールドを拒否する (%#)", (candidate) => {
    expect(modelAttemptSchema.safeParse(candidate).success).toBe(false);
  });

  it("4試行・6call・不明purpose・callの追加フィールドを拒否する", () => {
    expect(modelAttemptsSchema.safeParse(Array.from({ length: 4 }, () => attempt)).success).toBe(
      false,
    );
    expect(
      modelCallsSchema.safeParse(
        Array.from({ length: 6 }, () => ({ purpose: "generate", attempts: [attempt] })),
      ).success,
    ).toBe(false);
    expect(modelCallSchema.safeParse({ purpose: "unknown", attempts: [attempt] }).success).toBe(
      false,
    );
    expect(
      modelCallSchema.safeParse({
        purpose: "generate",
        attempts: [attempt],
        unexpected: "synthetic",
      }).success,
    ).toBe(false);
  });

  it("safe integer の境界を保持する", () => {
    expect(
      modelAttemptSchema.safeParse({
        ...attempt,
        timeoutMs: Number.MAX_SAFE_INTEGER,
        latencyMs: Number.MAX_SAFE_INTEGER,
      }).success,
    ).toBe(true);
  });
});
