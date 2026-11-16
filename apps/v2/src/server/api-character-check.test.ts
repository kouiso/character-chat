// @vitest-environment node
// GET /api/admin/character-check — 全件検査の結合確かめ。D1 は手元ローカル、
// ASSETS・BUCKET は偽物。書き込み呼び出しを受けない事もここで見る。
import { userTable, v2ConversationTable } from "@v2/db";
// テストの掃除は drizzle を直接 import せず raw D1 で行う（別バージョン drizzle の型衝突回避）。
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { handleCharacterCheck } from "./api-character-check";

import { openLocalD1, type LocalD1 } from "../../../../packages/db/src/test/local-d1";

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

const mocks = vi.hoisted(() => ({
  assetsFetch: vi.fn(async () => new Response(null, { status: 404 })),
  bucketHead: vi.fn<(key: string) => Promise<unknown>>(async () => null),
  bucketGet: vi.fn<(key: string, options?: unknown) => Promise<unknown>>(async () => null),
  d1: { current: null as D1Database | null },
  statements: [] as string[],
}));

vi.mock("./platform", () => ({
  getPlatform: vi.fn(async () => ({
    env: {
      get DB() {
        return mocks.d1.current;
      },
      ASSETS: { fetch: mocks.assetsFetch },
      BUCKET: { head: mocks.bucketHead, get: mocks.bucketGet },
    },
  })),
}));

