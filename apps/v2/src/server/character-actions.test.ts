// @vitest-environment node
// workerd のローカルD1を使うため、ブラウザ模倣環境から切り離す。
import { saveCharacter } from "@v2/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { characterFixture } from "../../../../packages/db/src/test/character-fixture";
import {
  openCharacterTestDb,
  type CharacterTestDb,
} from "../../../../packages/db/src/test/character-local-d1";

import { createCharacterActions } from "./character-actions";

const context = { characterActor: { userId: "synthetic-owner" } };

describe("character server actions", () => {
  let local: CharacterTestDb;
  let trustedContext: unknown = context;
  const getDb = vi.fn(async () => local.db);
  const actions = createCharacterActions(getDb, () => trustedContext);
  beforeEach(() => {
    trustedContext = context;
  });

  beforeAll(async () => {
    local = await openCharacterTestDb();
  }, 60_000);
  afterAll(async () => {
    await local?.dispose();
  }, 60_000);

  it("信頼済みserver contextが無ければDBへ接続しない", async () => {
    getDb.mockClear();
    for (const untrusted of [
      undefined,
      {},
      { userId: "synthetic-owner" },
      { characterActor: { userId: "" } },
    ]) {
      trustedContext = untrusted;
      expect(await actions.list()).toMatchObject({ ok: false, code: "unauthorized" });
      expect(await actions.save({ ...characterFixture, userId: "synthetic-owner" })).toMatchObject({
        ok: false,
        code: "unauthorized",
      });
    }
    expect(getDb).not.toHaveBeenCalled();
  });

  it("RPC由来のcontextを偽造しても所有者になれない", async () => {
    trustedContext = undefined;
    getDb.mockClear();
    expect(await Reflect.apply(actions.list, null, [context])).toMatchObject({
      ok: false,
      code: "unauthorized",
    });
    expect(
      await actions.save({
        sheet: characterFixture,
        expectedVersionId: null,
        expectedRevision: "",
        context,
      }),
    ).toMatchObject({ ok: false, code: "unauthorized" });
    expect(getDb).not.toHaveBeenCalled();
  });

  it("作成・3版の編集・一覧・前の版への復元を同じaction経路で行う", async () => {
    const original = { ...characterFixture, id: "action-guide" };
    const created = await actions.save({
      sheet: original,
      expectedVersionId: null,
      expectedRevision: "",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(created.message);
    const secondSheet = {
      ...created.data.sheet,
      systemPrompt: "丁寧な口調で案内してください。",
      greeting: "ようこそ、お客様。",
    };
    const second = await actions.save({
      sheet: secondSheet,
      expectedVersionId: created.data.currentVersionId,
      expectedRevision: created.data.revision,
    });
    if (!second.ok) throw new Error(second.message);
    const third = await actions.save({
      sheet: { ...secondSheet, systemPrompt: "簡潔な口調で案内してください。" },
      expectedVersionId: second.data.currentVersionId,
      expectedRevision: second.data.revision,
    });
    if (!third.ok) throw new Error(third.message);
    expect(third.data.versions).toHaveLength(3);
    expect(third.data.versions[1].sheet).toEqual(secondSheet);
    const restored = await actions.restore({
      characterId: original.id,
      versionId: third.data.versions[1].id,
      expectedVersionId: third.data.currentVersionId,
      expectedRevision: third.data.revision,
    });
    if (!restored.ok) throw new Error(restored.message);
    expect(restored.data.sheet).toEqual(secondSheet);
    expect(restored.data.versions).toHaveLength(3);
    expect(await actions.list()).toMatchObject({
      ok: true,
      data: { actorKey: "synthetic-owner", characters: [{ id: original.id, name: original.name }] },
    });
    await local.reopen();
    expect(await actions.load(original.id)).toMatchObject({
      ok: true,
      data: { sheet: secondSheet },
    });
  });

  it("所有者はbodyから指定できず、他者の設定・履歴は読み出せない", async () => {
    const other = { characterActor: { userId: "other-owner" } };
    trustedContext = other;
    expect(await actions.load("action-guide")).toMatchObject({ ok: false, code: "not-found" });
    expect(await actions.list()).toMatchObject({ ok: true, data: { characters: [] } });
    trustedContext = context;
    expect(
      await actions.save({
        sheet: { ...characterFixture, id: "forged-owner" },
        expectedVersionId: null,
        expectedRevision: "",
        userId: "other-owner",
      }),
    ).toMatchObject({ ok: false, code: "invalid" });
  });

  it.each([17, "", "18", "age", null])("年齢 %s をserver境界でも拒否する", async (age) => {
    const result = await actions.save({
      sheet: { ...characterFixture, id: "invalid-action", age },
      expectedVersionId: null,
      expectedRevision: "",
    });
    expect(result).toMatchObject({ ok: false, code: "invalid" });
    expect(await actions.load("invalid-action")).toMatchObject({ ok: false, code: "not-found" });
  });

  it("古い画面からの上書きを拒否して再読出しできる", async () => {
    const loaded = await actions.load("action-guide");
    if (!loaded.ok) throw new Error(loaded.message);
    const input = {
      sheet: loaded.data.sheet,
      expectedVersionId: loaded.data.currentVersionId,
      expectedRevision: loaded.data.revision,
    };
    const first = await actions.save({
      ...input,
      sheet: { ...input.sheet, introduction: "更新済みの合成紹介" },
    });
    expect(first.ok).toBe(true);
    expect(await actions.save(input)).toMatchObject({ ok: false, code: "conflict" });
    expect(await actions.load("action-guide")).toMatchObject({
      ok: true,
      data: { sheet: { introduction: "更新済みの合成紹介" } },
    });
  });

  it("内部例外の内容を画面へ漏らさず、再試行を案内する", async () => {
    const broken = createCharacterActions(
      () => Promise.reject(new Error("private-diagnostic-marker")),
      () => context,
    );
    const result = await broken.list();
    expect(result).toMatchObject({ ok: false, code: "unavailable" });
    expect(JSON.stringify(result)).not.toContain("private-diagnostic-marker");
  });

  it("ブラウザから公式区分・作成日時・表示順を変更できない", async () => {
    const raw = {
      ...characterFixture,
      id: "protected-profile",
      isOfficial: true,
      displayOrder: -99,
      createdAt: -1,
    };
    const created = await actions.save({
      sheet: raw,
      expectedVersionId: null,
      expectedRevision: "",
    });
    if (!created.ok) throw new Error(created.message);
    expect(created.data.sheet).toMatchObject({ isOfficial: false, displayOrder: 0 });
    expect(created.data.sheet.createdAt).toBeGreaterThan(0);
    const updated = await actions.save({
      sheet: { ...created.data.sheet, isOfficial: true, displayOrder: -1, createdAt: 0 },
      expectedVersionId: created.data.currentVersionId,
      expectedRevision: created.data.revision,
    });
    if (!updated.ok) throw new Error(updated.message);
    expect(updated.data.sheet).toEqual(created.data.sheet);
    expect(updated.data.versions).toHaveLength(1);
  });

  it("過去版の復元でも現在の公式区分を上書きしない", async () => {
    const profile = { ...characterFixture, id: "restore-metadata", isOfficial: true };
    await saveCharacter(local.db, "synthetic-owner", profile);
    await local.d1
      .prepare("UPDATE character SET is_official = 0 WHERE id = ?")
      .bind(profile.id)
      .run();
    const loaded = await actions.load(profile.id);
    if (!loaded.ok) throw new Error(loaded.message);
    expect(loaded.data.versions[0].sheet.isOfficial).toBe(true);
    const restored = await actions.restore({
      characterId: profile.id,
      versionId: loaded.data.versions[0].id,
      expectedVersionId: loaded.data.currentVersionId,
      expectedRevision: loaded.data.revision,
    });
    if (!restored.ok) throw new Error(restored.message);
    expect(restored.data.sheet.isOfficial).toBe(false);
  });
});
