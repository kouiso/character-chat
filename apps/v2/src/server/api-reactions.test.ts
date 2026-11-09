// RIT-207 リアクション API の D1 フェイク検証。
import { beforeEach, describe, expect, it, vi } from "vitest";

interface FakeState {
  publish: Map<string, { user_id: string }>;
  likes: Map<string, { created_at: number }>;
  comments: Map<
    string,
    { character_id: string; user_id: string; body: string; created_at: number }
  >;
  follows: Map<string, { created_at: number }>;
}

const state: FakeState = {
  publish: new Map(),
  likes: new Map(),
  comments: new Map(),
  follows: new Map(),
};

const likeKey = (characterId: string, userId: string) => `${characterId}:${userId}`;
const followKey = (userId: string, kind: string, targetId: string) =>
  `${userId}:${kind}:${targetId}`;

const runStatement = (sql: string, binds: unknown[]) => {
  if (sql.startsWith("INSERT INTO v2_catalog_like")) {
    state.likes.set(likeKey(String(binds[0]), String(binds[1])), {
      created_at: Number(binds[2]),
    });
    return;
  }
  if (sql.startsWith("DELETE FROM v2_catalog_like")) {
    state.likes.delete(likeKey(String(binds[0]), String(binds[1])));
    return;
  }
  if (sql.startsWith("INSERT INTO v2_follow")) {
    state.follows.set(followKey(String(binds[0]), String(binds[1]), String(binds[2])), {
      created_at: Number(binds[3]),
    });
    return;
  }
  if (sql.startsWith("DELETE FROM v2_follow")) {
    state.follows.delete(followKey(String(binds[0]), String(binds[1]), String(binds[2])));
    return;
  }
  if (sql.startsWith("INSERT INTO v2_catalog_comment")) {
    state.comments.set(String(binds[0]), {
      character_id: String(binds[1]),
      user_id: String(binds[2]),
      body: String(binds[3]),
      created_at: Number(binds[4]),
    });
    return;
  }
  if (sql.startsWith("DELETE FROM v2_catalog_comment")) {
    state.comments.delete(String(binds[0]));
    return;
  }
  throw new Error(`unhandled run: ${sql}`);
};

// SQL 文字列ごとの応答を matcher 表で出し分ける（分岐を1関数に畳まないため）。
const queryMatchers: { test: (sql: string) => boolean; run: (binds: unknown[]) => unknown }[] = [
  {
    test: (sql) =>
      sql.includes("FROM v2_character_publish WHERE character_id = ?") &&
      !sql.includes("target_id"),
    run: (binds) => {
      const row = state.publish.get(String(binds[0]));
      return row ? { user_id: row.user_id } : null;
    },
  },
  {
    test: (sql) => sql.startsWith("SELECT COUNT(*) AS n FROM v2_catalog_like"),
    run: (binds) => ({
      n: [...state.likes.keys()].filter((key) => key.startsWith(`${String(binds[0])}:`)).length,
    }),
  },
  {
    test: (sql) => sql.startsWith("SELECT COUNT(*) AS n FROM v2_catalog_comment"),
    run: (binds) => ({
      n: [...state.comments.values()].filter((row) => row.character_id === String(binds[0])).length,
    }),
  },
  {
    test: (sql) => sql.startsWith("SELECT 1 AS x FROM v2_catalog_like"),
    run: (binds) =>
      state.likes.has(likeKey(String(binds[0]), String(binds[1]))) ? { x: 1 } : null,
  },
  {
    test: (sql) => sql.includes("FROM v2_follow WHERE user_id = ? AND kind = 'creator'"),
    run: (binds) => {
      const author = state.publish.get(String(binds[1]));
      return author && state.follows.has(followKey(String(binds[0]), "creator", author.user_id))
        ? { x: 1 }
        : null;
    },
  },
  {
    test: (sql) => sql.includes("kind = 'character'"),
    run: (binds) =>
      state.follows.has(followKey(String(binds[0]), "character", String(binds[1])))
        ? { x: 1 }
        : null,
  },
  {
    test: (sql) => sql.startsWith("SELECT 1 AS x FROM v2_follow"),
    run: (binds) =>
      state.follows.has(followKey(String(binds[0]), String(binds[1]), String(binds[2])))
        ? { x: 1 }
        : null,
  },
  {
    test: (sql) => sql.startsWith("SELECT kind, target_id FROM v2_follow"),
    run: (binds) =>
      [...state.follows.keys()]
        .filter((key) => key.startsWith(`${String(binds[0])}:`))
        .map((key) => {
          const [, kind, targetId] = key.split(":");
          return { kind, target_id: targetId };
        }),
  },
  {
    test: (sql) => sql.startsWith("SELECT id, user_id, body, created_at FROM v2_catalog_comment"),
    run: (binds) =>
      [...state.comments.entries()]
        .filter(([, row]) => row.character_id === String(binds[0]))
        .map(([id, row]) => ({ id, ...row })),
  },
  {
    test: (sql) => sql.startsWith("SELECT user_id FROM v2_catalog_comment"),
    run: (binds) => {
      const row = state.comments.get(String(binds[0]));
      return row && row.character_id === String(binds[1]) ? { user_id: row.user_id } : null;
    },
  },
];

