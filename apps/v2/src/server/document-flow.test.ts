// @vitest-environment node

import { writeFile } from "node:fs/promises";

import { FakeListChatModel } from "@langchain/core/utils/testing";
import { createDocumentRepository } from "@v2/db";
import {
  createDocumentService,
  createDocumentProjection,
  splitDocumentText,
  type DocumentBucket,
  createTurnGraph,
  runTurn,
  type TurnModel,
  createMemoryTurnStore,
} from "@v2/engine";
import { afterAll, beforeAll, expect, test } from "vitest";

import { openDocumentFixture } from "../../../../packages/db/src/test/document-fixture";

import { createDocumentRequestHandler } from "./document-api";
import { createScopedDocumentService } from "./document-runtime";

let fixture: Awaited<ReturnType<typeof openDocumentFixture>>;
beforeAll(async () => {
  fixture = await openDocumentFixture();
});
afterAll(async () => {
  await fixture.dispose();
});

const makeService = (
  characterId: string,
  bucket: DocumentBucket = fixture.bucket,
  worldlineId = "synthetic-worldline",
) => {
  const scope = { userId: "synthetic-owner", characterId, worldlineId };
  const repository = createDocumentRepository(fixture.d1, scope);
  return {
    repository,
    service: createScopedDocumentService({ DB: fixture.d1, BUCKET: bucket }, scope),
  };
};
const uploadInput = (text = "The synthetic clock is blue.") => ({
  name: "synthetic.txt",
  contentType: "text/plain",
  bytes: new TextEncoder().encode(text),
});

test("1,200字・200字の重なりを code point 境界で分割し、末尾の重複 chunk を作らない", () => {
  const input = "🌟".repeat(2401);
  const chunks = splitDocumentText(input).map((chunk) => Array.from(chunk));
  expect(chunks.map((chunk) => chunk.length)).toEqual([1200, 1200, 401]);
  expect(chunks[0].slice(-200)).toEqual(chunks[1].slice(0, 200));
  expect(splitDocumentText("a".repeat(1200))).toHaveLength(1);
  expect(() => splitDocumentText(" ")).toThrow();
  expect(() => splitDocumentText("a".repeat(200_001))).toThrow();
});

test("TXT →実ローカルR2/D1→既存runTurn/model/保存、OFF・再開・削除・全部OFFまで接続する", async () => {
  const character = {
    id: "document-flow",
    name: "Synthetic guide",
    systemPrompt: "Guide a fictional exhibition.",
    greeting: "Hello.",
  };
  const { service, repository } = makeService(character.id);
  const document = await service.upload(uploadInput());
  expect(await (await fixture.bucket.get(document.objectKey))?.text()).toBe(
    "The synthetic clock is blue.",
  );
  const recreated = createDocumentRepository(fixture.d1, {
    userId: "synthetic-owner",
    characterId: character.id,
    worldlineId: "synthetic-worldline",
  });
  expect((await recreated.list())[0].id).toBe(document.id);

  const model: TurnModel = new FakeListChatModel({
    responses: [
      "<response><action>Points to the clock.</action><dialogue>It is blue.</dialogue></response>",
    ],
  });
  const store = createMemoryTurnStore();
  const graph = createTurnGraph({
    model,
    store,
    contextSources: { documents: createDocumentProjection(service.source) },
    extendBelowRatio: 0,
  });
  const promptTrace: { turn: number; documentContext: string; historyMessages: number }[] = [];
  const collectPrompt = async () => {
    const conversationId = "synthetic-document-sequence";
    let done = false;
    for await (const event of runTurn(
      graph,
      { character, conversationId, userText: "What color is the synthetic clock?" },
      conversationId,
    )) {
      if (event.type === "done") done = true;
    }
    expect(done).toBe(true);
    const generation = store.turns
      .get(conversationId)
      ?.at(-1)
      ?.events.find((event) => event.type === "generation");
    if (!generation) throw new Error("合成 generation が保存されとらん");
    promptTrace.push({
      turn: promptTrace.length + 1,
      documentContext: generation.systemPrompt.split("【設定資料】\n")[1] ?? "",
      historyMessages: generation.request.length,
    });
    return generation.systemPrompt;
  };
  expect(await collectPrompt()).toContain("The synthetic clock is blue.");
  await service.update(document.id, { enabled: false, budgetChars: 10 });
  expect((await recreated.list())[0]).toMatchObject({ enabled: false, budgetChars: 10 });
  expect(await collectPrompt()).not.toContain("【設定資料】");
  await service.update(document.id, { enabled: true, budgetChars: 2000 });
  expect(await collectPrompt()).toContain("The synthetic clock is blue.");
  await service.setBudget(0);
  expect(await collectPrompt()).not.toContain("【設定資料】");
  await service.setBudget(4000);
  await service.remove(document.id);
  expect(await fixture.bucket.get(document.objectKey)).toBeNull();
  expect(await repository.list()).toEqual([]);
  expect(await collectPrompt()).not.toContain("【設定資料】");
  expect(promptTrace.map((entry) => entry.documentContext.length > 0)).toEqual([
    true,
    false,
    true,
    false,
    false,
  ]);
  const evidencePath = process.env.RIT_DOCUMENT_EVIDENCE_PATH;
  if (evidencePath) await writeFile(evidencePath, JSON.stringify(promptTrace, null, 2));
});

