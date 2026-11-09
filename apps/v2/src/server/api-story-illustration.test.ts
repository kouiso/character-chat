// 章挿絵 API（RIT-215）。生成課金・失敗返却・所有者確認を実 D1 相当のフェイクで検証する。
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  chapters: new Map<string, Record<string, unknown>>(),
  stories: new Map<string, Record<string, unknown>>(),
  characters: new Map<string, Record<string, unknown>>(),
  ledger: [] as Record<string, unknown>[],
  ledgerByKey: new Map<string, Record<string, unknown>>(),
  balance: 0,
  bucket: new Map<string, Uint8Array>(),
}));

const firstOwnedChapter = (args: unknown[]): Record<string, unknown> | null => {
  const ch = state.chapters.get(`${args[0]}`);
  if (!ch || ch.story_id !== args[1]) return null;
  const story = state.stories.get(`${ch.story_id}`);
  if (!story || story.user_id !== args[2]) return null;
  return {
    id: ch.id,
    storyId: ch.story_id,
    characterId: story.character_id,
    title: ch.title,
    body: ch.body,
    narration: ch.narration,
  };
};

const firstChapterImage = (args: unknown[]): { imageKey: string | null } | null => {
  const ch = state.chapters.get(`${args[0]}`);
  const story = ch ? state.stories.get(`${ch.story_id}`) : undefined;
  if (!ch || !story || story.user_id !== args[1]) return null;
  return { imageKey: (ch.image_key as string | undefined) ?? null };
};

const firstRow = (sql: string, args: unknown[]): unknown => {
  if (sql.includes("image_key AS imageKey")) return firstChapterImage(args);
  if (sql.includes("JOIN v2_story")) return firstOwnedChapter(args);
  if (sql.includes("FROM v2_currency_ledger")) return state.ledgerByKey.get(`${args[0]}`) ?? null;
  if (sql.includes("FROM v2_currency_balance")) return { balance: state.balance };
  if (sql.includes("FROM character")) return state.characters.get(`${args[0]}`) ?? null;
  return null;
};

const runWrite = (sql: string, args: unknown[]): void => {
  if (sql.includes("UPDATE v2_chapter SET image_key")) {
    const ch = state.chapters.get(`${args[2]}`);
    if (ch) ch.image_key = args[0];
  } else if (sql.includes("INSERT INTO v2_currency_ledger")) {
    const row = {
      id: args[0],
      user_id: args[1],
      kind: args[2],
      amount: args[3],
      balance_after: args[4],
      idempotency_key: args[8],
    };
    state.ledger.push(row);
    state.ledgerByKey.set(`${args[8]}`, row);
  } else if (sql.includes("INSERT INTO v2_currency_balance")) state.balance = Number(args[1]);
};

type Bound = {
  first: () => Promise<unknown>;
  all: () => Promise<unknown>;
  run: () => Promise<unknown>;
};

const bind = (sql: string, args: unknown[]): Bound => ({
  first: async () => firstRow(sql, args),
  all: async () => ({ results: [] }),
  run: async () => runWrite(sql, args),
});

vi.mock("./platform", () => ({
  getPlatform: vi.fn(async () => ({
    env: {
      DB: {
        prepare: (sql: string) => ({
          bind: (...args: unknown[]) => bind(sql, args),
          first: async () => firstRow(sql, []),
          all: async () => ({ results: [] }),
          run: async () => runWrite(sql, []),
        }),
        batch: async (stmts: Bound[]) => Promise.all(stmts.map((s) => s.run())),
      },
      BUCKET: {
        put: async (key: string, bytes: Uint8Array) => state.bucket.set(key, bytes),
        get: async (key: string) => state.bucket.get(key) ?? null,
      },
      NOVITA_API_KEY: "test-key",
      MOCK_API_BASE: "http://novita.test",
    },
  })),
}));

import {
  generateChapterIllustration,
  handleChapterIllustrationPost,
  readChapterImageKey,
} from "./api-story-illustration";
import { getPlatform } from "./platform";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

