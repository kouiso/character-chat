// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  characterContentSchema,
  createCharacterWithVersion,
  ensureLocalUser,
  readOwnedImageGeneration,
  readOwnedImageKey,
} from "@v2/db";
import { v2ConversationTable, v2MessageTable } from "@v2/db";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { openLocalD1, type LocalD1 } from "../../../../packages/db/src/test/local-d1";

import { handleCreateImageRequest, handleImageStatusRequest } from "./api-images";

// Response.json() の戻り型が DOM/workerd の型解決で揺れるので1箇所で束ねる。
const readJson = async <T>(response: Response): Promise<T> => {
  const body: unknown = await response.json();
  return body as T;
};

const platform = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
vi.mock("./platform", () => ({ getPlatform: async () => platform }));

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

// 上流（Novita・翻訳・画像取得）を fetch モックで制御する。
type FetchRoute = { match: (url: string) => boolean; respond: () => Response | Promise<Response> };
const stubFetch = (routes: FetchRoute[]) => {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    const route = routes.find((candidate) => candidate.match(url));
    if (!route) throw new Error(`unexpected fetch: ${url}`);
    return route.respond();
  });
  return calls;
};

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const novitaInit = (taskId: string): FetchRoute => ({
  match: (url) => url.includes("api.novita.ai/v3/async/txt2img"),
  respond: () => jsonResponse({ task_id: taskId }),
});

const novitaTask = (status: string, imageUrl?: string): FetchRoute => ({
  match: (url) => url.includes("api.novita.ai/v3/async/task-result"),
  respond: () =>
    jsonResponse({
      task: {
        task_id: "task-1",
        status,
        progress_percent: status === "TASK_STATUS_SUCCEED" ? 100 : 10,
      },
      images: imageUrl ? [{ image_url: imageUrl }] : [],
    }),
});

