import { describe, expect, it } from "vitest";

import {
  buildGreetingMessageId,
  computeExpectedPersistedCount,
  countPersistedGreetings,
  runD1PersistenceJudge,
} from "./d1-persistence";

const CONVERSATION_ID = "conv-abc123";
const greetingRow = { id: buildGreetingMessageId(CONVERSATION_ID) };
const row = (id: string) => ({ id });

describe("countPersistedGreetings", () => {
  it("counts only the conversation's greeting row", () => {
    expect(
      countPersistedGreetings(CONVERSATION_ID, [greetingRow, row("m1"), { id: "greeting-other" }]),
    ).toBe(1);
  });

  it("returns 0 when no greeting row is persisted", () => {
    expect(countPersistedGreetings(CONVERSATION_ID, [row("m1"), row("m2")])).toBe(0);
  });
});

describe("computeExpectedPersistedCount", () => {
  it("adds the greeting back when it is persisted", () => {
    expect(
      computeExpectedPersistedCount({
        renderedMessageCount: 3,
        greetingMessageCount: 1,
        persistedGreetingCount: 1,
      }),
    ).toBe(3);
  });

  it("keeps the greeting subtracted when it is not persisted", () => {
    expect(
      computeExpectedPersistedCount({
        renderedMessageCount: 3,
        greetingMessageCount: 1,
        persistedGreetingCount: 0,
      }),
    ).toBe(2);
  });

  it("never credits more greetings than were rendered", () => {
    expect(
      computeExpectedPersistedCount({
        renderedMessageCount: 2,
        greetingMessageCount: 0,
        persistedGreetingCount: 1,
      }),
    ).toBe(2);
  });
});

describe("runD1PersistenceJudge", () => {
  it("passes on turn 1 when the greeting is persisted (user + assistant + greeting)", async () => {
    const verdict = await runD1PersistenceJudge({
      conversationId: CONVERSATION_ID,
      renderedMessageCount: 3,
      greetingMessageCount: 1,
      persistedCount: 3,
      persistedMessages: [greetingRow, row("u1"), row("a1")],
    });
    expect(verdict.pass).toBe(true);
    expect(verdict.reason).toContain("expectedPersistedCount 3");
  });

  it("passes when the greeting is rendered client-side only and never persisted", async () => {
    const verdict = await runD1PersistenceJudge({
      conversationId: CONVERSATION_ID,
      renderedMessageCount: 3,
      greetingMessageCount: 1,
      persistedCount: 2,
      persistedMessages: [row("u1"), row("a1")],
    });
    expect(verdict.pass).toBe(true);
    expect(verdict.reason).toContain("expectedPersistedCount 2");
  });

  it("still fails when a real assistant row is missing", async () => {
    const verdict = await runD1PersistenceJudge({
      conversationId: CONVERSATION_ID,
      renderedMessageCount: 3,
      greetingMessageCount: 1,
      persistedCount: 2,
      persistedMessages: [greetingRow, row("u1")],
    });
    expect(verdict.pass).toBe(false);
  });

  // 画像生成は PATCH /messages/:messageId/image で既存 assistant 行を UPDATE するだけ。
  // 行は増えんので、画像が付いても greeting + 2ターン = 5 行のまま。
  it("does not add a row for an image attached to an existing assistant reply", async () => {
    const verdict = await runD1PersistenceJudge({
      conversationId: CONVERSATION_ID,
      renderedMessageCount: 5,
      greetingMessageCount: 1,
      imageMessageCount: 1,
      persistedCount: 5,
      persistedMessages: [greetingRow, row("u1"), row("a1"), row("u2"), row("a2")],
    });
    expect(verdict.pass).toBe(true);
    expect(verdict.reason).toContain("expectedPersistedCount 5");
  });

  it("does not inflate the expectation as more images accumulate", async () => {
    const verdict = await runD1PersistenceJudge({
      conversationId: CONVERSATION_ID,
      renderedMessageCount: 5,
      greetingMessageCount: 1,
      imageMessageCount: 3,
      persistedCount: 5,
      persistedMessages: [greetingRow, row("u1"), row("a1"), row("u2"), row("a2")],
    });
    expect(verdict.pass).toBe(true);
    expect(verdict.reason).toContain("adds no row");
  });

  it("keeps the missing stream-done rescue wording available with a persisted greeting", async () => {
    const verdict = await runD1PersistenceJudge({
      conversationId: CONVERSATION_ID,
      renderedMessageCount: 5,
      greetingMessageCount: 1,
      imageMessageCount: 1,
      persistedCount: 5,
      persistedMessages: [greetingRow, row("u1"), row("a1"), row("u2"), row("a2")],
      uiReason: "stream done signal missing",
    });
    expect(verdict.pass).toBe(true);
    expect(verdict.reason).toContain("missing stream-done persist allowance");
  });
});