// 検査は読み取りだけ。prepare 経由の文を全部記録し、SELECT 以外が流れたらテストで落とす。
const recordingD1 = (real: D1Database): D1Database =>
  new Proxy(real, {
    get: (target, prop, receiver) => {
      if (prop === "prepare") {
        return (query: string) => {
          mocks.statements.push(query);
          return target.prepare(query);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });

const request = (query = "") =>
  new Request(`https://example.test/api/admin/character-check${query}`);

const insertCharacter = (
  local: LocalD1,
  id: string,
  userId: string,
  overrides: { avatar?: string | null; tags?: string } = {},
) =>
  local.d1
    .prepare(
      `INSERT INTO character (id, user_id, name, system_prompt, greeting, tags, avatar, created_at)
       VALUES (?, ?, '検査キャラ', '設定', 'こんにちは', ?, ?, 1)`,
    )
    .bind(id, userId, overrides.tags ?? "[]", overrides.avatar ?? null)
    .run();

describe("GET /api/admin/character-check", () => {
  let local: LocalD1;
  const prefix = `zzcheck-${crypto.randomUUID().slice(0, 8)}`;
  const ids = {
    good: `${prefix}-good`,
    broken: `${prefix}-broken`,
    legacy: `${prefix}-legacy`,
    dev: `${prefix}-dev`,
    badkey: `${prefix}-badkey`,
  };
  const legacyOwner = `${prefix}-owner`;
  const devOwner = `${prefix}-dev-owner`;
  const convId = `${prefix}-conv`;

  const findItem = async (id: string, limit = 25) => {
    let cursor: string | null = null;
    for (let guard = 0; guard < 40; guard += 1) {
      const query = new URLSearchParams({ limit: String(limit) });
      if (cursor) query.set("cursor", cursor);
      const response = await handleCharacterCheck(request(`?${query}`));
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        items: { id: string }[];
        nextCursor: string | null;
      };
      const hit = body.items.find((item) => item.id === id);
      if (hit) return { item: hit, body };
      if (!body.nextCursor) return { item: null, body };
      cursor = body.nextCursor;
    }
    throw new Error("ページを全部見ても対象の id が見つからん");
  };

  beforeAll(async () => {
    local = await openLocalD1();
    mocks.d1.current = recordingD1(local.d1);
    // 移行後の持ち主。テスト用の D1 には居ないので先に立てる（外部キー）。
    await local.db
      .insert(userTable)
      .values({ id: "local", email: "local@example.invalid", createdAt: Date.now() })
      .onConflictDoNothing();
    for (const owner of [legacyOwner, devOwner]) {
      await local.db.insert(userTable).values({
        id: owner,
        email: `${owner}@example.invalid`,
        createdAt: Date.now(),
      });
    }
    await insertCharacter(local, ids.good, "local");
    await insertCharacter(local, ids.broken, "local", { tags: "{broken" });
    await insertCharacter(local, ids.legacy, legacyOwner);
    await insertCharacter(local, ids.dev, devOwner);
    await insertCharacter(local, ids.badkey, "local", { avatar: "../secret" });
    // 旧名義を持ち主の集合に入れる移行済み会話。
    await local.db.insert(v2ConversationTable).values({
      id: convId,
      userId: "local",
      legacySourceUserId: legacyOwner,
      characterId: ids.legacy,
      threadId: convId,
      promptVersion: "test",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }, 180_000);

  afterAll(async () => {
    await local.d1.prepare("DELETE FROM v2_conversation WHERE id = ?").bind(convId).run();
    for (const id of Object.values(ids)) {
      await local.d1.prepare("DELETE FROM character WHERE id = ?").bind(id).run();
    }
    for (const owner of [legacyOwner, devOwner]) {
      await local.d1.prepare("DELETE FROM user WHERE id = ?").bind(owner).run();
    }
    await local.dispose();
  });

  beforeEach(() => {
    mocks.statements.length = 0;
    mocks.assetsFetch.mockClear();
    mocks.bucketHead.mockClear();
    mocks.bucketGet.mockClear();
  });

  it("全件を 1 件ずつ返し、4 種の名義と顔の絵の状態が例の形になる", async () => {
    const good = (await findItem(ids.good)).item;
    expect(good).toMatchObject({
      id: ids.good,
      zod: { ok: true, issues: [] },
      visible: true,
      published: false,
      canEdit: true,
      owner: "local",
      official: false,
      avatar: { status: "unset" },
    });
    const legacy = (await findItem(ids.legacy)).item;
    expect(legacy).toMatchObject({ visible: true, canEdit: true, owner: "legacy" });
    const dev = (await findItem(ids.dev)).item;
    expect(dev).toMatchObject({ visible: false, canEdit: false, owner: "other" });
    const badkey = (await findItem(ids.badkey)).item;
    expect(badkey).toMatchObject({ avatar: { status: "bad_key" } });
    expect(mocks.assetsFetch).not.toHaveBeenCalledWith(
      expect.stringContaining(".."),
      expect.anything(),
    );
    // seed の公式キャラ（他者名義・is_official=1）も見える・直せない・other で返る。
    const official = ((await findItem("import-charap-アイリス")).item as {
      visible: boolean;
      canEdit: boolean;
      owner: string;
      official: boolean;
    } | null)!;
    expect(official).toMatchObject({
      visible: true,
      canEdit: false,
      owner: "other",
      official: true,
    });
  });

  it("tags を壊した 1 件だけが zod 不合格で、ほかの件数は変わらん", async () => {
    const broken = (await findItem(ids.broken)).item as {
      zod: { ok: boolean; issues: { path: string }[] };
    } | null;
    expect(broken?.zod.ok).toBe(false);
    expect(broken?.zod.issues.map((issue) => issue.path)).toContain("tags");
    // 壊した行が在っても応答は 200 で、ほかの行は全部返る。
    const response = await handleCharacterCheck(request("?limit=25"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { total: number; items: unknown[] };
    expect(body.total).toBeGreaterThan(0);
    const good = await findItem(ids.good);
    expect(good.item).not.toBeNull();
  });

  it("limit=26・limit=文字 は 400 bad_request、limit 未指定は 10 件", async () => {
    expect((await handleCharacterCheck(request("?limit=26"))).status).toBe(400);
    expect((await handleCharacterCheck(request("?limit=abc"))).status).toBe(400);
    expect((await handleCharacterCheck(request("?limit=0"))).status).toBe(400);
    expect(await (await handleCharacterCheck(request("?limit=26"))).json()).toEqual({
      code: "bad_request",
    });
    const fallback = (await (await handleCharacterCheck(request())).json()) as {
      items: unknown[];
      nextCursor: string | null;
    };
    expect(fallback.items).toHaveLength(10);
    expect(fallback.nextCursor).not.toBeNull();
  });

  it("cursor で重複なく最後まで辿れ、並びは id 昇順", async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 40 && seen.length < 40; guard += 1) {
      const query = new URLSearchParams({ limit: "5" });
      if (cursor) query.set("cursor", cursor);
      const body = (await (await handleCharacterCheck(request(`?${query}`))).json()) as {
        items: { id: string }[];
        nextCursor: string | null;
      };
      seen.push(...body.items.map((item) => item.id));
      if (!body.nextCursor) break;
      cursor = body.nextCursor;
    }
    const sorted = [...seen].sort();
    expect(seen).toEqual(sorted);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("旧表 7 つの行数を最初のページだけに付ける（無い表は rows null・missing）", async () => {
    const first = (await (await handleCharacterCheck(request("?limit=1"))).json()) as {
      legacyLinked: { table: string; rows: number | null; missing: boolean }[];
    };
    expect(first.legacyLinked).toHaveLength(7);
    const promptVersion = first.legacyLinked.find(
      (row) => row.table === "character_prompt_version",
    );
    // 手元・試し用の D1 は drizzle/ から作るのでこの表は無い（本番にだけ在る）。
    expect(promptVersion).toEqual({ table: "character_prompt_version", rows: null, missing: true });
    const visual = first.legacyLinked.find((row) => row.table === "character_visual");
    expect(visual).toMatchObject({ table: "character_visual", missing: false });
    expect(typeof visual?.rows).toBe("number");
    // 2 ページ目には付かない。
    const second = (await (
      await handleCharacterCheck(request("?limit=1&cursor=a"))
    ).json()) as Record<string, unknown>;
    expect(second.legacyLinked).toBeUndefined();
  });

  it("結果に本文・会話・名義の生の値を入れない", async () => {
    const response = await handleCharacterCheck(request("?limit=25"));
    const text = JSON.stringify(await response.json());
    expect(text).not.toContain("【キャラクター】");
    expect(text).not.toContain("sukererion@gmail.com");
    expect(text).not.toContain(legacyOwner);
    expect(text).not.toContain("systemPrompt");
    expect(text).not.toContain("greeting");
    expect(text).not.toContain("user_id");
    expect(text).not.toContain("userId");
  });

  it("R2 の偽物が例外を投げても、その 1 件を missing にせず 502 を返す", async () => {
    // bundled に当たらん avatar を持つ local キャラ（bucketHead が例外を投げる経路）。
    // ローカル D1 は実行内の全ファイルで共有で、他の試験が残した行が id 順の先頭に
    // 紛れうる。'!' 始まりの id は必ず先頭に来るので、専用の 1 件を挿して確実に当てる。
    const firstId = `!${prefix}-first`;
    await insertCharacter(local, firstId, "local", { avatar: "check-first.png" });
    try {
      mocks.bucketHead.mockRejectedValueOnce(new Error("R2 down"));
      mocks.assetsFetch.mockResolvedValueOnce(new Response(null, { status: 404 }));
      const response = await handleCharacterCheck(request("?limit=1"));
      expect(response.status).toBe(502);
      const body = (await response.json()) as { code: string; id: string };
      expect(body.code).toBe("storage_failed");
      expect(body.id).toBe(firstId);
    } finally {
      await local.d1.prepare("DELETE FROM character WHERE id = ?").bind(firstId).run();
    }
  });

  it("D1・R2 の偽物は書き込みの呼び出しを 1 回も受けない", async () => {
    await handleCharacterCheck(request("?limit=25"));
    const writes = mocks.statements.filter(
      (statement) => !/^\s*(select|with|pragma)\b/i.test(statement),
    );
    expect(writes).toEqual([]);
    // R2 は head と範囲 get だけ。put/delete を持たん偽物なので呼ばれたら TypeError で落ちる。
    for (const call of mocks.bucketGet.mock.calls) {
      expect(call[1]).toEqual({ range: { offset: 0, length: 12 } });
    }
  });

  it("R2 に在る顔の絵は r2、画像でない物は not_image", async () => {
    mocks.bucketHead.mockImplementation(async (key: string) =>
      key === "avatars/from-r2.png"
        ? ({ size: 100, httpMetadata: { contentType: "image/png" } } as R2Object)
        : key === "avatars/not-an-image.png"
          ? ({
              size: 100,
              httpMetadata: { contentType: "text/html" },
            } as R2Object)
          : null,
    );
    mocks.bucketGet.mockImplementation(async (key: string) => {
      // 中身で判定するので、html 側は本当に html のバイト列を返す。
      const bytes =
        key === "avatars/not-an-image.png"
          ? new TextEncoder().encode("<html><body>not image</body></html>")
          : PNG_BYTES;
      const blob = new Blob([bytes]);
      return {
        arrayBuffer: () => blob.arrayBuffer(),
        httpMetadata: {},
      } as unknown as R2ObjectBody;
    });
    const r2Char = `${prefix}-r2`;
    const htmlChar = `${prefix}-html`;
    await insertCharacter(local, r2Char, "local", { avatar: "from-r2.png" });
    await insertCharacter(local, htmlChar, "local", { avatar: "not-an-image.png" });
    try {
      const r2 = (await findItem(r2Char)).item as { avatar: { status: string } } | null;
      expect(r2?.avatar.status).toBe("r2");
      const html = (await findItem(htmlChar)).item as { avatar: { status: string } } | null;
      expect(html?.avatar.status).toBe("not_image");
    } finally {
      await local.d1.prepare("DELETE FROM character WHERE id = ?").bind(r2Char).run();
      await local.d1.prepare("DELETE FROM character WHERE id = ?").bind(htmlChar).run();
      mocks.bucketHead.mockImplementation(async () => null);
      mocks.bucketGet.mockImplementation(async () => null);
    }
  });
});
