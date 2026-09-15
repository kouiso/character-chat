import { describe, expect, it } from "vitest";

import { app } from "../[[route]]";

const AUTH_TOKEN = "test-token";
const MESSAGE_ID = "message-1";
const MESSAGE_ROW = {
  id: MESSAGE_ID,
  conversationId: "conversation-1",
  characterId: "character-1",
  content: "assistant message",
  createdAt: 1234,
};

type MockRow = Record<string, unknown>;
type CapturedBind = { sql: string; args: unknown[] };

const makeD1Mock = () => {
  const capturedBinds: CapturedBind[] = [];
  let messageSelectIndex = 0;

  const rowsForSql = (sql: string): MockRow[] => {
    if (sql.includes('from "message"')) {
      const rows =
        messageSelectIndex === 0 ? [MESSAGE_ROW] : [{ content: "previous user message" }];
      messageSelectIndex += 1;
      return rows;
    }
    return [];
  };

  return {
    capturedBinds,
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => {
        capturedBinds.push({ sql, args });
        const queryRows = rowsForSql(sql);
        return {
          run: () => Promise.resolve({ success: true, meta: {}, results: [] }),
          all: () => Promise.resolve({ results: queryRows, success: true }),
          first: () => Promise.resolve(queryRows[0] ?? null),
          raw: <T = unknown[]>() =>
            Promise.resolve(queryRows.map((row) => Object.values(row)) as T[]),
        };
      },
    }),
    dump: () => Promise.resolve(new ArrayBuffer(0)),
    batch: () => Promise.resolve([]),
    exec: () => Promise.resolve({ count: 0, duration: 0 }),
  };
};

const submitFeedback = async (body: unknown) => {
  const db = makeD1Mock();
  const response = await app.request(
    `/api/messages/${MESSAGE_ID}/feedback`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${AUTH_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
    { AUTH_TOKEN, DB: db },
  );
  return { db, response };
};

const insertedReason = (capturedBinds: CapturedBind[]) => {
  const insert = capturedBinds.find(({ sql }) => sql.includes('insert into "message_feedback"'));
  expect(insert).toBeDefined();
  expect(insert?.args[0]).toBe(MESSAGE_ID);
  expect(insert?.args[2]).toBe("conversation-1");
  expect(insert?.args[3]).toBe("character-1");
  return insert?.args[5];
};

describe("POST /api/messages/:messageId/feedback", () => {
  it("persists a preset bad-rating reason exactly", async () => {
    const { db, response } = await submitFeedback({ rating: "bad", reason: "too_short" });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(insertedReason(db.capturedBinds)).toBe("too_short");
  });

  it("trims and truncates a long free-text bad-rating reason to 500 chars", async () => {
    const reasonBody = "x".repeat(600);
    const { db, response } = await submitFeedback({ rating: "bad", reason: `  ${reasonBody}  ` });

    expect(response.status).toBe(200);
    expect(insertedReason(db.capturedBinds)).toBe("x".repeat(500));
  });

  it("stores null for a bad-rating submission without a reason", async () => {
    const { db, response } = await submitFeedback({ rating: "bad" });

    expect(response.status).toBe(200);
    expect(insertedReason(db.capturedBinds)).toBeNull();
  });

  it("stores null for a good-rating submission even when a reason is sent", async () => {
    const { db, response } = await submitFeedback({ rating: "good", reason: "too_short" });

    expect(response.status).toBe(200);
    expect(insertedReason(db.capturedBinds)).toBeNull();
  });
});
