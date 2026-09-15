// @vitest-environment node
// node:sqlite は jsdom 環境ではバンドルできないため、このファイルだけ node 環境で走らせる。
import { afterEach, describe, expect, it, vi } from "vitest";

import { app } from "../[[route]]";
import { MAX_R2_IMAGE_SIZE_BYTES } from "../lib/route-context";

import type { DatabaseSync } from "node:sqlite";

let DatabaseSyncCtor: typeof DatabaseSync | undefined;
try {
  const mod = await import("node:sqlite");
  DatabaseSyncCtor = mod.DatabaseSync;
} catch {
  // この Node ビルドでは node:sqlite が無効化されている。
}

// 所有権と slug 採番と json_insert の追記は「実際に何行残ったか / 何が入ったか」でしか
// 確かめられん。SQL 文字列を見るモックやと UPDATE の WHERE から user_id が落ちても
// 気付けんので、書き込みも走る実 SQLite に繋ぐ。
const AUTH_TOKEN = "test-token";
// getUserEmail は Bearer 一致で LOCAL_USER_EMAIL を返し、ensureUser はそれをそのまま userId にする。
const OWNER_ID = "sukererion@gmail.com";
const INTRUDER_ID = "attacker@example.com";
// getUserEmail は Host が localhost やと無条件で本人を返す。app.request にホストを渡さんと
// 「未認証やのに本人扱い」で 401 テストが通ってまうので、本番相当のホストを固定する。
const ORIGIN = "https://adult-ai-chat.pages.dev";
const HOST_HEADER = { Host: "adult-ai-chat.pages.dev" };
const AUTH_HEADERS = { ...HOST_HEADER, Authorization: `Bearer ${AUTH_TOKEN}` };
const JSON_HEADERS = { ...AUTH_HEADERS, "Content-Type": "application/json" };
const ANON_JSON_HEADERS = { ...HOST_HEADER, "Content-Type": "application/json" };

const OWNED_ID = "char-owned";
const INTRUDER_CHARACTER_ID = "char-intruder";
const TOO_LONG_ID = "x".repeat(129);
// ALLOWED_IMAGE_HOSTS に載っとるホスト。ここを外すと SSRF ガードで 400 になる。
const ALLOWED_IMAGE_URL = "https://image.novita.ai/generated/pose.png";

type TestHarness = { db: DatabaseSync; DB: unknown; put: ReturnType<typeof vi.fn> };

// response.json() は unknown を返すため、代入側で形を宣言する
// （as だと eslint の no-unnecessary-type-assertion が外しにきて tsc と衝突する）。
type CharacterListItem = {
  id: string;
  userId: string;
  name: string;
  avatar: string | null;
  isOfficial: boolean;
  slug: string | null;
  subAvatars: string[] | null;
  systemPrompt: string;
  visualPrompt: string | null;
  greeting: string;
  tags: string[];
  loraModel: string | null;
  loraWeight: number | null;
  loraTriggerPrompt: string | null;
  createdAt: number;
  visualMeta: Record<string, unknown> | null;
};
type CharacterListEnvelope = { characters: CharacterListItem[] };
type CharacterDetailEnvelope = { character: Omit<CharacterListItem, "userId"> };
type CreatedCharacterEnvelope = {
  character: {
    id: string;
    userId: string;
    name: string;
    avatar: string | null;
    slug: string;
    systemPrompt: string;
    visualPrompt: string | null;
    greeting: string;
    tags: string[];
    userPersonaName: string | null;
    userPersonaGender: string | null;
    userPersonaPersonality: string | null;
    createdAt: number;
  };
};
type GalleryEnvelope = {
  items: {
    image_url: string | null;
    created_at: number;
    message_id: string;
    conversation_id: string;
  }[];
  next_cursor: number | null;
};
type SubImagesEnvelope = { images: { url: string; r2Key: string; ord: number }[] };
type SubAvatarEnvelope = { subKey: string };

const makeRealD1 = (): TestHarness => {
  if (!DatabaseSyncCtor) throw new Error("node:sqlite is not available");
  const db = new DatabaseSyncCtor(":memory:");
  db.exec(`
    CREATE TABLE user (id TEXT PRIMARY KEY, email TEXT NOT NULL, created_at INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE character (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, name_reading TEXT, avatar TEXT,
      gender TEXT,
      is_official INTEGER NOT NULL DEFAULT 0, system_prompt TEXT NOT NULL DEFAULT '',
      visual_prompt TEXT, seed INTEGER, image_meta TEXT,
      lora_model TEXT, lora_weight REAL, lora_trigger_prompt TEXT,
      greeting TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '[]', sub_avatars TEXT,
      user_persona_name TEXT, user_persona_gender TEXT, user_persona_personality TEXT,
      display_order INTEGER NOT NULL DEFAULT 0, slug TEXT UNIQUE, created_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE conversation (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, character_id TEXT NOT NULL,
      title TEXT NOT NULL, created_at INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE message (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, conversation_id TEXT NOT NULL,
      character_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL DEFAULT '',
      image_url TEXT, image_key TEXT, created_at INTEGER NOT NULL
    );
    CREATE TABLE character_visual (
      character_id TEXT PRIMARY KEY, hair_color TEXT NOT NULL, hair_style TEXT NOT NULL,
      hair_length TEXT NOT NULL, eye_color TEXT NOT NULL, skin_tone TEXT NOT NULL,
      body_type TEXT NOT NULL, breast_size TEXT, height_band TEXT,
      age_apparent INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE character_distinctive_mark (character_id TEXT NOT NULL, tag TEXT NOT NULL);
    CREATE TABLE character_default_outfit_tag (
      character_id TEXT NOT NULL, tag TEXT NOT NULL,
      weight REAL NOT NULL DEFAULT 1.0, ord INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE character_undress_progression (
      character_id TEXT NOT NULL, level TEXT NOT NULL, tag TEXT NOT NULL
    );
    CREATE TABLE character_sub_image (
      id INTEGER PRIMARY KEY AUTOINCREMENT, character_id TEXT NOT NULL, r2_key TEXT NOT NULL,
      ord INTEGER NOT NULL DEFAULT 0, gen_params TEXT, archived_at INTEGER
    );
  `);
  db.prepare("INSERT INTO user (id, email) VALUES (?, ?)").run(OWNER_ID, OWNER_ID);
  db.prepare("INSERT INTO user (id, email) VALUES (?, ?)").run(INTRUDER_ID, INTRUDER_ID);

  const wrap = (sql: string, args: unknown[]) => {
    const bound = args.map((a) => (a === undefined ? null : a)) as never[];
    const returnsRows = /^\s*select/i.test(sql) || /\breturning\b/i.test(sql);
    // RETURNING 付きの書き込みを二度実行せんよう、結果は一度だけ取って使い回す。
    let cached: Record<string, unknown>[] | undefined;
    let changes = 0;
    const rows = (): Record<string, unknown>[] => {
      if (cached === undefined) {
        if (returnsRows) {
          cached = db.prepare(sql).all(...bound) as Record<string, unknown>[];
        } else {
          changes = Number(db.prepare(sql).run(...bound).changes);
          cached = [];
        }
      }
      return cached;
    };
    return {
      all: async () => ({ results: rows(), success: true }),
      first: async () => rows()[0] ?? null,
      run: async () => {
        rows();
        return { success: true, meta: { changes }, results: [] };
      },
      raw: async <T = unknown[]>() => rows().map((r) => Object.values(r)) as T[],
      values: async <T = unknown[]>() => rows().map((r) => Object.values(r)) as T[],
      __exec: () => {
        rows();
        return { success: true, meta: { changes }, results: [] };
      },
    };
  };

  const DB = {
    prepare: (sql: string) => ({ bind: (...args: unknown[]) => wrap(sql, args), ...wrap(sql, []) }),
    dump: () => Promise.resolve(new ArrayBuffer(0)),
    batch: async (statements: { __exec: () => unknown }[]) => statements.map((s) => s.__exec()),
    exec: () => Promise.resolve({ count: 0, duration: 0 }),
  };
  return { db, DB, put: vi.fn().mockResolvedValue(undefined) };
};

