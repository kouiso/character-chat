import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { characterTable } from "../../../src/schema/character";

import { CharacterConflictError, loadCharacter, saveCharacter } from "./character";
import {
  getCharacterEditState,
  listCharacterVersions,
  restoreCharacterVersion,
} from "./character-version";
import { characterFixture } from "./test/character-fixture";
import { openCharacterTestDb, type CharacterTestDb } from "./test/character-local-d1";

const OWNER = "synthetic-owner";
const newSheet = () => ({ ...characterFixture, id: crypto.randomUUID() });

describe("character versions", () => {
  let local: CharacterTestDb;

  beforeAll(async () => {
    local = await openCharacterTestDb();
  });

  afterAll(async () => {
    await local?.dispose();
  });

  it("3回保存後に全内容と時刻を新しい順で保持し、前の版へ戻せる", async () => {
    const first = newSheet();
    const second = { ...first, name: "受付係", systemPrompt: "丁寧に案内してください。" };
    const third = { ...second, greeting: "施設へようこそ。", appearance: "緑の帽子" };
    for (const sheet of [first, second, third]) await saveCharacter(local.db, OWNER, sheet);
    const versions = await listCharacterVersions(local.db, OWNER, first.id);
    expect(versions.map((version) => version.sheet)).toEqual([third, second, first]);
    expect(versions.every((version) => version.createdAt > 0)).toBe(true);
    const current = await getCharacterEditState(local.db, OWNER, first.id);
    expect(current?.currentVersionId).toBe(versions[0].id);
    expect(current?.revision).toEqual(expect.any(String));
    await restoreCharacterVersion(local.db, OWNER, first.id, versions[1].id, {
      expectedVersionId: current?.currentVersionId,
      expectedRevision: current?.revision,
    });
    expect(await loadCharacter(local.db, first.id)).toEqual({ ok: second, failures: [] });
    const restored = await getCharacterEditState(local.db, OWNER, first.id);
    expect(restored?.currentVersionId).toBe(versions[1].id);
    expect(restored?.revision).not.toBe(current?.revision);
    expect(await listCharacterVersions(local.db, OWNER, first.id)).toEqual(versions);
    await local.reopen();
    expect((await getCharacterEditState(local.db, OWNER, first.id))?.sheet).toEqual(second);
  });

  it("同じ内容を繰り返し保存しても版を増やさない", async () => {
    const first = newSheet();
    await saveCharacter(local.db, OWNER, first);
    await saveCharacter(local.db, OWNER, first);
    expect(await listCharacterVersions(local.db, OWNER, first.id)).toHaveLength(1);
  });

  it("履歴のない既存行は最初の編集前の内容も保全する", async () => {
    const first = newSheet();
    await local.db.insert(characterTable).values({ ...first, userId: OWNER });
    expect(await getCharacterEditState(local.db, OWNER, first.id)).toEqual({
      sheet: first,
      currentVersionId: null,
      revision: "",
    });
    const updated = { ...first, introduction: "広場の案内係です。" };
    await saveCharacter(local.db, OWNER, updated, {
      expectedVersionId: null,
      expectedRevision: "",
    });
    expect(
      (await listCharacterVersions(local.db, OWNER, first.id)).map((version) => version.sheet),
    ).toEqual([updated, first]);
  });

  it("履歴のない既存行を同じ内容で保存しても最初の版を残す", async () => {
    const first = newSheet();
    await local.db.insert(characterTable).values({ ...first, userId: OWNER });
    await saveCharacter(local.db, OWNER, first, { expectedVersionId: null });
    expect(
      (await listCharacterVersions(local.db, OWNER, first.id)).map((version) => version.sheet),
    ).toEqual([first]);
  });

  it("古い版IDの保存と復元を拒否し、不採用の内容を履歴へ追加しない", async () => {
    const first = newSheet();
    await saveCharacter(local.db, OWNER, first);
    const before = await getCharacterEditState(local.db, OWNER, first.id);
    const second = { ...first, world: "架空の美術館" };
    await saveCharacter(local.db, OWNER, second);
    const versions = await listCharacterVersions(local.db, OWNER, first.id);
    await expect(
      saveCharacter(
        local.db,
        OWNER,
        { ...first, name: "古い変更" },
        {
          expectedVersionId: before?.currentVersionId,
        },
      ),
    ).rejects.toBeInstanceOf(CharacterConflictError);
    await expect(
      restoreCharacterVersion(local.db, OWNER, first.id, versions[1].id, {
        expectedVersionId: before?.currentVersionId,
      }),
    ).rejects.toBeInstanceOf(CharacterConflictError);
    expect(await listCharacterVersions(local.db, OWNER, first.id)).toEqual(versions);
    expect((await getCharacterEditState(local.db, OWNER, first.id))?.sheet).toEqual(second);
  });

  it("編集後に元の版へ復元しても古い編集トークンを受け入れない", async () => {
    const first = newSheet();
    await saveCharacter(local.db, OWNER, first);
    const stale = await getCharacterEditState(local.db, OWNER, first.id);
    await saveCharacter(local.db, OWNER, { ...first, world: "架空の海辺" });
    await restoreCharacterVersion(local.db, OWNER, first.id, stale?.currentVersionId ?? -1);
    await expect(
      saveCharacter(
        local.db,
        OWNER,
        { ...first, name: "古い変更" },
        {
          expectedVersionId: stale?.currentVersionId,
          expectedRevision: stale?.revision,
        },
      ),
    ).rejects.toBeInstanceOf(CharacterConflictError);
    expect((await getCharacterEditState(local.db, OWNER, first.id))?.sheet).toEqual(first);
  });

  it("同じ編集元からの同時保存は一方だけ成立し、採用しない版を残さない", async () => {
    const first = newSheet();
    await saveCharacter(local.db, OWNER, first);
    const state = await getCharacterEditState(local.db, OWNER, first.id);
    const attempts = [
      { ...first, name: "案内係A" },
      { ...first, name: "案内係B" },
    ];
    const results = await Promise.allSettled(
      attempts.map((sheet) =>
        saveCharacter(local.db, OWNER, sheet, {
          expectedVersionId: state?.currentVersionId,
          expectedRevision: state?.revision,
        }),
      ),
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const versions = await listCharacterVersions(local.db, OWNER, first.id);
    expect(versions).toHaveLength(2);
    const active = await getCharacterEditState(local.db, OWNER, first.id);
    expect(versions[0].sheet).toEqual(active?.sheet);
  });

  it("別所有者・別キャラの履歴は見られず戻せない", async () => {
    const first = newSheet();
    const other = newSheet();
    await saveCharacter(local.db, OWNER, first);
    await saveCharacter(local.db, OWNER, other);
    const versions = await listCharacterVersions(local.db, OWNER, first.id);
    expect(await listCharacterVersions(local.db, "unrelated-owner", first.id)).toEqual([]);
    expect(await getCharacterEditState(local.db, "unrelated-owner", first.id)).toBeNull();
    await expect(
      restoreCharacterVersion(local.db, "unrelated-owner", first.id, versions[0].id),
    ).rejects.toThrow("キャラクターが見つかりません。");
    await expect(
      restoreCharacterVersion(local.db, OWNER, other.id, versions[0].id),
    ).rejects.toThrow("キャラクターの履歴が見つかりません。");
  });

  it("年齢17の保存を拒否し、履歴も現在の設定も変更しない", async () => {
    const first = newSheet();
    await saveCharacter(local.db, OWNER, first);
    const versions = await listCharacterVersions(local.db, OWNER, first.id);
    await expect(saveCharacter(local.db, OWNER, { ...first, age: 17 })).rejects.toThrow();
    expect(await listCharacterVersions(local.db, OWNER, first.id)).toEqual(versions);
    expect((await getCharacterEditState(local.db, OWNER, first.id))?.sheet).toEqual(first);
  });

  it("DB制約に失敗した保存は新しい履歴も原子的に取り消す", async () => {
    const first = { ...newSheet(), slug: crypto.randomUUID() };
    const other = { ...newSheet(), slug: crypto.randomUUID() };
    await saveCharacter(local.db, OWNER, first);
    await saveCharacter(local.db, OWNER, other);
    const versions = await listCharacterVersions(local.db, OWNER, first.id);
    await expect(saveCharacter(local.db, OWNER, { ...first, slug: other.slug })).rejects.toThrow();
    expect(await listCharacterVersions(local.db, OWNER, first.id)).toEqual(versions);
    expect((await getCharacterEditState(local.db, OWNER, first.id))?.sheet).toEqual(first);
  });

  it("復元時に既存の記憶行を変更しない", async () => {
    await local.d1.exec("CREATE TABLE v2_memory (id TEXT PRIMARY KEY, note TEXT NOT NULL)");
    await local.d1
      .prepare("INSERT INTO v2_memory(id, note) VALUES (?, ?)")
      .bind("synthetic-memory", "案内の希望は短い説明です。")
      .run();
    const first = newSheet();
    await saveCharacter(local.db, OWNER, first);
    await saveCharacter(local.db, OWNER, { ...first, name: "受付係" });
    const versions = await listCharacterVersions(local.db, OWNER, first.id);
    await restoreCharacterVersion(local.db, OWNER, first.id, versions[1].id);
    expect(await local.d1.prepare("SELECT * FROM v2_memory").all()).toMatchObject({
      results: [{ id: "synthetic-memory", note: "案内の希望は短い説明です。" }],
    });
  });
});