const okFetch = vi.fn(async (url: RequestInfo | URL): Promise<Response> => {
  const u = String(url);
  if (u.includes("txt2img")) return Response.json({ task_id: "t1" });
  if (u.includes("task-result"))
    return Response.json({
      task: { task_id: "t1", status: "TASK_STATUS_SUCCEED" },
      images: [{ image_url: "http://img.test/x.png", seed: 42 }],
    });
  return new Response(PNG, { status: 200, headers: { "content-type": "image/png" } });
});

const seed = () => {
  state.stories.set("s1", { id: "s1", user_id: "local", character_id: "char1" });
  state.chapters.set("c1", {
    id: "c1",
    story_id: "s1",
    title: "一章",
    body: "本文",
    narration: "語り",
  });
  state.characters.set("char1", {
    visual_prompt: "a girl with silver hair",
    image_meta: null,
    lora_model: null,
    lora_weight: null,
    lora_trigger_prompt: null,
  });
};

describe("generateChapterIllustration", () => {
  beforeEach(() => {
    state.chapters.clear();
    state.stories.clear();
    state.characters.clear();
    state.ledger.length = 0;
    state.ledgerByKey.clear();
    state.balance = 0;
    state.bucket.clear();
    okFetch.mockClear();
  });

  it("章に挿絵を生成して image_key を保存する", async () => {
    seed();
    const { env } = await getPlatform();
    const result = await generateChapterIllustration({
      env,
      storyId: "s1",
      chapterId: "c1",
      fetchImpl: okFetch,
    });
    expect(result).toMatchObject({ ok: true, imageUrl: "/api/chapter-media/c1" });
    expect(state.chapters.get("c1")?.image_key).toMatch(/^images\//);
    expect(state.ledger.some((r) => r.kind === "spend")).toBe(true);
  });

  it("生成失敗は台帳へ返却して 502 を返す", async () => {
    seed();
    const badFetch = vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes("txt2img")) return Response.json({ task_id: "t1" });
      if (u.includes("task-result"))
        return Response.json({ task: { task_id: "t1", status: "TASK_STATUS_FAILED" }, images: [] });
      return new Response("x");
    });
    const { env } = await getPlatform();
    const result = await generateChapterIllustration({
      env,
      storyId: "s1",
      chapterId: "c1",
      fetchImpl: badFetch,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(502);
    expect(state.chapters.get("c1")?.image_key).toBeUndefined();
    expect(state.ledger.some((r) => r.kind === "refund")).toBe(true);
  });

  it("他人の章は 404", async () => {
    state.stories.set("s1", { id: "s1", user_id: "other", character_id: "char1" });
    state.chapters.set("c1", { id: "c1", story_id: "s1", title: "", body: "", narration: "" });
    const { env } = await getPlatform();
    const result = await generateChapterIllustration({ env, storyId: "s1", chapterId: "c1" });
    expect(result).toEqual({ ok: false, status: 404, message: "章が見つかりません。" });
  });

  it("外見設定が無いキャラは 422", async () => {
    seed();
    state.characters.set("char1", {
      visual_prompt: null,
      image_meta: null,
      lora_model: null,
      lora_weight: null,
      lora_trigger_prompt: null,
    });
    const { env } = await getPlatform();
    const result = await generateChapterIllustration({ env, storyId: "s1", chapterId: "c1" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(422);
  });

  it("handleChapterIllustrationPost は他人の章へ 404 を返す", async () => {
    seed();
    state.stories.set("s1", { ...state.stories.get("s1"), user_id: "other" });
    const res = await handleChapterIllustrationPost("s1", "c1");
    expect(res.status).toBe(404);
  });

  it("readChapterImageKey は所有者の章だけキーを返す", async () => {
    seed();
    state.chapters.set("c1", { ...state.chapters.get("c1"), image_key: "images/k1.png" });
    const { env } = await getPlatform();
    expect(await readChapterImageKey(env.DB, "c1")).toBe("images/k1.png");
    state.stories.set("s1", { ...state.stories.get("s1"), user_id: "other" });
    expect(await readChapterImageKey(env.DB, "c1")).toBeNull();
  });
});
