// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// RIT-206: 公開カタログ API。公開/非公開の所有者確認・一覧・フォーク経路を見る。
const state = vi.hoisted(() => ({
  publishes: new Map<string, { user_id: string; summary: string | null; published_at: number }>(),
  characters: new Map<
    string,
    { user_id: string; name: string; avatar: string | null; greeting: string }
  >(),
  versions: new Map<string, string>(),
  created: vi.fn(async () => ({ id: "forked-1", versionId: "v1", revision: 1 })),
}));

vi.mock("@v2/db", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createDb: vi.fn(() => ({})),
  ensureLocalUser: vi.fn(async () => undefined),
  createCharacterWithVersion: state.created,
}));

vi.mock("./platform", () => ({
  getPlatform: vi.fn(async () => ({
    env: {
      DB: {
        prepare: (sql: string) => ({
          // bind 無しの一覧クエリ（カタログ一覧）
          all: async () => ({
            results: [...state.publishes.entries()]
              .sort((a, b) => b[1].published_at - a[1].published_at)
              .map(([id, p]) => ({
                character_id: id,
                user_id: p.user_id,
                summary: p.summary,
                published_at: p.published_at,
                name: state.characters.get(id)?.name ?? "",
                avatar: null,
                greeting: state.characters.get(id)?.greeting ?? "",
              })),
          }),
          bind: (...args: unknown[]) => ({
            first: async () => {
              if (sql.includes("SELECT user_id FROM character WHERE id")) {
                const c = state.characters.get(args[0] as string);
                return c ? { user_id: c.user_id } : null;
              }
              if (sql.includes("FROM v2_character_publish")) {
                const p = state.publishes.get(args[0] as string);
                return p
                  ? {
                      character_id: args[0],
                      user_id: p.user_id,
                      summary: p.summary,
                      published_at: p.published_at,
                    }
                  : null;
              }
              if (sql.includes("JOIN character")) {
                const p = state.publishes.get(args[0] as string);
                const c = state.characters.get(args[0] as string);
                return p && c
                  ? {
                      character_id: args[0],
                      user_id: p.user_id,
                      summary: p.summary,
                      published_at: p.published_at,
                      name: c.name,
                      avatar: c.avatar,
                      greeting: c.greeting,
                    }
                  : null;
              }
              if (sql.includes("FROM character_version")) {
                const json = state.versions.get(args[0] as string);
                return json ? { content_json: json } : null;
              }
              return null;
            },
            all: async () => ({
              results: [...state.publishes.entries()]
                .sort((a, b) => b[1].published_at - a[1].published_at)
                .map(([id, p]) => ({
                  character_id: id,
                  user_id: p.user_id,
                  summary: p.summary,
                  published_at: p.published_at,
                  name: state.characters.get(id)?.name ?? "",
                  avatar: null,
                  greeting: state.characters.get(id)?.greeting ?? "",
                })),
            }),
            run: async () => {
              if (sql.startsWith("DELETE")) state.publishes.delete(args[0] as string);
              if (sql.startsWith("INSERT"))
                state.publishes.set(args[0] as string, {
                  user_id: args[1] as string,
                  summary: args[2] as string | null,
                  published_at: args[3] as number,
                });
              return { success: true };
            },
          }),
        }),
      },
    },
  })),
}));

const {
  handleCatalogDetail,
  handleCatalogFork,
  handleCatalogList,
  handlePublishSet,
  handlePublishStatus,
  handlePublishUnset,
} = await import("./api-publish");

const putBody = (body: object) =>
  new Request("https://example.com/api/characters/c/publish", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  state.publishes.clear();
  state.characters.clear();
  state.versions.clear();
  state.created.mockClear();
  state.characters.set("mine", {
    user_id: "local",
    name: "ミア",
    avatar: null,
    greeting: "やあ",
  });
  state.characters.set("theirs", {
    user_id: "other",
    name: "ライバル",
    avatar: null,
    greeting: "どうも",
  });
  state.versions.set(
    "mine",
    JSON.stringify({
      name: "ミア",
      personality: "明るい",
      speechStyle: "タメ口",
      greeting: "やあ",
    }),
  );
});

describe("api-publish", () => {
  it("自分のキャラを公開して一覧に出る", async () => {
    const res = await handlePublishSet("mine", putBody({ summary: "元気な子" }));
    expect(res.status).toBe(200);
    const status: { published: boolean; summary: string | null } = await (
      await handlePublishStatus("mine")
    ).json();
    expect(status).toEqual({ published: true, summary: "元気な子" });
    const list: { items: { name: string }[] } = await (await handleCatalogList()).json();
    expect(list.items).toHaveLength(1);
    expect(list.items[0].name).toBe("ミア");
  });

  it("他人のキャラは公開操作できない（404）", async () => {
    expect((await handlePublishSet("theirs", putBody({}))).status).toBe(404);
    expect((await handlePublishStatus("theirs")).status).toBe(404);
    expect((await handlePublishUnset("theirs")).status).toBe(404);
  });

  it("非公開にすると一覧・詳細から消える", async () => {
    await handlePublishSet("mine", putBody({}));
    await handlePublishUnset("mine");
    const list: { items: unknown[] } = await (await handleCatalogList()).json();
    expect(list.items).toHaveLength(0);
    expect((await handleCatalogDetail("mine")).status).toBe(404);
  });

  it("フォークで自分のライブラリへ複製される", async () => {
    await handlePublishSet("mine", putBody({}));
    const res = await handleCatalogFork("mine");
    expect(res.status).toBe(201);
    expect(state.created).toHaveBeenCalledWith(
      {},
      "local",
      expect.objectContaining({ name: "ミア" }),
    );
  });

  it("非公開キャラはフォークできない（404）", async () => {
    expect((await handleCatalogFork("mine")).status).toBe(404);
    expect(state.created).not.toHaveBeenCalled();
  });

  it("過長 summary は 422", async () => {
    expect((await handlePublishSet("mine", putBody({ summary: "x".repeat(501) }))).status).toBe(
      422,
    );
  });
});
