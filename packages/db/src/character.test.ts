// 既存DBやキャラ本文に依存せず、専用の合成D1で読出し経路を確認する。
import { count } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { characterTable } from "../../../src/schema/character";

import { characterSheetSchema, loadCharacter, loadCharacters, saveCharacter } from "./character";
import { characterFixture } from "./test/character-fixture";
import { openCharacterTestDb, type CharacterTestDb } from "./test/character-local-d1";

describe("loadCharacters / loadCharacter", () => {
  let local: CharacterTestDb;

  beforeAll(async () => {
    local = await openCharacterTestDb();
    await saveCharacter(local.db, "synthetic-owner", characterFixture);
  });

  afterAll(async () => {
    await local?.dispose();
  });

  it("合成 character は全件 zod を通る", async () => {
    const [{ n }] = await local.db.select({ n: count() }).from(characterTable);
    const result = await loadCharacters(local.db);
    // 件数と通過数はレポート用に必ず出す（局長へ n / pass を報告する根拠）。
    process.stdout.write(
      `loadCharacters: n=${n} zodPassed=${result.ok.length} failures=${result.failures.length}\n`,
    );
    const failureReport = result.failures
      .map((failure) => `${failure.id}: ${JSON.stringify(failure.issues)}`)
      .join("\n");
    expect(result.failures, failureReport).toEqual([]);
    expect(result.ok).toHaveLength(n);
    expect(n).toBeGreaterThan(0);
    for (const sheet of result.ok) {
      expect(characterSheetSchema.safeParse(sheet).success).toBe(true);
    }
  });

  it("loadCharacter は 1 件を返し、未知の id は ok null / failures 空", async () => {
    const all = await loadCharacters(local.db);
    const first = all.ok[0];
    expect(first).toBeDefined();
    const single = await loadCharacter(local.db, first.id);
    expect(single).toEqual({ ok: first, failures: [] });

    const missing = await loadCharacter(local.db, `missing-${crypto.randomUUID()}`);
    expect(missing).toEqual({ ok: null, failures: [] });
  });

  it("壊れた行は投げずに failures へ寄せる", () => {
    const parsed = characterSheetSchema.safeParse({
      ...characterFixture,
      id: "x",
      name: "",
      systemPrompt: "s",
      greeting: "g",
      tags: "not-an-array",
      avatar: null,
      gender: null,
      slug: null,
      isOfficial: false,
      displayOrder: 0,
      createdAt: 0,
    });
    expect(parsed.success).toBe(false);
    expect(parsed.success ? [] : parsed.error.issues.map((issue) => issue.path[0])).toEqual([
      "name",
      "tags",
    ]);
  });
});
