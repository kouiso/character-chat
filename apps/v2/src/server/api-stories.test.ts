// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// RIT-214: ストーリー/章 CRUD と並び替え。所有者のみ・ord 詰め直しを見る。
const state = vi.hoisted(() => ({
  stories: new Map<string, Record<string, unknown>>(),
  chapters: new Map<string, Record<string, unknown>>(),
  characters: new Map<string, { user_id: string }>(),
}));

const firstMaxOrd = (storyId: unknown): { m: number | null } => {
  const list = [...state.chapters.values()].filter((c) => c.story_id === storyId);
  return { m: list.length ? Math.max(...list.map((c) => c.ord as number)) : null };
};

const firstChapterJoin = (args: unknown[]): { user_id: unknown } | null => {
  const ch = state.chapters.get(`${args[0]}`);
  if (!ch || ch.story_id !== args[1]) return null;
  return { user_id: state.stories.get(`${ch.story_id}`)?.user_id };
};

const firstRow = (sql: string, args: unknown[]): unknown => {
  if (sql.includes("FROM character")) return state.characters.get(`${args[0]}`) ?? null;
  if (sql.includes("FROM v2_story")) return state.stories.get(`${args[0]}`) ?? null;
  if (sql.includes("MAX(ord)")) return firstMaxOrd(args[0]);
  if (sql.includes("JOIN v2_story")) return firstChapterJoin(args);
  if (sql.includes("FROM v2_chapter")) return state.chapters.get(`${args[0]}`) ?? null;
  return null;
};

const allRows = (sql: string, args: unknown[]): { results: unknown[] } => {
  if (sql.includes("FROM v2_story s"))
    return {
      results: [...state.stories.values()].map((s) => ({
        ...s,
        characterName: null,
        chapterCount: [...state.chapters.values()].filter((c) => c.story_id === s.id).length,
      })),
    };
  if (sql.includes("FROM v2_chapter"))
    return {
      results: [...state.chapters.values()]
        .filter((c) => !sql.includes("story_id = ?") || c.story_id === args[0])
        .sort((a, b) => (a.ord as number) - (b.ord as number)),
    };
  return { results: [] };
};

const runInsert = (sql: string, args: unknown[]): void => {
  if (sql.includes("v2_story"))
    state.stories.set(`${args[0]}`, {
      id: args[0],
      user_id: args[1],
      character_id: args[2],
      title: args[3],
      worldview: args[4],
    });
  else
    state.chapters.set(`${args[0]}`, {
      id: args[0],
      story_id: args[1],
      ord: args[2],
      title: args[3],
      body: args[4],
      narration: args[5],
    });
};

const runUpdate = (sql: string, args: unknown[]): void => {
  if (sql.includes("v2_story"))
    Object.assign(state.stories.get(`${args[3]}`) ?? {}, {
      title: args[0],
      worldview: args[1],
    });
  else if (sql.includes("SET title"))
    Object.assign(state.chapters.get(`${args[4]}`) ?? {}, {
      title: args[0],
      body: args[1],
      narration: args[2],
    });
  else {
    const row = state.chapters.get(`${args[1]}`);
    if (row) row.ord = args[0];
  }
};

const runDelete = (sql: string, args: unknown[]): void => {
  if (sql.includes("v2_story")) state.stories.delete(`${args[0]}`);
  else if (sql.includes("WHERE story_id")) {
    for (const [k, v] of state.chapters) if (v.story_id === args[0]) state.chapters.delete(k);
  } else state.chapters.delete(`${args[0]}`);
};

const runWrite = (sql: string, args: unknown[]): void => {
  if (sql.includes("INSERT")) runInsert(sql, args);
  else if (sql.includes("UPDATE")) runUpdate(sql, args);
  else if (sql.includes("DELETE")) runDelete(sql, args);
};

vi.mock("./platform", () => ({
  getPlatform: vi.fn(async () => ({
    env: {
      DB: {
        prepare: (sql: string) => ({
          bind: (...args: unknown[]) => ({
            first: async () => firstRow(sql, args),
            all: async () => allRows(sql, args),
            run: async () => {
              runWrite(sql, args);
              return { success: true };
            },
          }),
        }),
      },
    },
  })),
}));

const {
  handleChapterDelete,
  handleChapterPost,
  handleChapterReorder,
  handleStoriesGet,
  handleStoriesPost,
  handleStoryDelete,
  handleStoryGet,
} = await import("./api-stories");

const post = (body: unknown): Request =>
  new Request("http://x/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const storyId = async (): Promise<string> => {
  const res = await handleStoriesPost(post({ characterId: "c1", title: "物語" }));
  const { id }: { id: string } = await res.json();
  return id;
};

const chapterId = async (sid: string, title = ""): Promise<string> => {
  const res = await handleChapterPost(sid, post({ title }));
  const { id }: { id: string } = await res.json();
  return id;
};

beforeEach(() => {
  state.stories.clear();
  state.chapters.clear();
  state.characters.set("c1", { user_id: "local" });
  state.characters.set("other", { user_id: "someone" });
});

describe("api-stories", () => {
  it("作成→一覧→詳細の一連", async () => {
    const id = await storyId();
    const list: { id: string }[] = await (await handleStoriesGet()).json();
    expect(list.map((s) => s.id)).toContain(id);
    const detail: { title: string; chapters: unknown[] } = await (await handleStoryGet(id)).json();
    expect(detail.title).toBe("物語");
    expect(detail.chapters).toEqual([]);
  });

  it("他人キャラへの作成は404、未所有ストーリーも404", async () => {
    expect((await handleStoriesPost(post({ characterId: "other", title: "x" }))).status).toBe(404);
    expect((await handleStoriesPost(post({}))).status).toBe(400);
    expect((await handleStoryGet("missing")).status).toBe(404);
  });

  it("章は末尾 ord に追加され、削除で ord が詰め直される", async () => {
    const id = await storyId();
    const a = await chapterId(id, "一");
    const b = await chapterId(id, "二");
    await chapterId(id, "三");
    expect(state.chapters.get(a)?.ord).toBe(0);
    await handleChapterDelete(id, a);
    const detail: { chapters: { id: string; ord: number }[] } = await (
      await handleStoryGet(id)
    ).json();
    expect(detail.chapters.map((c) => c.ord)).toEqual([0, 1]);
    expect(detail.chapters[0].id).toBe(b);
  });

  it("reorder は ids 順に ord を振り直し、集合不一致は400", async () => {
    const id = await storyId();
    const a = await chapterId(id);
    const b = await chapterId(id);
    const res = await handleChapterReorder(id, post({ ids: [b, a] }));
    expect(res.status).toBe(200);
    expect(state.chapters.get(b)?.ord).toBe(0);
    expect(state.chapters.get(a)?.ord).toBe(1);
    expect((await handleChapterReorder(id, post({ ids: [a] }))).status).toBe(400);
    expect((await handleChapterReorder(id, post({ ids: [a, "nope"] }))).status).toBe(400);
  });

  it("ストーリー削除で章も消える", async () => {
    const id = await storyId();
    await chapterId(id);
    await handleStoryDelete(id);
    expect(state.stories.size).toBe(0);
    expect(state.chapters.size).toBe(0);
  });
});
