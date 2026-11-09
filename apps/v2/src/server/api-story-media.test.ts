// 章コミック・動画 API（RIT-217）。生成課金・失敗返却・所有者確認をフェイクで検証する。
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

// loadChapterMedia は (cid, storyId, userId)、readChapterVideoKey は (cid, userId) と
// 引数位置が違うので、SELECT 列の違い（video_task_id の有無）で分岐する。
const firstChapterMedia = (args: unknown[]): Record<string, unknown> | null => {
  const ch = state.chapters.get(`${args[0]}`);
  const story = ch ? state.stories.get(`${ch.story_id}`) : undefined;
  if (!ch || ch.story_id !== args[1] || !story || story.user_id !== args[2]) return null;
  return {
    imageKey: (ch.image_key as string | undefined) ?? null,
    videoKey: (ch.video_key as string | undefined) ?? null,
    videoTaskId: (ch.video_task_id as string | undefined) ?? null,
  };
};

const firstVideoKey = (args: unknown[]): { videoKey: string | null } | null => {
  const ch = state.chapters.get(`${args[0]}`);
  const story = ch ? state.stories.get(`${ch.story_id}`) : undefined;
  if (!ch || !story || story.user_id !== args[1]) return null;
  return { videoKey: (ch.video_key as string | undefined) ?? null };
};

const firstKeys = (sql: string, args: unknown[]): Record<string, unknown> | null => {
  const ch = state.chapters.get(`${args[0]}`);
  const story = ch ? state.stories.get(`${ch.story_id}`) : undefined;
  if (!ch || !story || story.user_id !== args[1]) return null;
  if (sql.includes("comic_keys")) return { keys: (ch.comic_keys as string | undefined) ?? null };
  return { videoKey: (ch.video_key as string | undefined) ?? null };
};

const firstRow = (sql: string, args: unknown[]): unknown => {
  if (sql.includes("video_task_id AS videoTaskId")) return firstChapterMedia(args);
  if (sql.includes("video_key AS videoKey")) return firstVideoKey(args);
  if (sql.includes("comic_keys AS keys")) return firstKeys(sql, args);
  if (sql.includes("JOIN v2_story")) return firstOwnedChapter(args);
  if (sql.includes("FROM v2_currency_ledger")) return state.ledgerByKey.get(`${args[0]}`) ?? null;
  if (sql.includes("FROM v2_currency_balance")) return { balance: state.balance };
  if (sql.includes("FROM character")) return state.characters.get(`${args[0]}`) ?? null;
  return null;
};

const writeChapterUpdate = (sql: string, args: unknown[]): boolean => {
  const ch = state.chapters.get(`${args[args.length - 1]}`);
  if (sql.includes("SET comic_keys")) {
    if (ch) ch.comic_keys = args[0];
  } else if (sql.includes("SET video_task_id = ?")) {
    if (ch) ch.video_task_id = args[0];
  } else if (sql.includes("video_task_id = NULL") && sql.includes("video_key = ?")) {
    if (ch) {
      ch.video_key = args[0];
      ch.video_task_id = undefined;
    }
  } else if (sql.includes("video_task_id = NULL")) {
    if (ch) ch.video_task_id = undefined;
  } else return false;
  return true;
};

const writeCurrency = (sql: string, args: unknown[]): void => {
  if (sql.includes("INSERT INTO v2_currency_ledger")) {
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

const runWrite = (sql: string, args: unknown[]): void => {
  if (!writeChapterUpdate(sql, args)) writeCurrency(sql, args);
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
        get: async (key: string) => {
          const bytes = state.bucket.get(key);
          if (!bytes) return null;
          return {
            body: bytes,
            httpMetadata: { contentType: "image/png" },
            arrayBuffer: async () => bytes.buffer,
          };
        },
      },
      NOVITA_API_KEY: "test-key",
      MOCK_API_BASE: "http://novita.test",
      RUNWARE_API_KEY: "runware-key",
      RUNWARE_API_BASE: "http://runware.test",
    },
  })),
}));

import {
  generateChapterComic,
  pollChapterVideo,
  readChapterComicPanelKey,
  readChapterVideoKey,
  startChapterVideo,
} from "./api-story-media";
import { getPlatform } from "./platform";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

const novitaFetch = (failAt = -1) => {
  let calls = 0;
  return vi.fn(async (url: RequestInfo | URL): Promise<Response> => {
    const u = String(url);
    if (u.includes("txt2img")) {
      calls += 1;
      if (calls === failAt) return new Response("err", { status: 400 });
      return Response.json({ task_id: "t1" });
    }
    if (u.includes("task-result"))
      return Response.json({
        task: { task_id: "t1", status: "TASK_STATUS_SUCCEED" },
        images: [{ image_url: "http://img.test/x.png", seed: 42 }],
      });
    return new Response(PNG, { status: 200, headers: { "content-type": "image/png" } });
  });
};