test("server由来の同owner/characterでもworldline間で資料・設定・検索・削除を分離する", async () => {
  const { service: first } = makeService("document-worldline", fixture.bucket, "first-worldline");
  const { service: second } = makeService("document-worldline", fixture.bucket, "second-worldline");
  const blue = await first.upload(uploadInput("The synthetic clock is blue."));
  const red = await second.upload(uploadInput("The synthetic clock is red."));
  expect((await first.list()).map((document) => document.id)).toEqual([blue.id]);
  expect((await second.list()).map((document) => document.id)).toEqual([red.id]);
  expect(
    await second.source.search({
      characterId: "document-worldline",
      query: "clock",
      documentIds: [blue.id],
    }),
  ).toEqual([]);
  await expect(second.remove(blue.id)).rejects.toMatchObject({ code: "document_missing" });
  await first.setBudget(0);
  expect((await first.settings()).budgetChars).toBe(0);
  expect((await second.settings()).budgetChars).toBe(4000);
  const mutableScope = {
    userId: "synthetic-owner",
    characterId: "document-worldline",
    worldlineId: "first-worldline",
  };
  const fixed = createScopedDocumentService(
    { DB: fixture.d1, BUCKET: fixture.bucket },
    mutableScope,
  );
  mutableScope.worldlineId = "second-worldline";
  expect((await fixed.list()).map((document) => document.id)).toEqual([blue.id]);
  expect(() =>
    createScopedDocumentService(
      { DB: fixture.d1, BUCKET: fixture.bucket },
      { ...mutableScope, worldlineId: "" },
    ),
  ).toThrow();
});

test("検索後にOFFとなった合成資料をcomposeへ戻さない", async () => {
  const { service } = makeService("document-post-search-off");
  const document = await service.upload(uploadInput("The synthetic clock is blue."));
  const source = {
    ...service.source,
    search: async (input: Parameters<typeof service.source.search>[0]) => {
      const stale = await service.source.search(input);
      await service.update(document.id, { enabled: false });
      return stale;
    },
  };
  expect(
    await createDocumentProjection(source)({
      characterId: "document-post-search-off",
      query: "clock",
      maxChars: 4000,
    }),
  ).toEqual([]);
  expect((await service.settings()).documents[0].enabled).toBe(false);
});

test("16個目を拒否し、削除後だけ枠を再利用する", async () => {
  const { service } = makeService("document-limit-flow");
  const documents = await Promise.all(
    Array.from({ length: 15 }, () => service.upload(uploadInput())),
  );
  await expect(service.upload(uploadInput())).rejects.toMatchObject({ code: "document_limit" });
  expect(await service.list()).toHaveLength(15);
  await service.remove(documents[0].id);
  await service.upload(uploadInput("A replacement synthetic clock."));
  expect(await service.list()).toHaveLength(15);
});

test("R2書き込み失敗では索引を公開せず予約枠も解放する", async () => {
  const bucket: DocumentBucket = {
    put: async () => {
      throw new Error("synthetic write failure");
    },
    delete: async () => undefined,
  };
  const { service, repository } = makeService("document-write-failure", bucket);
  await expect(service.upload(uploadInput())).rejects.toMatchObject({ code: "storage_failure" });
  expect(await repository.list()).toEqual([]);
  expect((await repository.loadSettings()).documents).toEqual([]);
});

test("R2削除失敗でも参照を停止し、同じIDの削除再試行でrawも消せる", async () => {
  let failDelete = true;
  const bucket: DocumentBucket = {
    put: (key, bytes, options) => fixture.bucket.put(key, bytes, options),
    delete: async (key) => {
      if (failDelete) throw new Error("synthetic delete failure");
      await fixture.bucket.delete(key);
    },
  };
  const { service, repository } = makeService("document-delete-failure", bucket);
  const document = await service.upload(uploadInput());
  await expect(service.remove(document.id)).rejects.toMatchObject({
    code: "storage_failure",
    documentId: document.id,
  });
  expect(await repository.search({ query: "clock", documentIds: [document.id] })).toEqual([]);
  expect(await repository.complete(document.id, ["NEVER_RESURRECT"])).toBe(false);
  failDelete = false;
  await service.remove(document.id);
  expect(await fixture.bucket.get(document.objectKey)).toBeNull();
});