const envOf = (harness: TestHarness) => ({
  AUTH_TOKEN,
  DB: harness.DB,
  BUCKET: { put: harness.put, get: vi.fn(), delete: vi.fn() },
});

type CharacterSeed = {
  id: string;
  userId?: string;
  name?: string;
  slug?: string | null;
  avatar?: string | null;
  isOfficial?: boolean;
  displayOrder?: number;
  subAvatars?: string[] | null;
  createdAt?: number;
};

const seedCharacter = (db: DatabaseSync, seed: CharacterSeed) => {
  db.prepare(
    `INSERT INTO character
       (id, user_id, name, avatar, system_prompt, greeting, tags, slug, is_official, display_order, sub_avatars, created_at)
     VALUES (?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?, ?)`,
  ).run(
    seed.id,
    seed.userId ?? OWNER_ID,
    seed.name ?? `name-${seed.id}`,
    seed.avatar === undefined ? null : seed.avatar,
    `${seed.id} のプロンプト`,
    `${seed.id} やで`,
    seed.slug === undefined ? seed.id : seed.slug,
    seed.isOfficial ? 1 : 0,
    seed.displayOrder ?? 0,
    seed.subAvatars ? JSON.stringify(seed.subAvatars) : null,
    seed.createdAt ?? 1_000,
  );
};

const readCharacter = (db: DatabaseSync, id: string) =>
  db.prepare("SELECT * FROM character WHERE id = ?").get(id) as Record<string, unknown> | undefined;

const countCharacters = (db: DatabaseSync) =>
  (db.prepare("SELECT COUNT(*) AS n FROM character").get() as { n: number }).n;

const seedMessage = (
  db: DatabaseSync,
  seed: {
    id: string;
    userId?: string;
    characterId?: string;
    conversationId?: string;
    imageUrl?: string | null;
    createdAt: number;
  },
) => {
  db.prepare(
    `INSERT INTO message (id, user_id, conversation_id, character_id, role, content, image_url, created_at)
     VALUES (?, ?, ?, ?, 'assistant', '本文', ?, ?)`,
  ).run(
    seed.id,
    seed.userId ?? OWNER_ID,
    seed.conversationId ?? "conv-1",
    seed.characterId ?? OWNED_ID,
    seed.imageUrl === undefined ? `https://cdn.example.com/${seed.id}.png` : seed.imageUrl,
    seed.createdAt,
  );
};

const request = (harness: TestHarness, path: string, init: RequestInit = {}) =>
  app.request(`${ORIGIN}${path}`, init, envOf(harness));

const authedGet = (harness: TestHarness, path: string) =>
  request(harness, path, { headers: AUTH_HEADERS });

const anonGet = (harness: TestHarness, path: string) =>
  request(harness, path, { headers: HOST_HEADER });

const authedJson = (harness: TestHarness, path: string, method: string, body: unknown) =>
  request(harness, path, { method, headers: JSON_HEADERS, body: JSON.stringify(body) });

const anonJson = (harness: TestHarness, path: string, method: string, body: unknown) =>
  request(harness, path, { method, headers: ANON_JSON_HEADERS, body: JSON.stringify(body) });

const validVisualMeta = {
  hairColor: "black",
  hairStyle: "straight",
  hairLength: "long",
  eyeColor: "brown",
  skinTone: "fair",
  bodyType: "slender",
  breastSize: "medium",
  heightBand: "average",
  ageApparent: 22,
  distinctiveMarks: ["mole_under_eye"],
  // sanitizeOutfitTags を通るので danbooru 語彙にある語だけが保存される。
  defaultOutfit: ["school_uniform", "thighhighs"],
  undressProgression: { topless: ["thighhighs"] },
};

const validCreateBody = {
  name: "Sakura Kun",
  systemPrompt: "あんたは桜くんや。",
  greeting: "よお。",
  tags: ["幼馴染"],
};

// 呼ばれるたびに Response を作り直す。使い回すと2回目の arrayBuffer() が
// "Body has already been read" で落ち、テストが検証したい経路と別の失敗になる。
const stubFetch = (makeResponse: () => Response) => {
  const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(makeResponse()));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

const pngResponse = (byteLength: number) => () =>
  new Response(new Uint8Array(byteLength), { headers: { "content-type": "image/png" } });

describe.skipIf(!DatabaseSyncCtor)("GET /api/characters (実SQLite)", () => {
  it("認証ヘッダが無ければ 401 unauthorized", async () => {
    const harness = makeRealD1();
    seedCharacter(harness.db, { id: OWNED_ID });

    const response = await anonGet(harness, "/api/characters");

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });

  it("他人のキャラは一覧に混ざらない（公式フラグ付きでも同じ）", async () => {
    const harness = makeRealD1();
    seedCharacter(harness.db, { id: OWNED_ID, name: "自分の子" });
    seedCharacter(harness.db, {
      id: INTRUDER_CHARACTER_ID,
      userId: INTRUDER_ID,
      name: "他人の子",
      // is_official が read の抜け道になっとらんこと。公式でも他人のもんは出さん。
      isOfficial: true,
      createdAt: 9_999,
    });

    const response = await authedGet(harness, "/api/characters");

    expect(response.status).toBe(200);
    const body: CharacterListEnvelope = JSON.parse(await response.text());
    expect(body.characters.map((character) => character.id)).toEqual([OWNED_ID]);
  });

  it("display_order 昇順・同順位内は created_at 降順で並ぶ", async () => {
    const harness = makeRealD1();
    seedCharacter(harness.db, { id: "char-import", displayOrder: 100, createdAt: 5_000 });
    seedCharacter(harness.db, { id: "char-old", displayOrder: 0, createdAt: 1_000 });
    seedCharacter(harness.db, { id: "char-new", displayOrder: 0, createdAt: 3_000 });

    const response = await authedGet(harness, "/api/characters");

    const body: CharacterListEnvelope = JSON.parse(await response.text());
    expect(body.characters.map((character) => character.id)).toEqual([
      "char-new",
      "char-old",
      "char-import",
    ]);
  });

  it("自分の公式キャラは isOfficial: true（数値の 1 やのうて boolean）で返る", async () => {
    const harness = makeRealD1();
    seedCharacter(harness.db, { id: OWNED_ID, isOfficial: true });

    const response = await authedGet(harness, "/api/characters");

    const body: CharacterListEnvelope = JSON.parse(await response.text());
    expect(body.characters[0].isOfficial).toBe(true);
  });

  it("character_visual 行が無いキャラの visualMeta は null", async () => {
    const harness = makeRealD1();
    seedCharacter(harness.db, { id: OWNED_ID });

    const response = await authedGet(harness, "/api/characters");

    const body: CharacterListEnvelope = JSON.parse(await response.text());
    expect(body.characters[0].visualMeta).toBeNull();
  });

  it("character_visual と子テーブルから visualMeta が組み上がる", async () => {
    const harness = makeRealD1();
    seedCharacter(harness.db, { id: OWNED_ID });
    harness.db
      .prepare(
        `INSERT INTO character_visual
           (character_id, hair_color, hair_style, hair_length, eye_color, skin_tone, body_type,
            breast_size, height_band, age_apparent, updated_at)
         VALUES (?, 'black', 'bob', 'short', 'blue', 'pale', 'petite', 'small', 'petite', 19, 0)`,
      )
      .run(OWNED_ID);
    harness.db
      .prepare("INSERT INTO character_distinctive_mark (character_id, tag) VALUES (?, 'freckles')")
      .run(OWNED_ID);
    harness.db
      .prepare(
        "INSERT INTO character_default_outfit_tag (character_id, tag, ord) VALUES (?, 'bikini', 0)",
      )
      .run(OWNED_ID);
    harness.db
      .prepare(
        "INSERT INTO character_undress_progression (character_id, level, tag) VALUES (?, 'nude', 'nude')",
      )
      .run(OWNED_ID);

    const response = await authedGet(harness, "/api/characters");

    const body: CharacterListEnvelope = JSON.parse(await response.text());
    expect(body.characters[0].visualMeta).toEqual({
      hairColor: "black",
      hairStyle: "bob",
      hairLength: "short",
      eyeColor: "blue",
      skinTone: "pale",
      bodyType: "petite",
      breastSize: "small",
      heightBand: "petite",
      ageApparent: 19,
      distinctiveMarks: ["freckles"],
      defaultOutfit: ["bikini"],
      undressProgression: { nude: ["nude"] },
    });
  });

  it("キャラが0件でも 200 で空配列を返す", async () => {
    const harness = makeRealD1();

    const response = await authedGet(harness, "/api/characters");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ characters: [] });
  });
});

