import { describe, expect, it } from "vitest";

import { isChatSseEvent, parseChatSseEvent, parseSseEvent, type ChatSseEvent } from "./sse-events";

const validEvents = {
  token: { type: "token", text: "synthetic token" },
  chunk: {
    type: "chunk",
    seq: 0,
    text: "synthetic chunk",
    attempt: 1,
    preExtend: false,
    judge: {
      ok: true,
      reasons: [],
      warnings: [],
      checks: {
        ngram: { ok: true, ratio: 0, matchedPhrases: [], exactRepeat: false },
        nearDuplicate: {
          ok: true,
          matches: [{ sentence: "synthetic sentence", previous: "synthetic previous", jaccard: 0 }],
        },
        voice: { ok: true },
        format: { ok: true },
        empty: { ok: true },
      },
    },
  },
  dropped: { type: "dropped", seq: 0, reasons: ["synthetic reason"], attempt: 2 },
  "turn-meta": {
    type: "turn-meta",
    extended: 0,
    truncated: null,
    model: "synthetic model",
    latencyMs: 10,
    mechanicsPhase: "conversation",
    preExtendVisibleChars: 12,
  },
  done: { type: "done", conversationId: "synthetic room", turn: 1, generationId: null },
  error: { type: "error", message: "synthetic failure" },
  delivery: {
    type: "delivery",
    conversationId: "synthetic room",
    turn: 1,
    generationId: "synthetic generation",
    serverNow: 100,
    chunks: [{ seq: 0, text: "synthetic chunk", scheduledAt: 200 }],
  },
} satisfies Record<Exclude<ChatSseEvent["type"], "generation">, ChatSseEvent>;

const parse = (event: ChatSseEvent) => parseSseEvent(event.type, JSON.stringify(event));

