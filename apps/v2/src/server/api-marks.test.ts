// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// RIT-204: メッセージへの印 API。冪等トグル・所有者確認・一覧 detail を見る。
// DB は最小のインメモリ D1 フェイク（SQL 文字列で出し分け）。
const state = vi.hoisted(() => ({
  marks: new Map<
    string,
    { message_id: string; conversation_id: string; kind: string; value: number; created_at: number }
  >(),
  conversations: new Map<string, string>(),
  messages: new Map<string, { conversation_id: string; turn: number; content: string }>(),
}));

vi.mock("./platform", () => ({
  getPlatform: vi.fn(async () => ({
    env: {
      DB: {
        prepare: (sql: string) => ({
          bind: (...args: unknown[]) => ({
            first: async () => {
              if (sql.includes("FROM v2_conversation")) {
                const userId = state.conversations.get(args[0] as string);
                return userId === undefined ? null : { user_id: userId };
              }
              if (sql.includes("SELECT 1 AS x FROM v2_message")) {
                const msg = state.messages.get(args[0] as string);
                return msg?.conversation_id === args[1] ? { x: 1 } : null;
              }
              if (sql.includes("substr(content")) {
                const msg = state.messages.get(args[0] as string);
                return msg ? { turn: msg.turn, excerpt: msg.content } : null;
              }
              if (sql.includes("FROM v2_message_mark")) {
                const row = state.marks.get(`${args[0]}|${args[1]}`);
                return row ? { value: row.value } : null;
              }
              return null;
            },
            all: async () => ({
              results: [...state.marks.values()]
                .filter((row) => row.conversation_id === args[0])
                .sort((a, b) => a.created_at - b.created_at)
                .map((row) => ({ message_id: row.message_id, kind: row.kind, value: row.value })),
            }),
            run: async () => {
              if (sql.startsWith("DELETE")) state.marks.delete(`${args[0]}|${args[1]}`);
              if (sql.startsWith("INSERT"))
                state.marks.set(`${args[0]}|${args[2]}`, {
                  message_id: args[0] as string,
                  conversation_id: args[1] as string,
                  kind: args[2] as string,
                  value: args[3] as number,
                  created_at: args[4] as number,
                });
              return { success: true };
            },
          }),
        }),
      },
    },
  })),
}));

const { handleMarkList, handleMarkToggle } = await import("./api-marks");

const CONV = "conv-1";

beforeEach(() => {
  state.marks.clear();
  state.conversations.clear();
  state.messages.clear();
  state.conversations.set(CONV, "local");
  state.messages.set("m1", { conversation_id: CONV, turn: 0, content: "こんにちは" });
});

const toggle = (body: object) =>
  handleMarkToggle(
    new Request("https://example.com/api/chat/c/marks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

const list = (query = "") =>
  handleMarkList(
    new Request(`https://example.com/api/chat/c/marks?conversationId=${CONV}${query}`),
  );

describe("api-marks", () => {
  it("ブックマークを付けて一覧に出る", async () => {
    const res = await toggle({ conversationId: CONV, messageId: "m1", kind: "bookmark" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      marks: [{ messageId: "m1", kind: "bookmark", value: 1 }],
    });
    const listed: { marks: unknown[] } = await (await list()).json();
    expect(listed.marks).toHaveLength(1);
  });

  it("同じ値の再押しで外れる（冪等トグル）", async () => {
    const put = { conversationId: CONV, messageId: "m1", kind: "feedback", value: 1 };
    await toggle(put);
    const second = await toggle(put);
    const body: { marks: unknown[] } = await second.json();
    expect(body.marks).toHaveLength(0);
  });

  it("feedback は値の張替が効く", async () => {
    await toggle({ conversationId: CONV, messageId: "m1", kind: "feedback", value: 1 });
    const res = await toggle({
      conversationId: CONV,
      messageId: "m1",
      kind: "feedback",
      value: -1,
    });
    const body: { marks: unknown[] } = await res.json();
    expect(body.marks).toEqual([{ messageId: "m1", kind: "feedback", value: -1 }]);
  });

  it("他人の会話・存在しないメッセージは 404", async () => {
    state.conversations.set("conv-other", "other-user");
    expect(
      (await toggle({ conversationId: "conv-other", messageId: "m1", kind: "bookmark" })).status,
    ).toBe(404);
    expect(
      (await toggle({ conversationId: CONV, messageId: "m-x", kind: "bookmark" })).status,
    ).toBe(404);
    expect(
      (
        await handleMarkList(
          new Request("https://example.com/api/chat/c/marks?conversationId=conv-other"),
        )
      ).status,
    ).toBe(404);
  });

  it("detail=bookmark でジャンプ用の抜粋が返る", async () => {
    await toggle({ conversationId: CONV, messageId: "m1", kind: "bookmark" });
    const body: { bookmarks: unknown[] } = await (await list("&detail=bookmark")).json();
    expect(body.bookmarks).toEqual([{ messageId: "m1", turn: 0, excerpt: "こんにちは" }]);
  });

  it("conversationId 未指定は 422、不正 body は 400", async () => {
    expect((await handleMarkList(new Request("https://example.com/api/chat/x/marks"))).status).toBe(
      422,
    );
    expect(
      (
        await handleMarkToggle(
          new Request("https://example.com/api/chat/c/marks", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{",
          }),
        )
      ).status,
    ).toBe(400);
  });
});