describe.skipIf(!DatabaseSyncCtor)("GET /api/characters/:characterId (実SQLite)", () => {
  it("認証ヘッダが無ければ 401 unauthorized", async () => {
    const harness = makeRealD1();
    seedCharacter(harness.db, { id: OWNED_ID });

    const response = await anonGet(harness, `/api/characters/${OWNED_ID}`);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });

  it("id が idSchema の上限(128文字)を超えると 400 invalid character id", async () => {
    const harness = makeRealD1();

    const response = await authedGet(harness, `/api/characters/${TOO_LONG_ID}`);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid character id" });
  });

  it("他人のキャラは 404 character not found（公式フラグ付きでも読めん）", async () => {
    const harness = makeRealD1();
    seedCharacter(harness.db, {
      id: INTRUDER_CHARACTER_ID,
      userId: INTRUDER_ID,
      isOfficial: true,
    });

    const response = await authedGet(harness, `/api/characters/${INTRUDER_CHARACTER_ID}`);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "character not found" });
  });

  it("存在せん id は 404 character not found", async () => {
    const harness = makeRealD1();

    const response = await authedGet(harness, "/api/characters/char-missing");

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "character not found" });
  });

  it("自分のキャラは 200 で返り、userId は本文へ含めない", async () => {
    const harness = makeRealD1();
    seedCharacter(harness.db, { id: OWNED_ID, name: "小春", slug: "koharu", createdAt: 4_200 });

    const response = await authedGet(harness, `/api/characters/${OWNED_ID}`);

    expect(response.status).toBe(200);
    const body: CharacterDetailEnvelope = JSON.parse(await response.text());
    expect(body.character).toEqual({
      id: OWNED_ID,
      name: "小春",
      nameReading: null,
      avatar: null,
      isOfficial: false,
      slug: "koharu",
      subAvatars: null,
      gender: null,
      userPersonaName: null,
      userPersonaGender: null,
      userPersonaPersonality: null,
      systemPrompt: `${OWNED_ID} のプロンプト`,
      visualPrompt: null,
      greeting: `${OWNED_ID} やで`,
      tags: [],
      loraModel: null,
      loraWeight: null,
      loraTriggerPrompt: null,
      createdAt: 4_200,
      visualMeta: null,
    });
    expect(body.character).not.toHaveProperty("userId");
  });
});

describe.skipIf(!DatabaseSyncCtor)("POST /api/characters (実SQLite)", () => {
  it("認証ヘッダが無ければ 401 で、行を作らない", async () => {
    const harness = makeRealD1();

    const response = await anonJson(harness, "/api/characters", "POST", validCreateBody);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(countCharacters(harness.db)).toBe(0);
  });

  it("name が空文字なら 400 で弾かれ、行を作らない", async () => {
    const harness = makeRealD1();

    const response = await authedJson(harness, "/api/characters", "POST", {
      ...validCreateBody,
      name: "",
    });

    expect(response.status).toBe(400);
    expect(countCharacters(harness.db)).toBe(0);
  });

  it("systemPrompt が無いボディは 400 で弾かれ、行を作らない", async () => {
    const harness = makeRealD1();

    const response = await authedJson(harness, "/api/characters", "POST", { name: "名前だけ" });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ success: false });
    expect(countCharacters(harness.db)).toBe(0);
  });

  it("name が上限(100文字)を超えると 400", async () => {
    const harness = makeRealD1();

    const response = await authedJson(harness, "/api/characters", "POST", {
      ...validCreateBody,
      name: "あ".repeat(101),
    });

    expect(response.status).toBe(400);
    expect(countCharacters(harness.db)).toBe(0);
  });

  it("tags が 20 件を超えると 400", async () => {
    const harness = makeRealD1();

    const response = await authedJson(harness, "/api/characters", "POST", {
      ...validCreateBody,
      tags: Array.from({ length: 21 }, (_, index) => `tag-${index}`),
    });

    expect(response.status).toBe(400);
    expect(countCharacters(harness.db)).toBe(0);
  });

  it("正常なボディは 201 で保存され、user_id は要求者・slug は名前から採番される", async () => {
    const harness = makeRealD1();

    const response = await authedJson(harness, "/api/characters", "POST", validCreateBody);

    expect(response.status).toBe(201);
    const body: CreatedCharacterEnvelope = JSON.parse(await response.text());
    expect(body.character).toEqual({
      id: expect.any(String),
      userId: OWNER_ID,
      name: "Sakura Kun",
      avatar: null,
      slug: "sakura-kun",
      gender: null,
      systemPrompt: "あんたは桜くんや。",
      visualPrompt: null,
      greeting: "よお。",
      tags: ["幼馴染"],
      userPersonaName: null,
      userPersonaGender: null,
      userPersonaPersonality: null,
      createdAt: expect.any(Number),
    });

    const stored = readCharacter(harness.db, body.character.id);
    expect(stored?.user_id).toBe(OWNER_ID);
    expect(stored?.slug).toBe("sakura-kun");
    expect(stored?.name).toBe("Sakura Kun");
  });

  it("同名で二度作ると 2 件目の slug は -2 が付いて衝突せん", async () => {
    const harness = makeRealD1();

    const first = await authedJson(harness, "/api/characters", "POST", validCreateBody);
    const second = await authedJson(harness, "/api/characters", "POST", validCreateBody);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const firstBody: CreatedCharacterEnvelope = JSON.parse(await first.text());
    const secondBody: CreatedCharacterEnvelope = JSON.parse(await second.text());
    expect(firstBody.character.slug).toBe("sakura-kun");
    expect(secondBody.character.slug).toBe("sakura-kun-2");
  });

  it("avatar に自分の userEmail prefix を持つ UUID 画像キーなら保存される", async () => {
    const harness = makeRealD1();
    const validAvatar = `${OWNER_ID}/00000000-0000-0000-0000-000000000000.png`;

    const response = await authedJson(harness, "/api/characters", "POST", {
      ...validCreateBody,
      avatar: validAvatar,
    });

    expect(response.status).toBe(201);
    const body: CreatedCharacterEnvelope = JSON.parse(await response.text());
    expect(body.character.avatar).toBe(validAvatar);
    expect(readCharacter(harness.db, body.character.id)?.avatar).toBe(validAvatar);
  });

  it("avatar が他人 prefix / 無 prefix / 不正な拡張子なら 400 で保存されん", async () => {
    const harness = makeRealD1();
    const invalidAvatars = [
      `${INTRUDER_ID}/00000000-0000-0000-0000-000000000000.png`,
      "00000000-0000-0000-0000-000000000000.png",
      `${OWNER_ID}/00000000-0000-0000-0000-000000000000.gif`,
      `${OWNER_ID}/not-uuid.png`,
    ];

    for (const avatar of invalidAvatars) {
      const response = await authedJson(harness, "/api/characters", "POST", {
        ...validCreateBody,
        avatar,
      });

      expect(response.status, avatar).toBe(400);
      expect(await response.json(), avatar).toEqual({ error: "invalid_avatar" });
    }
    expect(countCharacters(harness.db)).toBe(0);
  });

  it("他人が同じ slug を先に握っとっても衝突せず -2 へ回避する", async () => {
    const harness = makeRealD1();
    // generateUniqueSlug は user を跨いで slug の一意性を見る（slug は URL 空間で共有される）。
    seedCharacter(harness.db, {
      id: INTRUDER_CHARACTER_ID,
      userId: INTRUDER_ID,
      slug: "sakura-kun",
    });

    const response = await authedJson(harness, "/api/characters", "POST", validCreateBody);

    expect(response.status).toBe(201);
    const body: CreatedCharacterEnvelope = JSON.parse(await response.text());
    expect(body.character.slug).toBe("sakura-kun-2");
  });

  it("slug に使えん文字だけの名前でも character という既定 slug へ落ちる", async () => {
    const harness = makeRealD1();

    const response = await authedJson(harness, "/api/characters", "POST", {
      ...validCreateBody,
      name: "!!!",
    });

    const body: CreatedCharacterEnvelope = JSON.parse(await response.text());
    expect(body.character.slug).toBe("character");
  });

  it("isOfficial は作成スキーマに無いので、送っても公式にはならん", async () => {
    const harness = makeRealD1();

    const response = await authedJson(harness, "/api/characters", "POST", {
      ...validCreateBody,
      isOfficial: true,
      is_official: 1,
    });

    expect(response.status).toBe(201);
    const body: CreatedCharacterEnvelope = JSON.parse(await response.text());
    // レスポンスにも保存行にも公式フラグが立たんこと。zod が未知キーを落とす前提の担保。
    expect(body.character).not.toHaveProperty("isOfficial");
    expect(readCharacter(harness.db, body.character.id)?.is_official).toBe(0);
  });

  it("userId を送っても保存行の user_id は要求者のまま（他人名義で作れん）", async () => {
    const harness = makeRealD1();

    const response = await authedJson(harness, "/api/characters", "POST", {
      ...validCreateBody,
      userId: INTRUDER_ID,
      user_id: INTRUDER_ID,
    });

    const body: CreatedCharacterEnvelope = JSON.parse(await response.text());
    expect(readCharacter(harness.db, body.character.id)?.user_id).toBe(OWNER_ID);
  });

  it("visualMeta を添えると character_visual と子テーブルへ保存される", async () => {
    const harness = makeRealD1();

    const response = await authedJson(harness, "/api/characters", "POST", {
      ...validCreateBody,
      visualMeta: validVisualMeta,
    });

    expect(response.status).toBe(201);
    const body: CreatedCharacterEnvelope = JSON.parse(await response.text());
    const visual = harness.db
      .prepare("SELECT * FROM character_visual WHERE character_id = ?")
      .get(body.character.id) as Record<string, unknown> | undefined;
    expect(visual?.hair_color).toBe("black");
    expect(visual?.age_apparent).toBe(22);
    const outfits = harness.db
      .prepare("SELECT tag FROM character_default_outfit_tag WHERE character_id = ? ORDER BY ord")
      .all(body.character.id) as { tag: string }[];
    expect(outfits.map((row) => row.tag)).toEqual(["school_uniform", "thighhighs"]);
  });

  it("visualMeta を添えんかったら character_visual 行は作られん", async () => {
    const harness = makeRealD1();

    const response = await authedJson(harness, "/api/characters", "POST", validCreateBody);

    const body: CreatedCharacterEnvelope = JSON.parse(await response.text());
    const rows = harness.db
      .prepare("SELECT COUNT(*) AS n FROM character_visual WHERE character_id = ?")
      .get(body.character.id) as { n: number };
    expect(rows.n).toBe(0);
  });

  it("visualMeta の ageApparent が下限(15)未満なら 400 で、キャラ自体も作られん", async () => {
    const harness = makeRealD1();

    const response = await authedJson(harness, "/api/characters", "POST", {
      ...validCreateBody,
      visualMeta: { ...validVisualMeta, ageApparent: 14 },
    });

    expect(response.status).toBe(400);
    expect(countCharacters(harness.db)).toBe(0);
  });
});

