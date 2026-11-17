// RIT-66 FR-1/NFR-1: 記録の唯一の出口の契約を固定する。
import { describe, expect, expectTypeOf, it, vi } from "vitest";

import { describeError, logEvent, type LogEntry } from "./log";

describe("logEvent", () => {
  it("出力は JSON 1 行", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      logEvent({
        event: "chat_turn_failed",
        level: "error",
        reason: "generation_failed",
        jobId: "job-1",
        attempt: 1,
        terminal: false,
      });
      expect(error.mock.calls).toHaveLength(1);
      const line = error.mock.calls[0]?.[0];
      expect(typeof line).toBe("string");
      expect(String(line)).not.toContain("\n");
      expect(JSON.parse(String(line))).toEqual({
        event: "chat_turn_failed",
        level: "error",
        reason: "generation_failed",
        jobId: "job-1",
        attempt: 1,
        terminal: false,
      });
    } finally {
      error.mockRestore();
    }
  });

  it.each([
    ["error", "error"],
    ["warn", "warn"],
    ["info", "info"],
  ] as const)("level %s は console.%s を使う", (level, method) => {
    const spy = vi.spyOn(console, method).mockImplementation(() => {});
    try {
      logEvent({ event: "failure_drill", level });
      expect(spy).toHaveBeenCalledOnce();
      expect(JSON.parse(String(spy.mock.calls[0]?.[0])).level).toBe(level);
    } finally {
      spy.mockRestore();
    }
  });

  it("JSON 化が失敗した時は出来事名だけを出す", () => {
    // 平らな型なので通常は起きんが、壊れた入力が来ても event だけは残る作りを固定する。
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const weird = { event: "worker_request_failed", level: "error" } as LogEntry;
      Reflect.set(weird, "self", weird);
      logEvent(weird);
      expect(error.mock.calls).toHaveLength(1);
      expect(JSON.parse(String(error.mock.calls[0]?.[0]))).toEqual({
        event: "worker_request_failed",
      });
    } finally {
      error.mockRestore();
    }
  });
});

describe("describeError", () => {
  it("例外の message は読まずクラス名だけを返す", () => {
    expect(describeError(new Error("CANARY-秘密の本文"))).toBe("unexpected:Error");
    expect(describeError(new Error("CANARY-秘密の本文"))).not.toContain("CANARY");
    expect(describeError(new TypeError("x"))).toBe("unexpected:TypeError");
  });

  it("Error でない物は typeof を返す", () => {
    expect(describeError("文字列")).toBe("unexpected:string");
    expect(describeError(42)).toBe("unexpected:number");
    expect(describeError(undefined)).toBe("unexpected:undefined");
  });
});

describe("LogEntry の型", () => {
  it("決めた項目以外は型で通らん", () => {
    expectTypeOf<keyof LogEntry>().toEqualTypeOf<
      | "event"
      | "level"
      | "reason"
      | "status"
      | "method"
      | "route"
      | "attempt"
      | "terminal"
      | "count"
      | "durationMs"
      | "jobId"
      | "documentId"
      | "generationId"
      | "conversationId"
      | "usage"
    >();
    // 会話本文・例外本文・要求 URL・キャラ id は NFR-1 の許可リストに無い。
    expectTypeOf<LogEntry>().not.toHaveProperty("message");
    expectTypeOf<LogEntry>().not.toHaveProperty("characterId");
    expectTypeOf<LogEntry>().not.toHaveProperty("url");
  });
});
