import { judgeChunk, extractVoice } from "@v2/judge";
import { describe, expect, it } from "vitest";

import { isChatSseEvent, parseChatSseEvent, parseSseEvent, type ChatSseEvent } from "./sse-events";

const chunk = {
  type: "chunk",
  seq: 0,
  text: "synthetic chunk",
  judge: judgeChunk("synthetic chunk", { previousChunks: [], voice: extractVoice("synthetic") }),
  attempt: 1,
  preExtend: false,
} satisfies ChatSseEvent;
const valid = {
  token: { type: "token", text: "synthetic token" },
  chunk,
  dropped: { type: "dropped", seq: 0, reasons: ["synthetic"], attempt: 1 },
  "turn-meta": {
    type: "turn-meta",
    extended: 0,
    truncated: null,
    model: "synthetic model",
    latencyMs: 1,
    mechanicsPhase: "conversation",
    preExtendVisibleChars: 10,
  },
  done: { type: "done", conversationId: "synthetic room", turn: 1, generationId: null },
  error: { type: "error", message: "synthetic failure" },
} satisfies { [Type in ChatSseEvent["type"]]: Extract<ChatSseEvent, { type: Type }> };

describe("公開SSEの実行時検証", () => {
  it("公開6種と既存terminal fieldを復元する", () => {
    for (const event of [...Object.values(valid), { ...valid.error, terminal: true }]) {
      expect(parseChatSseEvent(event)).toEqual(event);
      expect(isChatSseEvent(event)).toBe(true);
      expect(parseSseEvent(event.type, JSON.stringify(event))).toEqual(event);
    }
  });

  it("各イベントの必須fieldを省略できない", () => {
    for (const event of Object.values(valid)) {
      for (const field of Object.keys(event)) {
        const invalid = { ...event };
        Reflect.deleteProperty(invalid, field);
        expect(parseChatSseEvent(invalid), `${event.type}.${field}`).toBeNull();
      }
    }
  });

  it("ネストした判定の欠落・型違いも拒否する", () => {
    for (const name of Object.keys(chunk.judge.checks)) {
      const invalid = structuredClone(chunk);
      Reflect.deleteProperty(invalid.judge.checks, name);
      expect(parseChatSseEvent(invalid), name).toBeNull();
    }
    for (const invalid of [
      { ...chunk, judge: { ok: true, reasons: [] } },
      { ...chunk, seq: "0" },
      { ...chunk, seq: Number.NaN },
      { ...chunk, attempt: Number.POSITIVE_INFINITY },
      { ...valid.done, turn: "1" },
      { ...valid.error, terminal: "true" },
      { ...chunk, judge: { ...chunk.judge, reasons: ["unknown"] } },
      {
        ...chunk,
        judge: { ...chunk.judge, checks: { ...chunk.judge.checks, voice: { ok: "true" } } },
      },
    ])
      expect(parseChatSseEvent(invalid)).toBeNull();
  });

  it("未知・内部イベント・event名の偽装を配信しない", () => {
    for (const invalid of [null, [], {}, { type: "unknown" }, { type: "generation" }]) {
      expect(parseChatSseEvent(invalid)).toBeNull();
    }
    expect(parseSseEvent("token", JSON.stringify(valid.done))).toBeNull();
    expect(parseSseEvent("token", "{")).toBeNull();
    expect(parseSseEvent("token", "null")).toBeNull();
    expect(parseSseEvent("token", "[]")).toBeNull();
  });

  it("公開fieldだけを取り出し、内部情報は混ぜない", () => {
    expect(
      parseChatSseEvent({ ...valid.token, systemPrompt: "synthetic audit", request: [] }),
    ).toEqual(valid.token);
    expect(
      parseChatSseEvent({
        ...chunk,
        judge: {
          ...chunk.judge,
          systemPrompt: "synthetic audit",
          checks: {
            ...chunk.judge.checks,
            voice: { ...chunk.judge.checks.voice, request: [] },
          },
        },
      }),
    ).toEqual(chunk);
  });
});