describe.skipIf(!DatabaseSyncCtor)("PUT /api/characters/:characterId (実SQLite)", () => {
  it("認証ヘッダが無ければ 401 で、name を書き換えない", async () => {
    const harness = makeRealD1();
    seedCharacter(harness.db, { id: OWNED_ID, name: "元の名前" });

    const response = await anonJson(harness, `/api/characters/${OWNED_ID}`, "PUT", {
      name: "書き換え",
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(readCharacter(harness.db, OWNED_ID)?.name).toBe("元の名前");
  });

  it("id が上限(128文字)を超えると 400 invalid character id", async () => {
    const harness = makeRealD1();

    const response = await authedJson(harness, `/api/characters/${TOO_LONG_ID}`, "PUT", {
      name: "書き換え",
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid character id" });
  });

  it("loraWeight が範囲外(2超)なら 400 で、行は変わらない", async () => {
    const harness = makeRealD1();
    seedCharacter(harness.db, { id: OWNED_ID, name: "元の名前" });

    const response = await authedJson(harness, `/api/characters/${OWNED_ID}`, "PUT", {
      loraWeight: 2.5,
    });

    expect(response.status).toBe(400);
    expect(readCharacter(harness.db, OWNED_ID)?.lora_weight).toBeNull();
  });

  it("他人のキャラは 404 で、name を書き換えられない", async () => {
    const harness = makeRealD1();
    seedCharacter(harness.db, {
      id: INTRUDER_CHARACTER_ID,
      userId: INTRUDER_ID,
      name: "他人の名前",
    });

    const response = await authedJson(harness, `/api/characters/${INTRUDER_CHARACTER_ID}`, "PUT", {
      name: "乗っ取り",
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "character not found" });
    expect(readCharacter(harness.db, INTRUDER_CHARACTER_ID)?.name).toBe("他人の名前");
  });

  it("自分のキャラは 200 {ok:true} で、渡した項目だけが更新される", async () => {
    const harness = makeRealD1();
    seedCharacter(harness.db, { id: OWNED_ID, name: "元の名前" });

    const response = await authedJson(harness, `/api/characters/${OWNED_ID}`, "PUT", {
      name: "新しい名前",
      loraModel: "sakura-lora",
      loraWeight: 0.8,
      userPersona: { name: "ぼく", gender: "male", personality: "内気" },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true });
    const stored = readCharacter(harness.db, OWNED_ID);
    expect(stored?.name).toBe("新しい名前");
    expect(stored?.lora_model).toBe("sakura-lora");
    expect(stored?.lora_weight).toBe(0.8);
    expect(stored?.user_persona_name).toBe("ぼく");
    // 送ってへん項目は据え置き。
    expect(stored?.greeting).toBe(`${OWNED_ID} やで`);
  });

  it("avatar を自分の userEmail prefix キーに更新できる", async () => {
    const harness = makeRealD1();
    seedCharacter(harness.db, { id: OWNED_ID });
    const validAvatar = `${OWNER_ID}/00000000-0000-0000-0000-000000000000.png`;

    const response = await authedJson(harness, `/api/characters/${OWNED_ID}`, "PUT", {
      avatar: validAvatar,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true });
    expect(readCharacter(harness.db, OWNED_ID)?.avatar).toBe(validAvatar);
  });

  it("avatar を他人 prefix / 無 prefix / 不正な拡張子に更新しようとすると 400", async () => {
    const harness = makeRealD1();
    seedCharacter(harness.db, { id: OWNED_ID, avatar: null });
    const invalidAvatars = [
      `${INTRUDER_ID}/00000000-0000-0000-0000-000000000000.png`,
      "00000000-0000-0000-0000-000000000000.png",
      `${OWNER_ID}/00000000-0000-0000-0000-000000000000.gif`,
    ];

    for (const avatar of invalidAvatars) {
      const response = await authedJson(harness, `/api/characters/${OWNED_ID}`, "PUT", {
        avatar,
      });

      expect(response.status, avatar).toBe(400);
      expect(await response.json(), avatar).toEqual({ error: "invalid_avatar" });
    }
    expect(readCharacter(harness.db, OWNED_ID)?.avatar).toBeNull();
  });

  it("slug が既にあるキャラは name を変えても slug を作り直さん", async () => {
    const harness = makeRealD1();
    seedCharacter(harness.db, { id: OWNED_ID, slug: "koharu" });

    await authedJson(harness, `/api/characters/${OWNED_ID}`, "PUT", { name: "Renamed" });

    expect(readCharacter(harness.db, OWNED_ID)?.slug).toBe("koharu");
  });

  it("slug が null のキャラは name 更新時に slug が採番される", async () => {
    const harness = makeRealD1();
    seedCharacter(harness.db, { id: OWNED_ID, slug: null });

    await authedJson(harness, `/api/characters/${OWNED_ID}`, "PUT", { name: "Renamed Girl" });

    expect(readCharacter(harness.db, OWNED_ID)?.slug).toBe("renamed-girl");
  });

  it("isOfficial は更新スキーマに無いので、送っても公式にはならん", async () => {
    const harness = makeRealD1();
    seedCharacter(harness.db, { id: OWNED_ID });

    const response = await authedJson(harness, `/api/characters/${OWNED_ID}`, "PUT", {
      isOfficial: true,
      is_official: 1,
    });

    // 未知キーは zod に落とされ updates が空になるため UPDATE 自体が走らん。
    // それでも 200 {ok:true} を返す（成功したように見えるが何も変わらん）。
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(readCharacter(harness.db, OWNED_ID)?.is_official).toBe(0);
  });

  it("他人のキャラと同じ更新でも、自分の行だけが変わる", async () => {
    const harness = makeRealD1();
    seedCharacter(harness.db, { id: OWNED_ID, name: "自分" });
    seedCharacter(harness.db, {
      id: INTRUDER_CHARACTER_ID,
      userId: INTRUDER_ID,
      name: "他人",
    });

    await authedJson(harness, `/api/characters/${OWNED_ID}`, "PUT", { name: "更新後" });

    expect(readCharacter(harness.db, OWNED_ID)?.name).toBe("更新後");
    expect(readCharacter(harness.db, INTRUDER_CHARACTER_ID)?.name).toBe("他人");
  });
});

describe.skipIf(!DatabaseSyncCtor)(
  "PATCH /api/characters/:characterId/visual-meta (実SQLite)",
  () => {
    const countVisual = (db: DatabaseSync) =>
      (db.prepare("SELECT COUNT(*) AS n FROM character_visual").get() as { n: number }).n;

    it("認証ヘッダが無ければ 401 で、character_visual 行を作らない", async () => {
      const harness = makeRealD1();
      seedCharacter(harness.db, { id: OWNED_ID });

      const response = await anonJson(
        harness,
        `/api/characters/${OWNED_ID}/visual-meta`,
        "PATCH",
        validVisualMeta,
      );

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "unauthorized" });
      expect(countVisual(harness.db)).toBe(0);
    });

    it("id が上限(128文字)を超えると 400 invalid character id", async () => {
      const harness = makeRealD1();

      const response = await authedJson(
        harness,
        `/api/characters/${TOO_LONG_ID}/visual-meta`,
        "PATCH",
        validVisualMeta,
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid character id" });
    });

    it("hairColor が enum 外なら 400 で、行を作らない", async () => {
      const harness = makeRealD1();
      seedCharacter(harness.db, { id: OWNED_ID });

      const response = await authedJson(
        harness,
        `/api/characters/${OWNED_ID}/visual-meta`,
        "PATCH",
        { ...validVisualMeta, hairColor: "rainbow" },
      );

      expect(response.status).toBe(400);
      expect(countVisual(harness.db)).toBe(0);
    });

    it("他人のキャラは 404 で、外見を書き込めない", async () => {
      const harness = makeRealD1();
      seedCharacter(harness.db, { id: INTRUDER_CHARACTER_ID, userId: INTRUDER_ID });

      const response = await authedJson(
        harness,
        `/api/characters/${INTRUDER_CHARACTER_ID}/visual-meta`,
        "PATCH",
        validVisualMeta,
      );

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "character not found" });
      expect(countVisual(harness.db)).toBe(0);
    });

    it("自分のキャラなら 200 {ok:true} で、子テーブルまで保存される", async () => {
      const harness = makeRealD1();
      seedCharacter(harness.db, { id: OWNED_ID });

      const response = await authedJson(
        harness,
        `/api/characters/${OWNED_ID}/visual-meta`,
        "PATCH",
        validVisualMeta,
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
      const visual = harness.db
        .prepare("SELECT * FROM character_visual WHERE character_id = ?")
        .get(OWNED_ID) as Record<string, unknown> | undefined;
      expect(visual?.eye_color).toBe("brown");
      const marks = harness.db
        .prepare("SELECT tag FROM character_distinctive_mark WHERE character_id = ?")
        .all(OWNED_ID) as { tag: string }[];
      expect(marks.map((row) => row.tag)).toEqual(["mole_under_eye"]);
      const undress = harness.db
        .prepare("SELECT level, tag FROM character_undress_progression WHERE character_id = ?")
        .all(OWNED_ID) as { level: string; tag: string }[];
      expect(undress).toEqual([{ level: "topless", tag: "thighhighs" }]);
    });

    it("再送すると子テーブルは洗い替えになり、古いタグが残らん", async () => {
      const harness = makeRealD1();
      seedCharacter(harness.db, { id: OWNED_ID });

      await authedJson(
        harness,
        `/api/characters/${OWNED_ID}/visual-meta`,
        "PATCH",
        validVisualMeta,
      );
      await authedJson(harness, `/api/characters/${OWNED_ID}/visual-meta`, "PATCH", {
        ...validVisualMeta,
        distinctiveMarks: ["scar"],
        defaultOutfit: ["bikini"],
        undressProgression: {},
      });

      const marks = harness.db
        .prepare("SELECT tag FROM character_distinctive_mark WHERE character_id = ?")
        .all(OWNED_ID) as { tag: string }[];
      expect(marks.map((row) => row.tag)).toEqual(["scar"]);
      const outfits = harness.db
        .prepare("SELECT tag FROM character_default_outfit_tag WHERE character_id = ?")
        .all(OWNED_ID) as { tag: string }[];
      expect(outfits.map((row) => row.tag)).toEqual(["bikini"]);
      const undress = harness.db
        .prepare("SELECT COUNT(*) AS n FROM character_undress_progression WHERE character_id = ?")
        .get(OWNED_ID) as { n: number };
      expect(undress.n).toBe(0);
      // upsert なので character_visual は増えず1行のまま。
      expect(countVisual(harness.db)).toBe(1);
    });

    it("語彙に無い衣装タグは sanitizeOutfitTags に落とされ、保存されん", async () => {
      const harness = makeRealD1();
      seedCharacter(harness.db, { id: OWNED_ID });

      await authedJson(harness, `/api/characters/${OWNED_ID}/visual-meta`, "PATCH", {
        ...validVisualMeta,
        defaultOutfit: ["bikini", "きらきらの謎衣装"],
      });

      const outfits = harness.db
        .prepare("SELECT tag FROM character_default_outfit_tag WHERE character_id = ?")
        .all(OWNED_ID) as { tag: string }[];
      expect(outfits.map((row) => row.tag)).toEqual(["bikini"]);
    });
  },
);

describe.skipIf(!DatabaseSyncCtor)("DELETE /api/characters/:characterId (実SQLite)", () => {
  it("認証ヘッダが無ければ 401 で、行は残る", async () => {
    const harness = makeRealD1();
    seedCharacter(harness.db, { id: OWNED_ID });

    const response = await request(harness, `/api/characters/${OWNED_ID}`, {
      method: "DELETE",
      headers: HOST_HEADER,
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(readCharacter(harness.db, OWNED_ID)).toBeDefined();
  });

  it("id が上限(128文字)を超えると 400 invalid character id", async () => {
    const harness = makeRealD1();

    const response = await request(harness, `/api/characters/${TOO_LONG_ID}`, {
      method: "DELETE",
      headers: AUTH_HEADERS,
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid character id" });
  });

  it("会話で使用中なら 409 で削除されない", async () => {
    const harness = makeRealD1();
    seedCharacter(harness.db, { id: OWNED_ID });
    harness.db
      .prepare(
        "INSERT INTO conversation (id, user_id, character_id, title) VALUES ('conv-1', ?, ?, '会話')",
      )
      .run(OWNER_ID, OWNED_ID);

    const response = await request(harness, `/api/characters/${OWNED_ID}`, {
      method: "DELETE",
      headers: AUTH_HEADERS,
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "character is in use by conversations" });
    expect(readCharacter(harness.db, OWNED_ID)).toBeDefined();
  });

  it("他人の会話で使われとっても自分側の判定には影響せず、削除は所有権で止まる", async () => {
    const harness = makeRealD1();
    seedCharacter(harness.db, { id: INTRUDER_CHARACTER_ID, userId: INTRUDER_ID });
    harness.db
      .prepare(
        "INSERT INTO conversation (id, user_id, character_id, title) VALUES ('conv-other', ?, ?, '他人の会話')",
      )
      .run(INTRUDER_ID, INTRUDER_CHARACTER_ID);

    const response = await request(harness, `/api/characters/${INTRUDER_CHARACTER_ID}`, {
      method: "DELETE",
      headers: AUTH_HEADERS,
    });

    // DELETE は冪等設計で 200 を返すが、他人の行が残っとることが所有権の担保。
    // 409 やのうて 200 になるのは inUse 判定も user_id で絞っとるため。
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(readCharacter(harness.db, INTRUDER_CHARACTER_ID)).toBeDefined();
  });

  it("自分のキャラは 200 {ok:true} で実際に消え、他の行を巻き込まん", async () => {
    const harness = makeRealD1();
    seedCharacter(harness.db, { id: OWNED_ID });
    seedCharacter(harness.db, { id: "char-keep" });

    const response = await request(harness, `/api/characters/${OWNED_ID}`, {
      method: "DELETE",
      headers: AUTH_HEADERS,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(readCharacter(harness.db, OWNED_ID)).toBeUndefined();
    expect(readCharacter(harness.db, "char-keep")).toBeDefined();
  });

  it("存在せん id でも 200 {ok:true}（冪等 DELETE）", async () => {
    const harness = makeRealD1();

    const response = await request(harness, "/api/characters/char-missing", {
      method: "DELETE",
      headers: AUTH_HEADERS,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });
});

describe.skipIf(!DatabaseSyncCtor)(
  "POST /api/characters/:characterId/sub-avatars (実SQLite)",
  () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    const subAvatarsOf = (db: DatabaseSync, id: string) => {
      const raw = readCharacter(db, id)?.sub_avatars;
      return typeof raw === "string" ? (JSON.parse(raw) as string[]) : raw;
    };

    it("認証ヘッダが無ければ 401 で、画像を取りにいかん", async () => {
      const harness = makeRealD1();
      seedCharacter(harness.db, { id: OWNED_ID });
      const fetchMock = stubFetch(pngResponse(16));

      const response = await anonJson(harness, `/api/characters/${OWNED_ID}/sub-avatars`, "POST", {
        imageUrl: ALLOWED_IMAGE_URL,
      });

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "unauthorized" });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(harness.put).not.toHaveBeenCalled();
    });

    it("id が上限(128文字)を超えると 400 invalid character id", async () => {
      const harness = makeRealD1();

      const response = await authedJson(
        harness,
        `/api/characters/${TOO_LONG_ID}/sub-avatars`,
        "POST",
        { imageUrl: ALLOWED_IMAGE_URL },
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid character id" });
    });

    it("imageUrl が無いボディは 400 imageUrl required", async () => {
      const harness = makeRealD1();
      seedCharacter(harness.db, { id: OWNED_ID });

      const response = await authedJson(
        harness,
        `/api/characters/${OWNED_ID}/sub-avatars`,
        "POST",
        {
          notImageUrl: ALLOWED_IMAGE_URL,
        },
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "imageUrl required" });
    });

    it("imageUrl が文字列やない（数値）なら 400 imageUrl required", async () => {
      const harness = makeRealD1();
      seedCharacter(harness.db, { id: OWNED_ID });

      const response = await authedJson(
        harness,
        `/api/characters/${OWNED_ID}/sub-avatars`,
        "POST",
        {
          imageUrl: 12_345,
        },
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "imageUrl required" });
    });

    it("file: スキームは 400 disallowed image source scheme で、fetch されん（SSRF ガード）", async () => {
      const harness = makeRealD1();
      seedCharacter(harness.db, { id: OWNED_ID });
      const fetchMock = stubFetch(pngResponse(16));

      const response = await authedJson(
        harness,
        `/api/characters/${OWNED_ID}/sub-avatars`,
        "POST",
        {
          imageUrl: "file:///etc/passwd",
        },
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "disallowed image source scheme" });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("メタデータサービス(169.254.169.254)は 400 disallowed image source で、fetch されん", async () => {
      const harness = makeRealD1();
      seedCharacter(harness.db, { id: OWNED_ID });
      const fetchMock = stubFetch(pngResponse(16));

      const response = await authedJson(
        harness,
        `/api/characters/${OWNED_ID}/sub-avatars`,
        "POST",
        {
          imageUrl: "http://169.254.169.254/latest/meta-data/iam/security-credentials/",
        },
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "disallowed image source" });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("許可ホストのサブドメイン偽装(image.novita.ai.evil.test)は 400 で通らん", async () => {
      const harness = makeRealD1();
      seedCharacter(harness.db, { id: OWNED_ID });
      const fetchMock = stubFetch(pngResponse(16));

      const response = await authedJson(
        harness,
        `/api/characters/${OWNED_ID}/sub-avatars`,
        "POST",
        {
          imageUrl: "https://image.novita.ai.evil.test/pose.png",
        },
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "disallowed image source" });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("URL として解釈できん文字列は 400 disallowed image source", async () => {
      const harness = makeRealD1();
      seedCharacter(harness.db, { id: OWNED_ID });

      const response = await authedJson(
        harness,
        `/api/characters/${OWNED_ID}/sub-avatars`,
        "POST",
        {
          imageUrl: "not a url",
        },
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "disallowed image source" });
    });

    it("MOCK_API_BASE 無しでは localhost も許可されん（本番設定での SSRF 阻止）", async () => {
      const harness = makeRealD1();
      seedCharacter(harness.db, { id: OWNED_ID });
      const fetchMock = stubFetch(pngResponse(16));

      const response = await authedJson(
        harness,
        `/api/characters/${OWNED_ID}/sub-avatars`,
        "POST",
        {
          imageUrl: "http://127.0.0.1:8080/internal.png",
        },
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "disallowed image source" });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("他人のキャラへは 404 で、画像を取りにも R2 へ書きにもいかん", async () => {
      const harness = makeRealD1();
      seedCharacter(harness.db, {
        id: INTRUDER_CHARACTER_ID,
        userId: INTRUDER_ID,
        subAvatars: ["sub/existing.png"],
      });
      const fetchMock = stubFetch(pngResponse(16));

      const response = await authedJson(
        harness,
        `/api/characters/${INTRUDER_CHARACTER_ID}/sub-avatars`,
        "POST",
        { imageUrl: ALLOWED_IMAGE_URL },
      );

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "character not found" });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(harness.put).not.toHaveBeenCalled();
      expect(subAvatarsOf(harness.db, INTRUDER_CHARACTER_ID)).toEqual(["sub/existing.png"]);
    });

    it("画像の取得に失敗したら 502 failed to fetch image", async () => {
      const harness = makeRealD1();
      seedCharacter(harness.db, { id: OWNED_ID });
      stubFetch(() => new Response("nope", { status: 404 }));

      const response = await authedJson(
        harness,
        `/api/characters/${OWNED_ID}/sub-avatars`,
        "POST",
        {
          imageUrl: ALLOWED_IMAGE_URL,
        },
      );

      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({ error: "failed to fetch image" });
      expect(harness.put).not.toHaveBeenCalled();
    });

    it("許可外の content-type は 400 unsupported content type", async () => {
      const harness = makeRealD1();
      seedCharacter(harness.db, { id: OWNED_ID });
      stubFetch(() => new Response("GIF", { headers: { "content-type": "image/gif" } }));

      const response = await authedJson(
        harness,
        `/api/characters/${OWNED_ID}/sub-avatars`,
        "POST",
        {
          imageUrl: "https://image.novita.ai/generated/pose.gif",
        },
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "unsupported content type" });
      expect(harness.put).not.toHaveBeenCalled();
    });

    it("application/octet-stream でも URL 拡張子が .png なら通る", async () => {
      const harness = makeRealD1();
      seedCharacter(harness.db, { id: OWNED_ID });
      stubFetch(
        () =>
          new Response(new Uint8Array(8), {
            headers: { "content-type": "application/octet-stream" },
          }),
      );

      const response = await authedJson(
        harness,
        `/api/characters/${OWNED_ID}/sub-avatars`,
        "POST",
        {
          imageUrl: ALLOWED_IMAGE_URL,
        },
      );

      expect(response.status).toBe(200);
      expect(harness.put).toHaveBeenCalledWith(expect.stringMatching(/\.png$/), expect.anything(), {
        httpMetadata: { contentType: "image/png" },
      });
    });

    it("MAX_R2_IMAGE_SIZE_BYTES を1バイト超えると 413 で、R2 にも DB にも書かん", async () => {
      const harness = makeRealD1();
      seedCharacter(harness.db, { id: OWNED_ID });
      stubFetch(pngResponse(MAX_R2_IMAGE_SIZE_BYTES + 1));

      const response = await authedJson(
        harness,
        `/api/characters/${OWNED_ID}/sub-avatars`,
        "POST",
        {
          imageUrl: ALLOWED_IMAGE_URL,
        },
      );

      expect(response.status).toBe(413);
      expect(await response.json()).toEqual({ error: "image too large" });
      expect(harness.put).not.toHaveBeenCalled();
      expect(subAvatarsOf(harness.db, OWNED_ID)).toBeNull();
    });

    it("上限ちょうど(10MB)は通る（境界が < やのうて <= 側）", async () => {
      const harness = makeRealD1();
      seedCharacter(harness.db, { id: OWNED_ID });
      stubFetch(pngResponse(MAX_R2_IMAGE_SIZE_BYTES));

      const response = await authedJson(
        harness,
        `/api/characters/${OWNED_ID}/sub-avatars`,
        "POST",
        {
          imageUrl: ALLOWED_IMAGE_URL,
        },
      );

      expect(response.status).toBe(200);
      expect(harness.put).toHaveBeenCalledTimes(1);
    });

    it("成功したら 200 {subKey} を返し、R2 キーと sub_avatars の追記が一致する", async () => {
      const harness = makeRealD1();
      seedCharacter(harness.db, { id: OWNED_ID });
      stubFetch(pngResponse(32));

      const response = await authedJson(
        harness,
        `/api/characters/${OWNED_ID}/sub-avatars`,
        "POST",
        {
          imageUrl: ALLOWED_IMAGE_URL,
        },
      );

      expect(response.status).toBe(200);
      const body: SubAvatarEnvelope = JSON.parse(await response.text());
      expect(body.subKey).toMatch(new RegExp(`^sub/${OWNED_ID}/[0-9a-f-]{36}\\.png$`, "i"));
      expect(harness.put).toHaveBeenCalledWith(`avatars/${body.subKey}`, expect.anything(), {
        httpMetadata: { contentType: "image/png" },
      });
      expect(subAvatarsOf(harness.db, OWNED_ID)).toEqual([body.subKey]);
    });

    it("二回目は json_insert で既存配列へ追記され、上書きにならん", async () => {
      const harness = makeRealD1();
      seedCharacter(harness.db, { id: OWNED_ID, subAvatars: ["sub/existing.png"] });
      stubFetch(pngResponse(32));

      const first = await authedJson(harness, `/api/characters/${OWNED_ID}/sub-avatars`, "POST", {
        imageUrl: ALLOWED_IMAGE_URL,
      });
      const second = await authedJson(harness, `/api/characters/${OWNED_ID}/sub-avatars`, "POST", {
        imageUrl: ALLOWED_IMAGE_URL,
      });

      const firstBody: SubAvatarEnvelope = JSON.parse(await first.text());
      const secondBody: SubAvatarEnvelope = JSON.parse(await second.text());
      expect(subAvatarsOf(harness.db, OWNED_ID)).toEqual([
        "sub/existing.png",
        firstBody.subKey,
        secondBody.subKey,
      ]);
    });

    // ※ 現状の挙動を固定しとる。他エンドポイントは zValidator が 400 を返すのに、
    // ここだけ c.req.json() の生パースなので JSON 壊れボディが onError で 500 になる。
    it("JSON として壊れたボディは 400 やのうて 500 internal_error になる（既存の食い違い）", async () => {
      const harness = makeRealD1();
      seedCharacter(harness.db, { id: OWNED_ID });

      const response = await request(harness, `/api/characters/${OWNED_ID}/sub-avatars`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: "{ not json",
      });

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "internal_error" });
    });
  },
);

describe.skipIf(!DatabaseSyncCtor)("GET /api/characters/:characterId/sub-images (実SQLite)", () => {
  const seedSubImage = (
    db: DatabaseSync,
    seed: { characterId: string; r2Key: string; ord?: number; archivedAt?: number | null },
  ) => {
    db.prepare(
      "INSERT INTO character_sub_image (character_id, r2_key, ord, archived_at) VALUES (?, ?, ?, ?)",
    ).run(seed.characterId, seed.r2Key, seed.ord ?? 0, seed.archivedAt ?? null);
  };

  it("認証ヘッダが無ければ 401 unauthorized", async () => {
    const harness = makeRealD1();
    seedCharacter(harness.db, { id: OWNED_ID });

    const response = await anonGet(harness, `/api/characters/${OWNED_ID}/sub-images`);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });

  it("id が上限(128文字)を超えると 400 invalid character id", async () => {
    const harness = makeRealD1();

    const response = await authedGet(harness, `/api/characters/${TOO_LONG_ID}/sub-images`);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid character id" });
  });

  it("他人のキャラのサブ画像は 404 で、キーを一切返さん", async () => {
    const harness = makeRealD1();
    seedCharacter(harness.db, { id: INTRUDER_CHARACTER_ID, userId: INTRUDER_ID });
    seedSubImage(harness.db, {
      characterId: INTRUDER_CHARACTER_ID,
      r2Key: "sub/secret/leak.png",
    });

    const response = await authedGet(
      harness,
      `/api/characters/${INTRUDER_CHARACTER_ID}/sub-images`,
    );

    expect(response.status).toBe(404);
    const raw = await response.text();
    expect(JSON.parse(raw)).toEqual({ error: "character not found" });
    // 404 の本文に他人の R2 キーが混ざっとらんこと。
    expect(raw).not.toContain("leak.png");
  });

  it("存在せんキャラも 404 character not found", async () => {
    const harness = makeRealD1();

    const response = await authedGet(harness, "/api/characters/char-missing/sub-images");

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "character not found" });
  });

  it("自分のキャラなら ord 昇順で返り、アーカイブ済みは出さん", async () => {
    const harness = makeRealD1();
    seedCharacter(harness.db, { id: OWNED_ID });
    seedSubImage(harness.db, { characterId: OWNED_ID, r2Key: "sub/b.png", ord: 2 });
    seedSubImage(harness.db, { characterId: OWNED_ID, r2Key: "sub/a.png", ord: 1 });
    seedSubImage(harness.db, {
      characterId: OWNED_ID,
      r2Key: "sub/archived.png",
      ord: 0,
      archivedAt: 1_700_000_000,
    });

    const response = await authedGet(harness, `/api/characters/${OWNED_ID}/sub-images`);

    expect(response.status).toBe(200);
    const body: SubImagesEnvelope = JSON.parse(await response.text());
    expect(body).toEqual({
      images: [
        { url: "/api/image/r2/sub/a.png", r2Key: "sub/a.png", ord: 1 },
        { url: "/api/image/r2/sub/b.png", r2Key: "sub/b.png", ord: 2 },
      ],
    });
  });

  it("サブ画像が無ければ 200 で空配列", async () => {
    const harness = makeRealD1();
    seedCharacter(harness.db, { id: OWNED_ID });

    const response = await authedGet(harness, `/api/characters/${OWNED_ID}/sub-images`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ images: [] });
  });
});