const seed = () => {
  state.stories.set("s1", { id: "s1", user_id: "local", character_id: "char1" });
  state.chapters.set("c1", {
    id: "c1",
    story_id: "s1",
    title: "一章",
    body: "本文です。場面が続きます。転換点。結末。",
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

describe("generateChapterComic", () => {
  beforeEach(() => {
    state.chapters.clear();
    state.stories.clear();
    state.characters.clear();
    state.ledger.length = 0;
    state.ledgerByKey.clear();
    state.balance = 0;
    state.bucket.clear();
  });

  it("章から4コマを生成して comic_keys を保存する", async () => {
    seed();
    const { env } = await getPlatform();
    const result = await generateChapterComic({
      env,
      storyId: "s1",
      chapterId: "c1",
      fetchImpl: novitaFetch() as unknown as typeof fetch,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.panels.every((k) => typeof k === "string")).toBe(true);
    const stored = JSON.parse(`${state.chapters.get("c1")?.comic_keys}`) as string[];
    expect(stored).toHaveLength(4);
    expect(state.ledger.filter((r) => r.kind === "spend")).toHaveLength(4);
  });

  it("コマ失敗はそのコマだけ null になり返却される", async () => {
    seed();
    const { env } = await getPlatform();
    const result = await generateChapterComic({
      env,
      storyId: "s1",
      chapterId: "c1",
      fetchImpl: novitaFetch(2) as unknown as typeof fetch,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.panels.filter((k) => k === null)).toHaveLength(1);
    expect(state.ledger.some((r) => r.kind === "refund")).toBe(true);
  });

  it("他人の章は 404", async () => {
    state.stories.set("s1", { id: "s1", user_id: "other", character_id: "char1" });
    state.chapters.set("c1", { id: "c1", story_id: "s1", title: "", body: "", narration: "" });
    const { env } = await getPlatform();
    const result = await generateChapterComic({ env, storyId: "s1", chapterId: "c1" });
    expect(result).toEqual({ ok: false, status: 404, message: "章が見つかりません。" });
  });
});

describe("chapter video", () => {
  beforeEach(() => {
    state.chapters.clear();
    state.stories.clear();
    state.ledger.length = 0;
    state.ledgerByKey.clear();
    state.balance = 0;
    state.bucket.clear();
  });

  const runwareJson = (task: Record<string, unknown>, videoReady: boolean): Response | null => {
    if (task.taskType === "mediaStorage")
      return Response.json({
        data: [{ taskType: "mediaStorage", taskUUID: task.taskUUID, mediaUUID: "m1" }],
      });
    if (task.taskType === "videoInference")
      return Response.json({ data: [{ taskType: "videoInference", taskUUID: task.taskUUID }] });
    if (task.taskType === "getResponse")
      return Response.json({
        data: [
          videoReady
            ? {
                taskType: "videoInference",
                taskUUID: task.taskUUID,
                videoURL: "http://v.test/x.mp4",
                cost: 0.01,
              }
            : { taskType: "videoInference", taskUUID: task.taskUUID },
        ],
      });
    return null;
  };

  const runwareFetch = (videoReady: boolean) =>
    vi.fn(async (_url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      // runwareCall は [{authentication}, task] の2要素ボディで、応答は {data: []} 形。
      const body = JSON.parse(`${init?.body ?? "[]"}`) as {
        taskType?: string;
        taskUUID?: string;
      }[];
      const task = Array.isArray(body) && body.length > 1 ? body[1] : {};
      const json = runwareJson(task as Record<string, unknown>, videoReady);
      if (json) return json;
      return new Response(new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70]), {
        status: 200,
        headers: { "content-type": "video/mp4" },
      });
    });

  it("挿絵が無い章は 422", async () => {
    seed();
    const { env } = await getPlatform();
    const result = await startChapterVideo({ env, storyId: "s1", chapterId: "c1" });
    expect(result).toEqual({ ok: false, status: 422, message: "先に章の挿絵を生成してください。" });
  });

  it("起動→ポーリングで video_key を保存し章由来を辿れる", async () => {
    seed();
    state.chapters.set("c1", { ...state.chapters.get("c1"), image_key: "images/k1.png" });
    state.bucket.set("images/k1.png", PNG);
    const { env } = await getPlatform();
    const start = await startChapterVideo({
      env,
      storyId: "s1",
      chapterId: "c1",
      fetchImpl: runwareFetch(true) as unknown as typeof fetch,
    });
    expect(start).toEqual({ ok: true, status: "processing" });
    expect(state.chapters.get("c1")?.video_task_id).toBeTruthy();

    const polled = await pollChapterVideo({
      env,
      storyId: "s1",
      chapterId: "c1",
      fetchImpl: runwareFetch(true) as unknown as typeof fetch,
    });
    expect(polled).toMatchObject({ ok: true, status: "ok", videoUrl: "/api/chapter-video/c1" });
    expect(`${state.chapters.get("c1")?.video_key}`).toMatch(/^videos\//);
    expect(await readChapterVideoKey(env.DB, "c1")).toMatch(/^videos\//);
    expect(state.ledger.some((r) => r.kind === "spend")).toBe(true);
  });

  it("readChapterComicPanelKey は所有者のコマキーを返す", async () => {
    seed();
    state.chapters.set("c1", {
      ...state.chapters.get("c1"),
      comic_keys: JSON.stringify(["images/a.png", null, "images/c.png", null]),
    });
    const { env } = await getPlatform();
    expect(await readChapterComicPanelKey(env.DB, "c1", 0)).toBe("images/a.png");
    expect(await readChapterComicPanelKey(env.DB, "c1", 1)).toBeNull();
    expect(await readChapterComicPanelKey(env.DB, "c1", 9)).toBeNull();
    state.stories.set("s1", { ...state.stories.get("s1"), user_id: "other" });
    expect(await readChapterComicPanelKey(env.DB, "c1", 0)).toBeNull();
  });
});
