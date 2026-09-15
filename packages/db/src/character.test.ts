// seed 済みローカル D1 の character 全件を loadCharacters（Drizzle → zod）に通す。
// 1 行でも落ちたら、その id と issues を出力して FAIL にする（schema を緩めて通さん）。
import { count } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { characterTable } from "../../../src/schema/character";

import { characterSheetSchema, loadCharacter, loadCharacters } from "./character";
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