test("取り込みとDB後片付けの両方が失敗してもpending IDを発見して削除でき、15枠を回復する", async () => {
  const scope = {
    userId: "synthetic-owner",
    characterId: "document-recover-reservations",
    worldlineId: "synthetic-worldline",
  };
  const repository = createDocumentRepository(fixture.d1, scope);
  const brokenRepository = {
    ...repository,
    remove: async () => {
      throw new Error("synthetic D1 failure");
    },
  };
  const bucket: DocumentBucket = {
    put: async () => {
      throw new Error("synthetic R2 failure");
    },
    delete: async () => undefined,
  };
  const failed = createDocumentService({ repository: brokenRepository, bucket, scope });
  for (let attempt = 0; attempt < 15; attempt += 1) {
    await expect(failed.upload(uploadInput())).rejects.toMatchObject({
      code: "storage_failure",
      documentId: expect.any(String),
    });
  }
  const pending = await repository.list();
  expect(pending).toHaveLength(15);
  expect(pending.every((document) => document.status === "indexing")).toBe(true);
  expect((await repository.loadSettings()).documents).toEqual([]);
  const recovered = createDocumentService({ repository, bucket: fixture.bucket, scope });
  for (const document of pending) await recovered.remove(document.id);
  expect(await recovered.list()).toEqual([]);
  expect((await recovered.upload(uploadInput())).status).toBe("ready");
});

test("不正UTF8・空TXT・画像MIMEを保存前に拒否する", async () => {
  const { service } = makeService("document-invalid");
  await expect(
    service.upload({ ...uploadInput(), bytes: new Uint8Array([0xff]) }),
  ).rejects.toMatchObject({ code: "invalid_document" });
  await expect(service.upload(uploadInput(""))).rejects.toMatchObject({ code: "invalid_document" });
  await expect(service.upload({ ...uploadInput(), contentType: "image/png" })).rejects.toThrow();
  expect(await service.list()).toEqual([]);
});

test("資料専用HTTP handlerで取り込み・設定変更・削除と認可resolver境界を検証する", async () => {
  const characterId = "document-http";
  const { service } = makeService(characterId);
  const handler = createDocumentRequestHandler(async (request, requestedCharacter) => {
    if (request.headers.get("x-synthetic-owner") !== "allowed")
      return new Response(null, { status: 401 });
    if (requestedCharacter !== characterId) return new Response(null, { status: 404 });
    return service;
  });
  const request = (method: string, body?: BodyInit) =>
    new Request("https://synthetic.invalid/api/document", {
      method,
      headers: { "x-synthetic-owner": "allowed" },
      body,
    });
  expect(
    (await handler(characterId, new Request("https://synthetic.invalid/api/document"))).status,
  ).toBe(401);
  expect((await handler("foreign-character", request("GET"))).status).toBe(404);
  const form = new FormData();
  form.set("file", new Blob(["The synthetic clock is blue."], { type: "text/plain" }), "clock.txt");
  form.set("budgetChars", "50");
  const uploaded = await handler(characterId, request("POST", form));
  expect(uploaded.status).toBe(201);
  const document = (await service.list())[0];
  expect(await uploaded.text()).not.toContain(document.objectKey);
  const listed = await handler(characterId, request("GET"));
  expect(listed.status).toBe(200);
  expect(await listed.text()).not.toContain("objectKey");
  expect(
    (
      await handler(
        characterId,
        request(
          "PATCH",
          JSON.stringify({ documentId: document.id, enabled: false, budgetChars: 20 }),
        ),
      )
    ).status,
  ).toBe(200);
  expect((await service.settings()).documents[0]).toMatchObject({
    enabled: false,
    budgetChars: 20,
  });
  expect(
    (await handler(characterId, request("PATCH", JSON.stringify({ budgetChars: 0 })))).status,
  ).toBe(200);
  expect((await service.settings()).budgetChars).toBe(0);
  expect((await handler(characterId, request("PATCH", "invalid-json"))).status).toBe(400);
  expect(
    (
      await handler(
        characterId,
        request(
          "PATCH",
          JSON.stringify({
            documentId: document.id,
            enabled: true,
            userId: "client-spoof",
            worldlineId: "client-worldline",
          }),
        ),
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await handler(
        characterId,
        request("DELETE", JSON.stringify({ documentId: "foreign-document" })),
      )
    ).status,
  ).toBe(404);
  expect(
    (await handler(characterId, request("DELETE", JSON.stringify({ documentId: document.id }))))
      .status,
  ).toBe(204);
  expect(await service.list()).toEqual([]);
  expect((await handler(characterId, request("PUT"))).status).toBe(405);
});

test("資料HTTPのサイズ超過・不正multipart・不正予算を保存前に拒否する", async () => {
  const { service } = makeService("document-invalid-http");
  const handler = createDocumentRequestHandler(async () => service);
  const post = (body: BodyInit) =>
    new Request("https://synthetic.invalid/api/document", { method: "POST", body });
  expect(
    (await handler("document-invalid-http", post(new Uint8Array(2 * 1024 * 1024 + 16_385)))).status,
  ).toBe(400);
  expect((await handler("document-invalid-http", post("not multipart"))).status).toBe(400);
  const form = new FormData();
  form.set("file", new Blob(["Synthetic clock."], { type: "text/plain" }), "clock.txt");
  form.set("budgetChars", "-1");
  expect((await handler("document-invalid-http", post(form))).status).toBe(400);
  expect(await service.list()).toEqual([]);
});