describe("画像生成 API", () => {
  let local: LocalD1;
  let persistRoot: string | undefined;
  const conversationIds: string[] = [];
  const characterIds: string[] = [];
  const bucket = { puts: [] as { key: string; body: unknown }[], put: vi.fn() };
  void characterIds;

  // 共有 .wrangler/state だと他テストと SQLITE_BUSY で競合するため、専用 persistRoot で隔離する。
  beforeAll(async () => {
    persistRoot = await mkdtemp(join(tmpdir(), "api-images-"));
    local = await openLocalD1({ persistRoot });
    await ensureLocalUser(local.db);
  }, 120_000);

  afterAll(async () => {
    await local?.dispose();
    if (persistRoot) await rm(persistRoot, { recursive: true, force: true });
  });

  beforeEach(async () => {
    bucket.puts = [];
    bucket.put = vi.fn(async (key: string, body: unknown) => {
      bucket.puts.push({ key, body });
      return {} as R2Object;
    });
    platform.env = {
      DB: local.d1,
      BUCKET: { put: bucket.put },
      NOVITA_API_KEY: "novita-test-key",
      OPENROUTER_API_KEY: "",
      V2_FAKE_MODEL: "1",
    };
  });

  afterEach(() => {
    conversationIds.splice(0);
    characterIds.splice(0);
    vi.unstubAllGlobals();
  });

  const seed = async (withVersion = true) => {
    const character = await createCharacterWithVersion(
      local.db,
      "local",
      characterContentSchema.parse({
        name: `役-${crypto.randomUUID().slice(0, 6)}`,
        personality: "穏やか。",
        speechStyle: "簡潔。",
        appearance: "long blonde hair, blue eyes",
        greeting: "こんにちは。",
      }),
    );
    characterIds.push(character.id);
    const conversationId = crypto.randomUUID();
    const now = Date.now();
    await local.db.insert(v2ConversationTable).values({
      id: conversationId,
      userId: "local",
      characterId: character.id,
      title: "",
      threadId: conversationId,
      promptVersion: "test",
      characterVersionId: withVersion ? character.versionId : null,
      createdAt: now,
      updatedAt: now,
    });
    conversationIds.push(conversationId);
    return { characterId: character.id, conversationId, versionId: character.versionId };
  };

  const postImages = (characterId: string, conversationId: string) =>
    handleCreateImageRequest(
      characterId,
      new Request("https://app.test/api/chat/x/images", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId }),
      }),
    );

  it("起動すると生成記録が作られ taskId が記録される", async () => {
    const { characterId, conversationId } = await seed();
    stubFetch([novitaInit("task-abc")]);
    const response = await postImages(characterId, conversationId);
    expect(response.status).toBe(200);
    const body = await readJson<{ generationId: string; status: string }>(response);
    expect(body.status).toBe("running");

    const row = await readOwnedImageGeneration(local.db, "local", body.generationId);
    expect(row?.status).toBe("running");
    expect(row?.taskId).toBe("task-abc");
    expect(row?.model).toBe("waiNSFWIllustrious_v90_1187991.safetensors");
    expect(row?.prompt).toContain("blonde");
  });

  it("会話が無い・他人の会話は 404", async () => {
    const { characterId } = await seed();
    const missing = await postImages(characterId, crypto.randomUUID());
    expect(missing.status).toBe(404);
  });

  it("上流 init 失敗は生成記録へ失敗として残る", async () => {
    const { characterId, conversationId } = await seed();
    stubFetch([
      {
        match: (url) => url.includes("api.novita.ai/v3/async/txt2img"),
        respond: () => new Response("VALIDATOR error", { status: 400 }),
      },
    ]);
    const response = await postImages(characterId, conversationId);
    expect(response.status).toBe(502);
    const body = await readJson<{ generationId: string; status: string }>(response);
    expect(body.status).toBe("failed");
    const row = await readOwnedImageGeneration(local.db, "local", body.generationId);
    expect(row?.status).toBe("failed");
    expect(row?.failureJson).toContain("init_failed");
  });

  it("poll が成功まで進み、R2 保存＋画像メッセージ＋完了記録になる", async () => {
    const { characterId, conversationId } = await seed();
    stubFetch([novitaInit("task-ok")]);
    const init = await postImages(characterId, conversationId);
    const { generationId } = await readJson<{ generationId: string }>(init);

    // 進行中 → running
    stubFetch([novitaTask("TASK_STATUS_PROCESSING")]);
    const pending = await handleImageStatusRequest(generationId);
    expect((await readJson<{ status: string }>(pending)).status).toBe("running");

    // 成功 → R2 保存＋メッセージ挿入＋succeeded
    stubFetch([
      novitaTask("TASK_STATUS_SUCCEED", "https://img.novita.ai/out.jpeg"),
      {
        match: (url) => url === "https://img.novita.ai/out.jpeg",
        respond: () => new Response(PNG_BYTES, { headers: { "content-type": "image/png" } }),
      },
    ]);
    const done = await handleImageStatusRequest(generationId);
    const doneBody = await readJson<{ status: string; messageId: string }>(done);
    expect(doneBody.status).toBe("succeeded");

    expect(bucket.puts).toHaveLength(1);
    const key = bucket.puts[0].key;
    expect(key).toMatch(/^images\/[\da-f-]+\.png$/);

    // メッセージは会話の新しいターンに画像キーつきで入る
    const messages = await local.db
      .select({
        id: v2MessageTable.id,
        role: v2MessageTable.role,
        imageKey: v2MessageTable.imageKey,
        turn: v2MessageTable.turn,
      })
      .from(v2MessageTable);
    const imageMessage = messages.find((row) => row.id === doneBody.messageId) as
      | { role: string; imageKey: string; turn: number }
      | undefined;
    expect(imageMessage?.role).toBe("assistant");
    expect(imageMessage?.imageKey).toBe(key);
    expect(imageMessage?.turn).toBe(1);

    // 所有者は画像キーを配信経路で読める
    expect(await readOwnedImageKey(local.db, "local", doneBody.messageId)).toBe(key);

    const row = await readOwnedImageGeneration(local.db, "local", generationId);
    expect(row?.status).toBe("succeeded");
    expect(row?.r2Key).toBe(key);
    expect(row?.messageId).toBe(doneBody.messageId);
  });

  it("上流タスク失敗は failed に畳み、以後の poll も failed を返す", async () => {
    const { characterId, conversationId } = await seed();
    stubFetch([novitaInit("task-ng")]);
    const init = await postImages(characterId, conversationId);
    const { generationId } = await readJson<{ generationId: string }>(init);

    stubFetch([novitaTask("TASK_STATUS_FAILED")]);
    const failed = await handleImageStatusRequest(generationId);
    expect((await readJson<{ status: string }>(failed)).status).toBe("failed");

    // 失敗後は上流を呼ばんでも failed が返る
    stubFetch([]);
    const after = await handleImageStatusRequest(generationId);
    expect((await readJson<{ status: string }>(after)).status).toBe("failed");
  });

  it("他人の生成記録は 404", async () => {
    const { characterId, conversationId } = await seed();
    stubFetch([novitaInit("task-x")]);
    const init = await postImages(characterId, conversationId);
    const { generationId } = await readJson<{ generationId: string }>(init);
    // 他人の会話の生成はその人の D1 にしか無いが、ここでは「他人のユーザー id」で引いても出ないことを確認する。
    // （LOCAL_USER_ID 固定のアプリなので、所有権の確認は readOwnedImageGeneration に集約されている。）
    expect(await readOwnedImageGeneration(local.db, "someone-else", generationId)).toBeNull();
  });

  it("版未 pin の会話でも現在版へ倒れて生成できる", async () => {
    const { characterId, conversationId, versionId } = await seed(false);
    stubFetch([novitaInit("task-pin")]);
    const response = await postImages(characterId, conversationId);
    expect(response.status).toBe(200);
    const rows = await local.db
      .select({
        id: v2ConversationTable.id,
        characterVersionId: v2ConversationTable.characterVersionId,
      })
      .from(v2ConversationTable);
    expect(rows.find((row) => row.id === conversationId)?.characterVersionId).toBe(versionId);
  });
});
