import { count, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { characterTable } from "../../../src/schema/character";

import { characterSheetSchema, loadCharacter, loadCharacters, saveCharacter } from "./character";
import { characterFixture as profile } from "./test/character-fixture";
import { openCharacterTestDb, type CharacterTestDb } from "./test/character-local-d1";

const OWNER = "synthetic-owner";

describe("character profile", () => {
  it("新項目を削らず検証する", () => {
    expect(characterSheetSchema.parse(profile)).toEqual(profile);
  });

  it.each([17, "", "18", "eighteen", null, undefined, 18.5, Number.NaN])(
    "年齢 %s を拒否する",
    (age) => {
      const result = characterSheetSchema.safeParse({ ...profile, age });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues[0].path).toEqual(["age"]);
    },
  );

  it.each([
    { adultCategory: "unknown" },
    { proactiveSettings: { enabled: "true", intervalMinutes: 30 } },
    { proactiveSettings: { enabled: false, intervalMinutes: 0 } },
    { proactiveSettings: { enabled: true, intervalMinutes: "30" } },
    { tags: [1] },
    { greeting: "" },
  ])("不正な設定 %j を拒否する", (invalid) => {
    expect(characterSheetSchema.safeParse({ ...profile, ...invalid }).success).toBe(false);
  });
});

describe("character profile local persistence", () => {
  let local: CharacterTestDb;

  beforeAll(async () => {
    local = await openCharacterTestDb();
  });

  afterAll(async () => {
    await local?.dispose();
  });

  it("追加migrationは既存の合成行を保全し、年齢を捏造しない", async () => {
    const migrated = await openCharacterTestDb(async (d1) => {
      await d1.batch([
        d1
          .prepare("INSERT INTO user (id, email, created_at) VALUES (?, ?, ?)")
          .bind("legacy-owner", "legacy@example.invalid", 1),
        d1
          .prepare(
            "INSERT INTO character (id, user_id, name, system_prompt, greeting, tags, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          )
          .bind(
            "legacy-profile",
            "legacy-owner",
            "旧案内係",
            "案内してください。",
            "ようこそ。",
            "[]",
            1,
          ),
      ]);
    });
    try {
      const row = await migrated.d1
        .prepare(
          "SELECT name, system_prompt, greeting, age, introduction, adult_category, proactive_settings FROM character WHERE id = ?",
        )
        .bind("legacy-profile")
        .first();
      expect(row).toEqual({
        name: "旧案内係",
        system_prompt: "案内してください。",
        greeting: "ようこそ。",
        age: null,
        introduction: "",
        adult_category: "general",
        proactive_settings: '{"enabled":false,"intervalMinutes":60}',
      });
      const loaded = await loadCharacter(migrated.db, "legacy-profile");
      expect(loaded.ok).toBeNull();
      expect(loaded.failures[0].issues.map((issue) => issue.path)).toEqual([["age"]]);
    } finally {
      await migrated.dispose();
    }
  });

  it("18歳と全項目を保存し、既存の読出し経路と再起動後で一致する", async () => {
    expect(await saveCharacter(local.db, OWNER, profile)).toEqual(profile);
    expect(await loadCharacter(local.db, profile.id)).toEqual({ ok: profile, failures: [] });
    expect(await loadCharacters(local.db)).toEqual({ ok: [profile], failures: [] });
    await local.reopen();
    expect(await loadCharacter(local.db, profile.id)).toEqual({ ok: profile, failures: [] });
  });

  it("全項目の変更と空タグ・話しかけ無効設定を保存する", async () => {
    const original = { ...profile, id: "update-profile" };
    await saveCharacter(local.db, OWNER, original);
    const updated = {
      ...original,
      name: "受付係",
      introduction: "施設を紹介する受付係です。",
      greeting: "施設へようこそ。",
      systemPrompt: "短く丁寧に案内してください。",
      exampleDialogue: "利用者: 開館時間は。\n受付係: 午前九時です。",
      world: "架空の博物館",
      appearance: "緑の上着",
      age: 24,
      adultCategory: "adult",
      proactiveSettings: { enabled: false, intervalMinutes: 90 },
      tags: [],
    };
    await saveCharacter(local.db, OWNER, updated);
    await local.reopen();
    expect(await loadCharacter(local.db, updated.id)).toEqual({ ok: updated, failures: [] });
  });

  it.each([17, "", "18", "eighteen", null, undefined, 18.5])(
    "年齢 %s の新規保存・更新でDBを変えない",
    async (age) => {
      const [{ n: before }] = await local.db.select({ n: count() }).from(characterTable);
      await expect(
        saveCharacter(local.db, OWNER, { ...profile, id: "invalid-new", age }),
      ).rejects.toThrow();
      await expect(saveCharacter(local.db, OWNER, { ...profile, age })).rejects.toThrow();
      expect(await loadCharacter(local.db, "invalid-new")).toEqual({ ok: null, failures: [] });
      expect(await loadCharacter(local.db, profile.id)).toEqual({ ok: profile, failures: [] });
      const [{ n: after }] = await local.db.select({ n: count() }).from(characterTable);
      expect(after).toBe(before);
    },
  );

  it("別所有者の同一IDを上書きしない", async () => {
    await local.d1
      .prepare("INSERT INTO user (id, email, created_at) VALUES (?, ?, ?)")
      .bind("other-owner", "other@example.invalid", 1)
      .run();
    await expect(saveCharacter(local.db, "other-owner", { ...profile, age: 30 })).rejects.toThrow(
      "character の所有者が一致せん",
    );
    expect(await loadCharacter(local.db, profile.id)).toEqual({ ok: profile, failures: [] });
  });

  it("移行した年齢未確認行は成人と推測せず failures に返す", async () => {
    await local.db.insert(characterTable).values({
      id: "unverified",
      userId: OWNER,
      name: "未確認の案内係",
      systemPrompt: "施設を案内してください。",
      greeting: "こんにちは。",
      tags: [],
      createdAt: 2,
    });
    const result = await loadCharacter(local.db, "unverified");
    expect(result.ok).toBeNull();
    expect(result.failures.map((failure) => failure.id)).toEqual(["unverified"]);
    expect(result.failures[0].issues.map((issue) => issue.path)).toEqual([["age"]]);
  });

  it.each([
    ["tags", "not-json"],
    ["proactive_settings", "not-json"],
    ["proactive_settings", '{"enabled":"yes","intervalMinutes":30}'],
    ["age", 17],
    ["age", "eighteen"],
    ["age", ""],
    ["adult_category", "unknown"],
  ])("壊れた %s の行を隔離し、正常行は読み出す", async (column, value) => {
    const brokenId = "corrupt-profile";
    await saveCharacter(local.db, OWNER, { ...profile, id: brokenId });
    // 列名は固定ケースのみ。アプリの writer を迂回した破損を再現するため。
    await local.d1
      .prepare(`UPDATE character SET ${column} = ? WHERE id = ?`)
      .bind(value, brokenId)
      .run();
    const single = await loadCharacter(local.db, brokenId);
    expect(single.ok).toBeNull();
    expect(single.failures[0].id).toBe(brokenId);
    const all = await loadCharacters(local.db);
    expect(all.ok).toContainEqual(profile);
    expect(all.failures.map((failure) => failure.id)).toContain(brokenId);
    await local.db.delete(characterTable).where(eq(characterTable.id, brokenId));
  });
});
