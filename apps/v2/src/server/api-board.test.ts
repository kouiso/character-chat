// RIT-209 雑談広場 API の検証（インメモリ D1 フェイク）。
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = {
  posts: new Map<string, { user_id: string; body: string; created_at: number }>(),
};

const runStatement = (sql: string, binds: unknown[]) => {
  if (sql.startsWith("INSERT INTO v2_board_post")) {
    state.posts.set(String(binds[0]), {
      user_id: String(binds[1]),
      body: String(binds[2]),
      created_at: Number(binds[3]),
    });
    return;
  }
  if (sql.startsWith("DELETE FROM v2_board_post")) {
    state.posts.delete(String(binds[0]));
    return;
  }
  throw new Error(`unhandled run: ${sql}`);
};

const queryStatement = (sql: string, binds: unknown[]) => {
  if (sql.startsWith("SELECT id, user_id, body, created_at FROM v2_board_post")) {
    const hasBefore = sql.includes("WHERE created_at < ?");
    const rows = [...state.posts.entries()]
      .map(([id, row]) => ({ id, ...row }))
      .filter((row) => !hasBefore || row.created_at < Number(binds[0]))
      .sort((a, b) => b.created_at - a.created_at || b.id.localeCompare(a.id));
    const limit = Number(binds[hasBefore ? 1 : 0]);
    return rows.slice(0, limit);
  }
  if (sql.startsWith("SELECT user_id FROM v2_board_post")) {
    const row = state.posts.get(String(binds[0]));
    return row ? { user_id: row.user_id } : null;
  }
  throw new Error(`unhandled query: ${sql}`);
};

vi.mock("./platform", () => ({
  getPlatform: async () => ({
    env: {
      DB: {
        prepare: (sql: string) => ({
          bind: (...binds: unknown[]) => ({
            run: async () => {
              runStatement(sql, binds);
              return {};
            },
            first: async () => {
              const result = queryStatement(sql, binds);
              return Array.isArray(result) ? (result[0] ?? null) : result;
            },
            all: async () => ({ results: queryStatement(sql, binds) }),
          }),
        }),
      },
    },
  }),
}));

const { handleBoardDelete, handleBoardList, handleBoardPost } = await import("./api-board");
const { LOCAL_USER_ID } = await import("./identity");

const post = (body: unknown) =>
  new Request("https://example.com/api/board", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const list = (before?: string) =>
  handleBoardList(new Request(`https://example.com/api/board${before ? `?before=${before}` : ""}`));

interface Page {
  items: { id: string; body: string; mine: boolean; createdAt: number }[];
  nextCursor: string | null;
}

describe("雑談広場", () => {
  beforeEach(() => {
    state.posts.clear();
  });

  it("投稿して一覧に出る", async () => {
    const created = await handleBoardPost(post({ body: "はじめまして" }));
    expect(created.status).toBe(201);
    const res = await list();
    const page: Page = await res.json();
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ body: "はじめまして", mine: true });
    expect(page.nextCursor).toBeNull();
  });

  it("空・過長の投稿は 422", async () => {
    expect((await handleBoardPost(post({ body: "  " }))).status).toBe(422);
    expect((await handleBoardPost(post({ body: "x".repeat(501) }))).status).toBe(422);
  });

  it("本人の投稿だけ削除できる", async () => {
    const created = await handleBoardPost(post({ body: "消す" }));
    const { id }: { id: string } = await created.json();
    expect((await handleBoardDelete(id)).status).toBe(200);
    const page: Page = await (await list()).json();
    expect(page.items).toHaveLength(0);
    state.posts.set("other-post", { user_id: "other", body: "他人", created_at: 1 });
    expect((await handleBoardDelete("other-post")).status).toBe(404);
    expect((await handleBoardDelete("missing")).status).toBe(404);
  });

  it("ページング: nextCursor で次頁を取れる", async () => {
    for (let i = 0; i < 31; i += 1) {
      state.posts.set(`p${String(i).padStart(2, "0")}`, {
        user_id: LOCAL_USER_ID,
        body: `post-${i}`,
        created_at: 1000 + i,
      });
    }
    const first: Page = await (await list()).json();
    expect(first.items).toHaveLength(30);
    expect(first.nextCursor).not.toBeNull();
    const second: Page = await (await list(first.nextCursor ?? undefined)).json();
    expect(second.items).toHaveLength(1);
    expect(second.items[0].body).toBe("post-0");
    expect(second.nextCursor).toBeNull();
  });
});
