import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { createDocumentRepository } from "./document-store";
import { openDocumentFixture, type DocumentFixture } from "./test/document-fixture";

let fixture: DocumentFixture;
beforeAll(async () => {
  fixture = await openDocumentFixture();
});
afterAll(async () => {
  await fixture?.dispose();
});

const scope = (
  characterId: string,
  userId = "synthetic-user",
  worldlineId = "synthetic-worldline",
) => ({ userId, characterId, worldlineId });
const reservation = (id: string) => ({
  id,
  name: `${id}.txt`,
  contentType: "text/plain",
  objectKey: `synthetic/${id}`,
  budgetChars: 2000,
  createdAt: 100,
});

describe("isolated D1 document repository", () => {
  test("設定・資料・chunkをD1へ保存し、別repositoryで読み直す", async () => {
    const owner = scope("synthetic-persistence");
    const repository = createDocumentRepository(fixture.d1, owner);
    expect(await repository.loadSettings()).toEqual({ budgetChars: 4000, documents: [] });
    expect(await repository.reserve(reservation("persistent-doc"))).toBe(true);
    expect(await repository.list()).toMatchObject([{ id: "persistent-doc", status: "indexing" }]);
    expect((await repository.loadSettings()).documents).toEqual([]);
    expect(
      await repository.complete("persistent-doc", ["架空の展示室の時計は青い。SYNTHETIC_CLOCK"]),
    ).toBe(true);
    await repository.setBudget(123);
    await repository.update("persistent-doc", { budgetChars: 45 });
    const reopened = createDocumentRepository(fixture.d1, owner);
    expect(await reopened.loadSettings()).toMatchObject({
      budgetChars: 123,
      documents: [{ id: "persistent-doc", enabled: true, budgetChars: 45 }],
    });
    const hits = await reopened.search({ query: "時計の色", documentIds: ["persistent-doc"] });
    expect(hits).toMatchObject([
      {
        id: "persistent-doc:0",
        characterId: owner.characterId,
        text: "架空の展示室の時計は青い。SYNTHETIC_CLOCK",
      },
    ]);
  });

  test("予約も数えて並行16件中15件だけ受け入れ、削除後に枠を再利用する", async () => {
    const repository = createDocumentRepository(fixture.d1, scope("synthetic-cap"));
    const results = await Promise.all(
      Array.from({ length: 16 }, (_, index) => repository.reserve(reservation(`cap-doc-${index}`))),
    );
    expect(results.filter(Boolean)).toHaveLength(15);
    expect(await repository.reserve(reservation("cap-overflow"))).toBe(false);
    await repository.remove("cap-doc-0");
    expect(await repository.reserve(reservation("cap-replacement"))).toBe(true);
    expect(await repository.complete("cap-doc-0", ["削除後に復活させる文字列"])).toBe(false);
    const pending = await repository.list();
    expect(pending).toHaveLength(15);
    expect(pending.every((document) => document.status === "indexing")).toBe(true);
    expect((await repository.loadSettings()).documents).toEqual([]);
  });

  test("所有者・キャラ境界を検索と更新と削除の全経路で守る", async () => {
    const owner = createDocumentRepository(fixture.d1, scope("synthetic-owner"));
    await owner.reserve(reservation("private-doc"));
    await owner.complete("private-doc", ["PRIVATE_SENTINEL"]);
    for (const boundary of [
      scope("synthetic-owner", "other-user"),
      scope("other-character"),
      scope("synthetic-owner", "synthetic-user", "other-worldline"),
    ]) {
      const outsider = createDocumentRepository(fixture.d1, boundary);
      expect(await outsider.list()).toEqual([]);
      expect(await outsider.update("private-doc", { enabled: false })).toBeNull();
      expect(await outsider.remove("private-doc")).toBeNull();
      expect(await outsider.complete("private-doc", ["FOREIGN_WRITE"])).toBe(false);
      expect(
        await outsider.search({ query: "PRIVATE_SENTINEL", documentIds: ["private-doc"] }),
      ).toEqual([]);
    }
    expect(
      await owner.search({ query: "PRIVATE_SENTINEL", documentIds: ["private-doc"] }),
    ).toHaveLength(1);
  });

  test("OFF・個別予算ゼロ・削除済み・許可ID外・無関係の資料は検索で返さない", async () => {
    const repository = createDocumentRepository(fixture.d1, scope("synthetic-filter"));
    await repository.reserve(reservation("filtered-doc"));
    await repository.complete("filtered-doc", ["SYNTHETIC_FILTER"]);
    expect(
      await repository.search({ query: "UNRELATED_WORD", documentIds: ["filtered-doc"] }),
    ).toEqual([]);
    expect(await repository.search({ query: "SYNTHETIC_FILTER", documentIds: [] })).toEqual([]);
    await repository.update("filtered-doc", { enabled: false });
    expect(
      await repository.search({ query: "SYNTHETIC_FILTER", documentIds: ["filtered-doc"] }),
    ).toEqual([]);
    await repository.update("filtered-doc", { enabled: true, budgetChars: 0 });
    expect(
      await repository.search({ query: "SYNTHETIC_FILTER", documentIds: ["filtered-doc"] }),
    ).toEqual([]);
    await repository.update("filtered-doc", { budgetChars: 100 });
    await repository.remove("filtered-doc");
    expect(await repository.remove("filtered-doc")).toMatchObject({
      id: "filtered-doc",
      objectKey: "synthetic/filtered-doc",
    });
    expect(await repository.complete("filtered-doc", ["SYNTHETIC_FILTER"])).toBe(false);
    expect(await repository.list()).toEqual([]);
    expect(
      await repository.search({ query: "SYNTHETIC_FILTER", documentIds: ["filtered-doc"] }),
    ).toEqual([]);
  });

  test("関連度順・SQL文字列・不正予算・再completeを確認する", async () => {
    const repository = createDocumentRepository(fixture.d1, scope("synthetic-ranking"));
    await repository.reserve(reservation("ranking-doc"));
    await repository.complete("ranking-doc", ["blue moon", "blue"]);
    expect(
      (await repository.search({ query: "blue moon", documentIds: ["ranking-doc"] })).map(
        (hit) => hit.text,
      ),
    ).toEqual(["blue moon", "blue"]);
    expect(await repository.complete("ranking-doc", ["replacement"])).toBe(false);
    expect(
      await repository.search({
        query: "'; DROP TABLE v2_document; --",
        documentIds: ["ranking-doc"],
      }),
    ).toEqual([]);
    await expect(repository.setBudget(-1)).rejects.toThrow(RangeError);
    await expect(repository.update("ranking-doc", { budgetChars: 1.5 })).rejects.toThrow(
      RangeError,
    );
    expect(await repository.list()).toHaveLength(1);
  });

  test("index完了と削除が競合しても資料とchunkは復活しない", async () => {
    const repository = createDocumentRepository(fixture.d1, scope("synthetic-delete-race"));
    await repository.reserve(reservation("race-doc"));
    await Promise.all([
      repository.complete("race-doc", ["RACE_SENTINEL"]),
      repository.remove("race-doc"),
    ]);
    expect(await repository.list()).toEqual([]);
    expect(await repository.complete("race-doc", ["RACE_SENTINEL"])).toBe(false);
    expect(await repository.search({ query: "RACE_SENTINEL", documentIds: ["race-doc"] })).toEqual(
      [],
    );
    const row = await fixture.d1
      .prepare("SELECT COUNT(*) AS count FROM v2_document_chunk WHERE document_id = ?")
      .bind("race-doc")
      .first<{ count: number }>();
    expect(row?.count).toBe(0);
  });

  test("長音符・繰り返し記号を含む日本語と単字質問を検索できる", async () => {
    const repository = createDocumentRepository(fixture.d1, scope("synthetic-japanese-query"));
    await repository.reserve(reservation("japanese-query-doc"));
    await repository.complete("japanese-query-doc", ["コーヒー blue 色 人々 x"]);
    for (const query of ["コーヒー", "色", "人々", "x", "blue"]) {
      expect(await repository.search({ query, documentIds: ["japanese-query-doc"] })).toHaveLength(
        1,
      );
    }
    expect(await repository.search({ query: "紅茶", documentIds: ["japanese-query-doc"] })).toEqual(
      [],
    );
  });

  test("同じ所有者・キャラでも世界線ごとに資料・設定と書き込みを分離する", async () => {
    const left = createDocumentRepository(
      fixture.d1,
      scope("synthetic-worldline-scope", "synthetic-user", "left-worldline"),
    );
    const right = createDocumentRepository(
      fixture.d1,
      scope("synthetic-worldline-scope", "synthetic-user", "right-worldline"),
    );
    await left.reserve(reservation("worldline-left-doc"));
    expect(await right.list()).toEqual([]);
    expect(await right.complete("worldline-left-doc", ["FOREIGN_WORLDLINE"])).toBe(false);
    expect(await left.complete("worldline-left-doc", ["WORLDLINE_SENTINEL left"])).toBe(true);
    await right.reserve(reservation("worldline-right-doc"));
    await right.complete("worldline-right-doc", ["WORLDLINE_SENTINEL right"]);
    await left.setBudget(111);
    expect((await right.loadSettings()).budgetChars).toBe(4000);
    await right.setBudget(222);
    expect((await left.loadSettings()).budgetChars).toBe(111);
    expect((await right.loadSettings()).budgetChars).toBe(222);
    expect((await left.loadSettings()).documents.map((document) => document.id)).toEqual([
      "worldline-left-doc",
    ]);
    expect((await right.loadSettings()).documents.map((document) => document.id)).toEqual([
      "worldline-right-doc",
    ]);
    const query = {
      query: "WORLDLINE_SENTINEL",
      documentIds: ["worldline-left-doc", "worldline-right-doc"],
    };
    expect((await left.search(query)).map((hit) => hit.documentId)).toEqual(["worldline-left-doc"]);
    expect((await right.search(query)).map((hit) => hit.documentId)).toEqual([
      "worldline-right-doc",
    ]);
    expect(await right.update("worldline-left-doc", { enabled: false })).toBeNull();
    expect(await right.remove("worldline-left-doc")).toBeNull();
    expect(await left.update("worldline-left-doc", { budgetChars: 50 })).toMatchObject({
      worldlineId: "left-worldline",
      enabled: true,
      budgetChars: 50,
    });
    await right.remove("worldline-right-doc");
    expect(await right.list()).toEqual([]);
    expect(await left.list()).toMatchObject([{ worldlineId: "left-worldline" }]);
  });

  test("15資料の上限は同キャラの全世界線を横断して適用する", async () => {
    const left = createDocumentRepository(
      fixture.d1,
      scope("synthetic-worldline-cap", "synthetic-user", "left-worldline"),
    );
    const right = createDocumentRepository(
      fixture.d1,
      scope("synthetic-worldline-cap", "synthetic-user", "right-worldline"),
    );
    const reservations = await Promise.all(
      Array.from({ length: 16 }, (_, index) =>
        (index % 2 === 0 ? left : right).reserve(reservation(`worldline-cap-${index}`)),
      ),
    );
    expect(reservations.filter(Boolean)).toHaveLength(15);
    expect((await left.list()).length + (await right.list()).length).toBe(15);
    expect(await left.reserve(reservation("worldline-cap-left-overflow"))).toBe(false);
    expect(await right.reserve(reservation("worldline-cap-right-overflow"))).toBe(false);
    const removed = (await left.list())[0];
    expect(await right.remove(removed.id)).toBeNull();
    await left.remove(removed.id);
    expect(await right.reserve(reservation("worldline-cap-right-replacement"))).toBe(true);
    expect((await left.list()).length + (await right.list()).length).toBe(15);
  });

  test("空の世界線scopeを暗黙の共有scopeとして扱わない", () => {
    expect(() =>
      createDocumentRepository(
        fixture.d1,
        scope("synthetic-invalid-worldline", "synthetic-user", ""),
      ),
    ).toThrow(TypeError);
  });
});
