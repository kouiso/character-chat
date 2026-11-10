// seed 済みローカル D1 の character 全件を loadCharacters（Drizzle → zod）に通す。
// 1 行でも落ちたら、その id と issues を出力して FAIL にする（schema を緩めて通さん）。
import { count, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { characterTable } from "../../../src/schema/character";
import { userTable } from "../../../src/schema/user";

import {
  characterSheetSchema,
  listCharacterSummaries,
  loadCharacter,
  loadCharacters,
} from "./character";
import { openLocalD1, type LocalD1 } from "./test/local-d1";

describe("loadCharacters / loadCharacter", () => {
  let local: LocalD1;

  beforeAll(async () => {
    local = await openLocalD1();
  });

  afterAll(async () => {
    await local.dispose();
  });

  it("seed 済み character は全件 zod を通る", async () => {
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

  it("一覧には本文や内部設定を含めず必要な項目を返す", async () => {
    const summaries = await listCharacterSummaries(local.db);
    expect(summaries.length).toBeGreaterThan(0);
    expect(Object.keys(summaries[0]).sort()).toEqual([
      "avatar",
      "canEdit",
      "id",
      "name",
      "playCount",
    ]);
    expect(summaries.every(({ canEdit }) => typeof canEdit === "boolean")).toBe(true);
    // RIT-30 ギャップ: クリップ未作成のキャラは再生数 0。
    expect(summaries.every(({ playCount }) => playCount === 0)).toBe(true);
  });

  it("owner detail reads and display lists hide private characters from other users", async () => {
    const id = crypto.randomUUID();
    const ownerId = crypto.randomUUID();
    await local.db.insert(userTable).values({
      id: ownerId,
      email: `${ownerId}@example.invalid`,
      createdAt: Date.now(),
    });
    try {
      await local.db.insert(characterTable).values({
        id,
        userId: ownerId,
        name: "非公開キャラクター",
        systemPrompt: "内部設定。",
        greeting: "こんにちは。",
        tags: [],
        createdAt: Date.now(),
      });

      await expect(loadCharacter(local.db, id, "local")).resolves.toEqual({
        ok: null,
        failures: [],
      });
      expect((await listCharacterSummaries(local.db, "local")).some((row) => row.id === id)).toBe(
        false,
      );
      await expect(loadCharacter(local.db, id, ownerId)).resolves.toMatchObject({
        ok: { id },
        failures: [],
      });

      await local.db
        .update(characterTable)
        .set({ isOfficial: true })
        .where(eq(characterTable.id, id));
      await expect(loadCharacter(local.db, id, "local")).resolves.toMatchObject({
        ok: { id },
        failures: [],
      });
      const officialSummary = (await listCharacterSummaries(local.db, "local")).find(
        (row) => row.id === id,
      );
      expect(officialSummary).toMatchObject({ id, canEdit: false });
    } finally {
      await local.db.delete(characterTable).where(eq(characterTable.id, id));
      await local.db.delete(userTable).where(eq(userTable.id, ownerId));
    }
  });

  it("複数 owner を渡すと旧名義のキャラも読め、canEdit は primary だけ", async () => {
    const id = crypto.randomUUID();
    const legacyOwner = `legacy-${crypto.randomUUID()}`;
    await local.db.insert(userTable).values({
      id: legacyOwner,
      email: `${legacyOwner}@example.invalid`,
      createdAt: Date.now(),
    });
    try {
      await local.db.insert(characterTable).values({
        id,
        userId: legacyOwner,
        name: "旧名義キャラクター",
        systemPrompt: "内部設定。",
        greeting: "こんにちは。",
        tags: [],
        createdAt: Date.now(),
      });
      const owners = ["local", legacyOwner];
      await expect(loadCharacter(local.db, id, owners)).resolves.toMatchObject({
        ok: { id },
        failures: [],
      });
      const summary = (await listCharacterSummaries(local.db, owners)).find((row) => row.id === id);
      expect(summary).toMatchObject({ id, canEdit: false });
      // 他者名義は混ざらん。
      await expect(loadCharacter(local.db, id, ["local", "someone-else"])).resolves.toEqual({
        ok: null,
        failures: [],
      });
    } finally {
      await local.db.delete(characterTable).where(eq(characterTable.id, id));
      await local.db.delete(userTable).where(eq(userTable.id, legacyOwner));
    }
  });

  it("壊れた行は投げずに failures へ寄せる", () => {
    const parsed = characterSheetSchema.safeParse({
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