const queryStatement = (sql: string, binds: unknown[]) => {
  const matcher = queryMatchers.find((entry) => entry.test(sql));
  if (!matcher) throw new Error(`unhandled query: ${sql}`);
  return matcher.run(binds);
};

const fakeDb = {
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
      all: async () => {
        const result = queryStatement(sql, binds);
        return { results: Array.isArray(result) ? result : result ? [result] : [] };
      },
    }),
    all: async () => ({ results: queryStatement(sql, []) }),
    first: async () => queryStatement(sql, []),
  }),
};

vi.mock("./platform", () => ({
  getPlatform: async () => ({ env: { DB: fakeDb } }),
}));

const {
  handleCommentCreate,
  handleCommentDelete,
  handleCommentList,
  handleFollowList,
  handleFollowToggle,
  handleLikeToggle,
  handleReactions,
} = await import("./api-reactions");

const publish = (characterId: string, userId: string) => {
  state.publish.set(characterId, { user_id: userId });
};

const post = (body: unknown) =>
  new Request("https://example.com", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("公開キャラへのリアクション", () => {
  beforeEach(() => {
    state.publish.clear();
    state.likes.clear();
    state.comments.clear();
    state.follows.clear();
    publish("char-1", "author-1");
  });

  it("いいねがトグルで付け外しでき件数が返る", async () => {
    const on = await handleLikeToggle("char-1");
    expect(on.status).toBe(200);
    const onBody: { liked: boolean; likeCount: number } = await on.json();
    expect(onBody).toEqual({ liked: true, likeCount: 1 });
    const off = await handleLikeToggle("char-1");
    const offBody: { liked: boolean; likeCount: number } = await off.json();
    expect(offBody).toEqual({ liked: false, likeCount: 0 });
  });

  it("非公開キャラにはいいねもコメントもフォローも404", async () => {
    expect((await handleLikeToggle("char-x")).status).toBe(404);
    expect((await handleCommentList("char-x")).status).toBe(404);
    expect((await handleFollowToggle("char-x", post({ kind: "character" }))).status).toBe(404);
    expect((await handleReactions("char-x")).status).toBe(404);
  });

  it("コメントの投稿・一覧・本人削除ができる", async () => {
    const created = await handleCommentCreate("char-1", post({ body: "すてき" }));
    expect(created.status).toBe(201);
    const { id }: { id: string } = await created.json();
    const list = await handleCommentList("char-1");
    const { items }: { items: { id: string; body: string; mine: boolean }[] } = await list.json();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id, body: "すてき", mine: true });
    const deleted = await handleCommentDelete("char-1", id);
    expect(deleted.status).toBe(200);
    const after = await handleCommentList("char-1");
    const empty: { items: unknown[] } = await after.json();
    expect(empty.items).toHaveLength(0);
  });

  it("空・過長コメントは422", async () => {
    expect((await handleCommentCreate("char-1", post({ body: "  " }))).status).toBe(422);
    expect((await handleCommentCreate("char-1", post({ body: "x".repeat(501) }))).status).toBe(422);
  });

  it("他人のコメントは削除できない", async () => {
    state.comments.set("c-other", {
      character_id: "char-1",
      user_id: "someone-else",
      body: "よそ者",
      created_at: 1,
    });
    expect((await handleCommentDelete("char-1", "c-other")).status).toBe(404);
  });

  it("キャラと作者をフォローでき一覧に出る", async () => {
    await handleFollowToggle("char-1", post({ kind: "character" }));
    await handleFollowToggle("char-1", post({ kind: "creator" }));
    const list = await handleFollowList();
    const { items }: { items: { kind: string; targetId: string }[] } = await list.json();
    expect(items).toContainEqual({ kind: "character", targetId: "char-1" });
    expect(items).toContainEqual({ kind: "creator", targetId: "author-1" });
    const reactions = await handleReactions("char-1");
    const body: { followedCharacter: boolean; followedCreator: boolean } = await reactions.json();
    expect(body).toMatchObject({ followedCharacter: true, followedCreator: true });
    await handleFollowToggle("char-1", post({ kind: "character" }));
    const after = await handleReactions("char-1");
    const afterBody: { followedCharacter: boolean } = await after.json();
    expect(afterBody.followedCharacter).toBe(false);
  });
});