describe("公開SSEイベントの境界", () => {
  it("7種類の公開イベントを既存の必須fieldsで復元する", () => {
    for (const event of Object.values(validEvents)) {
      expect(parse(event)).toEqual(event);
      expect(parseChatSseEvent(event)).toEqual(event);
      expect(isChatSseEvent(event)).toBe(true);
    }
  });

  it("既存のoptional fieldsと空のdeliveryも受け付ける", () => {
    const chunk: ChatSseEvent = {
      ...validEvents.chunk,
      scheduledAt: 200,
      judge: {
        ...validEvents.chunk.judge,
        checks: {
          ...validEvents.chunk.judge.checks,
          voice: {
            ok: false,
            forbiddenPronoun: "synthetic",
            forbiddenAddress: "synthetic",
            thirdPersonSelf: "synthetic",
            endingsMismatch: true,
          },
          format: { ok: false, reason: "synthetic reason" },
        },
      },
    };
    const error: ChatSseEvent = {
      ...validEvents.error,
      retryable: false,
      code: "generation_exhausted",
    };
    const delivery: ChatSseEvent = { ...validEvents.delivery, generationId: null, chunks: [] };
    for (const event of [chunk, error, delivery]) expect(parse(event)).toEqual(event);
  });

  it("各イベントの必須fieldが一つ欠けても受け付けない", () => {
    for (const event of Object.values(validEvents)) {
      for (const field of Object.keys(event).filter((name) => name !== "type")) {
        const payload = structuredClone(event);
        Reflect.deleteProperty(payload, field);
        expect(
          parseSseEvent(event.type, JSON.stringify(payload)),
          `${event.type}.${field}`,
        ).toBeNull();
      }
    }
  });

  it("判定結果の必須ネストを省略したchunkを受け付けない", () => {
    const paths = [
      ["ok"],
      ["reasons"],
      ["warnings"],
      ["checks"],
      ["checks", "ngram"],
      ["checks", "ngram", "ok"],
      ["checks", "ngram", "ratio"],
      ["checks", "ngram", "matchedPhrases"],
      ["checks", "ngram", "exactRepeat"],
      ["checks", "nearDuplicate"],
      ["checks", "nearDuplicate", "ok"],
      ["checks", "nearDuplicate", "matches"],
      ["checks", "nearDuplicate", "matches", "0", "sentence"],
      ["checks", "nearDuplicate", "matches", "0", "previous"],
      ["checks", "nearDuplicate", "matches", "0", "jaccard"],
      ["checks", "voice"],
      ["checks", "voice", "ok"],
      ["checks", "format"],
      ["checks", "format", "ok"],
      ["checks", "empty"],
      ["checks", "empty", "ok"],
    ];
    for (const path of paths) {
      const payload = structuredClone(validEvents.chunk);
      let parent: object = payload.judge;
      for (const part of path.slice(0, -1)) parent = Reflect.get(parent, part) as object;
      Reflect.deleteProperty(parent, path.at(-1) ?? "");
      expect(parseSseEvent("chunk", JSON.stringify(payload)), path.join(".")).toBeNull();
    }
  });

  it("必須fieldの型違いと不正な配列要素を受け付けない", () => {
    const invalid = [
      { ...validEvents.token, text: 7 },
      { ...validEvents.chunk, seq: "0" },
      { ...validEvents.chunk, attempt: false },
      { ...validEvents.chunk, preExtend: "false" },
      { ...validEvents.chunk, scheduledAt: "200" },
      { ...validEvents.chunk, judge: { ...validEvents.chunk.judge, reasons: ["unknown"] } },
      { ...validEvents.chunk, judge: { ...validEvents.chunk.judge, warnings: [9] } },
      { ...validEvents.dropped, reasons: [false] },
      { ...validEvents["turn-meta"], mechanicsPhase: "unknown" },
      { ...validEvents["turn-meta"], truncated: "unknown" },
      { ...validEvents.done, conversationId: 1 },
      { ...validEvents.done, generationId: 7 },
      { ...validEvents.done, turn: "1" },
      { ...validEvents.error, message: false },
      { ...validEvents.error, retryable: "false" },
      { ...validEvents.error, code: "unknown" },
      { ...validEvents.delivery, chunks: [{ seq: 0, text: "synthetic" }] },
      { ...validEvents.delivery, chunks: [{ seq: 0, text: 3, scheduledAt: 200 }] },
    ];
    for (const event of invalid)
      expect(parseSseEvent(event.type, JSON.stringify(event))).toBeNull();
  });

  it("ネストした判定結果の型違いも拒否する", () => {
    const checks = validEvents.chunk.judge.checks;
    const invalid = [
      { ...checks, ngram: { ...checks.ngram, matchedPhrases: [3] } },
      { ...checks, ngram: { ...checks.ngram, exactRepeat: "false" } },
      {
        ...checks,
        nearDuplicate: {
          ...checks.nearDuplicate,
          matches: [{ sentence: "synthetic", previous: "synthetic", jaccard: "0" }],
        },
      },
      { ...checks, voice: { ok: true, forbiddenPronoun: 3 } },
      { ...checks, voice: { ok: true, forbiddenAddress: false } },
      { ...checks, voice: { ok: true, thirdPersonSelf: 3 } },
      { ...checks, voice: { ok: true, endingsMismatch: "false" } },
      { ...checks, format: { ok: true, reason: 3 } },
      { ...checks, empty: { ok: "true" } },
    ];
    for (const value of invalid) {
      expect(
        parseChatSseEvent({
          ...validEvents.chunk,
          judge: { ...validEvents.chunk.judge, checks: value },
        }),
      ).toBeNull();
    }
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "有限でない数値を直接guardへ渡しても拒否する（%s）",
    (value) => {
      const invalid = [
        { ...validEvents.chunk, seq: value },
        { ...validEvents.chunk, attempt: value },
        { ...validEvents.chunk, scheduledAt: value },
        {
          ...validEvents.chunk,
          judge: {
            ...validEvents.chunk.judge,
            checks: {
              ...validEvents.chunk.judge.checks,
              ngram: { ...validEvents.chunk.judge.checks.ngram, ratio: value },
            },
          },
        },
        {
          ...validEvents.chunk,
          judge: {
            ...validEvents.chunk.judge,
            checks: {
              ...validEvents.chunk.judge.checks,
              nearDuplicate: {
                ok: true,
                matches: [{ sentence: "synthetic", previous: "synthetic", jaccard: value }],
              },
            },
          },
        },
        { ...validEvents.dropped, seq: value },
        { ...validEvents.dropped, attempt: value },
        { ...validEvents["turn-meta"], extended: value },
        { ...validEvents["turn-meta"], latencyMs: value },
        { ...validEvents["turn-meta"], preExtendVisibleChars: value },
        { ...validEvents.done, turn: value },
        { ...validEvents.delivery, turn: value },
        { ...validEvents.delivery, serverNow: value },
        { ...validEvents.delivery, chunks: [{ seq: value, text: "synthetic", scheduledAt: 200 }] },
        { ...validEvents.delivery, chunks: [{ seq: 0, text: "synthetic", scheduledAt: value }] },
      ];
      for (const event of invalid) {
        expect(isChatSseEvent(event)).toBe(false);
        expect(parseChatSseEvent(event)).toBeNull();
      }
    },
  );

  it("未知イベントとevent名を上書きするpayloadを受け付けない", () => {
    expect(parseSseEvent("unknown", '{"text":"synthetic"}')).toBeNull();
    expect(parseSseEvent("token", JSON.stringify(validEvents.done))).toBeNull();
    for (const value of [null, [], 1, "synthetic", true]) {
      expect(parseSseEvent("token", JSON.stringify(value))).toBeNull();
    }
    expect(parseSseEvent("token", "{broken")).toBeNull();
  });

  it("型として完備した内部generationも公開イベントとして受け付けない", () => {
    expect(
      parseSseEvent(
        "generation",
        JSON.stringify({
          generationId: "synthetic generation",
          model: "synthetic model",
          promptVersion: "synthetic version",
          systemPrompt: "synthetic private audit",
          request: [{ role: "user", content: "synthetic input" }],
          rawOutput: "synthetic output",
          usage: null,
          latencyMs: 1,
          status: "ok",
        }),
      ),
    ).toBeNull();
  });

  it("公開イベントへ余分な内部fieldを混ぜても返り値へ残さない", () => {
    expect(
      parseSseEvent(
        "token",
        JSON.stringify({
          text: "synthetic public",
          systemPrompt: "synthetic private audit",
          request: ["synthetic input"],
        }),
      ),
    ).toEqual({ type: "token", text: "synthetic public" });
    expect(
      parseChatSseEvent({
        ...validEvents.chunk,
        judge: { ...validEvents.chunk.judge, systemPrompt: "synthetic private audit" },
      }),
    ).toEqual(validEvents.chunk);
  });
});
