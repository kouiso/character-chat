import { describe, expect, it } from "vitest";

import { app } from "../[[route]]";

type ConversationFixture = {
  id: string;
  userId: string;
};

const makeD1Mock = (conversations: ConversationFixture[]) => ({
  prepare: (sql: string) => ({
    bind: (...binds: unknown[]) => {
      const rows = (): unknown[][] => {
        if (sql.includes('from "user"')) return [["sukererion@gmail.com"]];
        if (sql.includes('from "conversation"')) {
          const [conversationId, userId] = binds;
          return conversations
            .filter((row) => row.id === conversationId && row.userId === userId)
            .map((row) => [row.id]);
        }
        return [];
      };

      return {
        run: () => Promise.resolve({ success: true, meta: {} }),
        raw: <T = unknown[]>() => Promise.resolve(rows() as T[]),
        values: <T = unknown[]>() => Promise.resolve(rows() as T[]),
        all: <T = unknown>() => Promise.resolve({ results: [] as T[], success: true }),
        first: <T = unknown>() => Promise.resolve((rows()[0]?.[0] ?? null) as T | null),
      };
    },
  }),
  dump: () => Promise.resolve(new ArrayBuffer(0)),
  batch: () => Promise.resolve([]),
  exec: () => Promise.resolve({ count: 0, duration: 0 }),
});

const requestMessages = (conversations: ConversationFixture[], conversationId: string) =>
  app.request(
    `/api/conversations/${conversationId}/messages`,
    { headers: { Authorization: "Bearer test-token" } },
    {
      AUTH_TOKEN: "test-token",
      DB: makeD1Mock(conversations),
      OPENROUTER_API_KEY: "",
      NOVITA_API_KEY: "",
    },
  );

describe("GET /api/conversations/:conversationId/messages ownership", () => {
  it("returns 404 when user A guesses user B's conversation id", async () => {
    const response = await requestMessages(
      [{ id: "conversation-b", userId: "user-b@example.com" }],
      "conversation-b",
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "conversation not found" });
  });

  it("returns messages only when the conversation belongs to the requester", async () => {
    const response = await requestMessages(
      [{ id: "conversation-a", userId: "sukererion@gmail.com" }],
      "conversation-a",
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ messages: [] });
  });
});