describe.skipIf(!DatabaseSyncCtor)("GET /api/character/:id/gallery (実SQLite)", () => {
  it("認証ヘッダが無ければ 401 unauthorized", async () => {
    const harness = makeRealD1();
    seedCharacter(harness.db, { id: OWNED_ID });
    seedMessage(harness.db, { id: "msg-1", createdAt: 100 });

    const response = await anonGet(harness, `/api/character/${OWNED_ID}/gallery`);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });

  it("id が上限(128文字)を超えると 400 invalid character id", async () => {
    const harness = makeRealD1();

    const response = await authedGet(harness, `/api/character/${TOO_LONG_ID}/gallery`);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid character id" });
  });

  it("limit が 0 なら 400（クエリスキーマ違反）", async () => {
    const harness = makeRealD1();

    const response = await authedGet(harness, `/api/character/${OWNED_ID}/gallery?limit=0`);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ success: false });
  });

  it("limit が上限(100)を超えると 400", async () => {
    const harness = makeRealD1();

    const response = await authedGet(harness, `/api/character/${OWNED_ID}/gallery?limit=101`);

    expect(response.status).toBe(400);
  });

  it("limit が数値やなければ 400", async () => {
    const harness = makeRealD1();

    const response = await authedGet(harness, `/api/character/${OWNED_ID}/gallery?limit=abc`);

    expect(response.status).toBe(400);
  });

  it("limit が小数なら 400（int 制約）", async () => {
    const harness = makeRealD1();

    const response = await authedGet(harness, `/api/character/${OWNED_ID}/gallery?limit=1.5`);

    expect(response.status).toBe(400);
  });

  it("cursor が 0 や負数なら 400（positive 制約）", async () => {
    const harness = makeRealD1();

    const zero = await authedGet(harness, `/api/character/${OWNED_ID}/gallery?cursor=0`);
    const negative = await authedGet(harness, `/api/character/${OWNED_ID}/gallery?cursor=-1`);

    expect(zero.status).toBe(400);
    expect(negative.status).toBe(400);
  });

  // クエリ検証は id 検証より前に走る。壊れた id + 壊れた limit は id エラーやのうて zod の 400。
  it("id もクエリも不正なときはクエリ検証が先に落ちる", async () => {
    const harness = makeRealD1();

    const response = await authedGet(harness, `/api/character/${TOO_LONG_ID}/gallery?limit=0`);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ success: false });
  });

  it("画像付きメッセージだけを created_at 降順の snake_case で返す", async () => {
    const harness = makeRealD1();
    seedCharacter(harness.db, { id: OWNED_ID });
    seedMessage(harness.db, { id: "msg-old", createdAt: 100 });
    seedMessage(harness.db, { id: "msg-new", createdAt: 300 });
    seedMessage(harness.db, { id: "msg-noimage", imageUrl: null, createdAt: 400 });

    const response = await authedGet(harness, `/api/character/${OWNED_ID}/gallery`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      items: [
        {
          image_url: "https://cdn.example.com/msg-new.png",
          created_at: 300,
          message_id: "msg-new",
          conversation_id: "conv-1",
        },
        {
          image_url: "https://cdn.example.com/msg-old.png",
          created_at: 100,
          message_id: "msg-old",
          conversation_id: "conv-1",
        },
      ],
      next_cursor: null,
    });
  });

  it("他人の user_id のメッセージは同じ character_id でも混ざらん", async () => {
    const harness = makeRealD1();
    seedCharacter(harness.db, { id: OWNED_ID });
    seedMessage(harness.db, { id: "msg-mine", createdAt: 100 });
    seedMessage(harness.db, { id: "msg-theirs", userId: INTRUDER_ID, createdAt: 900 });

    const response = await authedGet(harness, `/api/character/${OWNED_ID}/gallery`);

    const body: GalleryEnvelope = JSON.parse(await response.text());
    expect(body.items.map((item) => item.message_id)).toEqual(["msg-mine"]);
  });

  it("別キャラのメッセージは返らん", async () => {
    const harness = makeRealD1();
    seedCharacter(harness.db, { id: OWNED_ID });
    seedMessage(harness.db, { id: "msg-target", createdAt: 100 });
    seedMessage(harness.db, { id: "msg-other-char", characterId: "char-another", createdAt: 200 });

    const response = await authedGet(harness, `/api/character/${OWNED_ID}/gallery`);

    const body: GalleryEnvelope = JSON.parse(await response.text());
    expect(body.items.map((item) => item.message_id)).toEqual(["msg-target"]);
  });

  // ※ 現状の挙動を固定しとる。gallery は validateCharacterOwnership を通さず
  // message.user_id だけで絞る。他人のキャラ ID を渡しても 404 やのうて 200 空配列。
  // 画像自体は漏れんが、「そのキャラの画像を自分が持っとるか」は分かる。
  it("他人のキャラ ID でも 404 やのうて 200 空配列を返す", async () => {
    const harness = makeRealD1();
    seedCharacter(harness.db, { id: INTRUDER_CHARACTER_ID, userId: INTRUDER_ID });
    seedMessage(harness.db, {
      id: "msg-theirs",
      userId: INTRUDER_ID,
      characterId: INTRUDER_CHARACTER_ID,
      createdAt: 100,
    });

    const response = await authedGet(harness, `/api/character/${INTRUDER_CHARACTER_ID}/gallery`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ items: [], next_cursor: null });
  });

  it("limit を超える件数があると next_cursor で続きが取れ、最後のページで null になる", async () => {
    const harness = makeRealD1();
    seedCharacter(harness.db, { id: OWNED_ID });
    seedMessage(harness.db, { id: "msg-1", createdAt: 100 });
    seedMessage(harness.db, { id: "msg-2", createdAt: 200 });
    seedMessage(harness.db, { id: "msg-3", createdAt: 300 });

    const first = await authedGet(harness, `/api/character/${OWNED_ID}/gallery?limit=2`);
    const firstBody: GalleryEnvelope = JSON.parse(await first.text());
    expect(firstBody.items.map((item) => item.message_id)).toEqual(["msg-3", "msg-2"]);
    expect(firstBody.next_cursor).toBe(200);

    const second = await authedGet(
      harness,
      `/api/character/${OWNED_ID}/gallery?limit=2&cursor=${firstBody.next_cursor}`,
    );
    const secondBody: GalleryEnvelope = JSON.parse(await second.text());
    expect(secondBody.items.map((item) => item.message_id)).toEqual(["msg-1"]);
    expect(secondBody.next_cursor).toBeNull();
  });

  it("ちょうど limit 件のときは next_cursor が null（余計な1ページを出さん）", async () => {
    const harness = makeRealD1();
    seedCharacter(harness.db, { id: OWNED_ID });
    seedMessage(harness.db, { id: "msg-1", createdAt: 100 });
    seedMessage(harness.db, { id: "msg-2", createdAt: 200 });

    const response = await authedGet(harness, `/api/character/${OWNED_ID}/gallery?limit=2`);

    const body: GalleryEnvelope = JSON.parse(await response.text());
    expect(body.items).toHaveLength(2);
    expect(body.next_cursor).toBeNull();
  });
});
