import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CONVERSATION_XML_HINT,
  PLATFORM_BASE_CONVERSATION,
  PLATFORM_BASE_SCENE,
  PROMPT_VARIANT_DEFAULT_BODY,
  PROMPT_VARIANT_SLOT,
  SCENE_RESPONSE_STRUCTURE,
} from "./prompt-variant-defaults";
import { __resetPromptVariantCacheForTests, getChampionVariant } from "./prompt-variant-store";

// select().from().where().orderBy().limit() チェーンを模倣する最小モック。
// 実 D1 は使わず、buildPlatformPrefix が呼ぶ getChampionVariant の分岐だけを検証する。
const makeDatabase = (
  rows: Array<{ id: string; body: string; phaseScope: string }> | (() => never),
) => {
  const limit = vi.fn(async () => {
    if (typeof rows === "function") return rows();
    return rows;
  });
  const orderBy = vi.fn(() => ({ limit }));
  const where = vi.fn(() => ({ orderBy }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  return { select, limit, orderBy, where, from } as unknown as Parameters<
    typeof getChampionVariant
  >[0] & {
    select: typeof select;
  };
};

describe("prompt-variant-store", () => {
  beforeEach(() => {
    __resetPromptVariantCacheForTests();
  });

  it("returns fallback default body with id=null when D1 has no champion row", async () => {
    const db = makeDatabase([]);
    const result = await getChampionVariant(db, PROMPT_VARIANT_SLOT.platformScene, "climax");
    expect(result).toEqual({
      id: null,
      body: PROMPT_VARIANT_DEFAULT_BODY[PROMPT_VARIANT_SLOT.platformScene],
    });
  });

  it("returns fallback default body with id=null when D1 query throws", async () => {
    const db = makeDatabase(() => {
      throw new Error("d1 unavailable");
    });
    const result = await getChampionVariant(
      db,
      PROMPT_VARIANT_SLOT.sceneResponseStructure,
      "climax",
    );
    expect(result).toEqual({
      id: null,
      body: PROMPT_VARIANT_DEFAULT_BODY[PROMPT_VARIANT_SLOT.sceneResponseStructure],
    });
  });

  it("returns the champion row's id and body when its phase_scope covers the requested phase", async () => {
    const db = makeDatabase([
      { id: "variant-123", body: "custom champion text", phaseScope: "conversation" },
    ]);
    const result = await getChampionVariant(
      db,
      PROMPT_VARIANT_SLOT.platformConversation,
      "conversation",
    );
    expect(result).toEqual({ id: "variant-123", body: "custom champion text" });
  });

  // P6の候補(phase_scope='climax')がchampionへ昇格した場合、一意インデックスにより
  // そのslotの唯一のchampionはclimax限定になる。intimate/erotic/afterglow向けリクエストで
  // その本文が漏れて使われず、既定文面へfallbackすることを確認する(実PR#799レビューで発見)。
  it("falls back to the default body when the champion's phase_scope does not cover the requested phase", async () => {
    const db = makeDatabase([
      { id: "climax-only-champion", body: "climax限定の本文", phaseScope: "climax" },
    ]);
    const result = await getChampionVariant(
      db,
      PROMPT_VARIANT_SLOT.sceneResponseStructure,
      "intimate",
    );
    expect(result).toEqual({
      id: null,
      body: PROMPT_VARIANT_DEFAULT_BODY[PROMPT_VARIANT_SLOT.sceneResponseStructure],
    });
  });

  it("caches within TTL and avoids a second D1 query", async () => {
    const db = makeDatabase([
      { id: "variant-abc", body: "cached body", phaseScope: "conversation" },
    ]);
    const first = await getChampionVariant(
      db,
      PROMPT_VARIANT_SLOT.conversationXmlHint,
      "conversation",
    );
    const second = await getChampionVariant(
      db,
      PROMPT_VARIANT_SLOT.conversationXmlHint,
      "conversation",
    );
    expect(first).toEqual(second);
    expect(db.select).toHaveBeenCalledTimes(1);
  });

  // P1受け入れ基準: buildPlatformPrefixが読むchampion本文はハードコード既定文面と
  // バイト同一でなければならない(挙動ゼロ変化)。ソースはprompt-variant-defaults.tsに
  // 一本化されているため、ここでは各定数の内容がそのままエクスポートされていることを確認する。
  it("PROMPT_VARIANT_DEFAULT_BODY exposes the exact source constants byte-for-byte", () => {
    expect(PROMPT_VARIANT_DEFAULT_BODY[PROMPT_VARIANT_SLOT.platformScene]).toBe(
      PLATFORM_BASE_SCENE,
    );
    expect(PROMPT_VARIANT_DEFAULT_BODY[PROMPT_VARIANT_SLOT.sceneResponseStructure]).toBe(
      SCENE_RESPONSE_STRUCTURE,
    );
    expect(PROMPT_VARIANT_DEFAULT_BODY[PROMPT_VARIANT_SLOT.platformConversation]).toBe(
      PLATFORM_BASE_CONVERSATION,
    );
    expect(PROMPT_VARIANT_DEFAULT_BODY[PROMPT_VARIANT_SLOT.conversationXmlHint]).toBe(
      CONVERSATION_XML_HINT,
    );
  });

  // 手書きmigration(drizzle/0047_*.sql)のCREATE TABLE列がschema.tsとズレていないことの
  // 最低限の防止線。P1では drizzle-kit generate がTTY要求で使えなかった経緯があるため
  // (プロンプト内コメント参照)、次にschemaを変更する人が手書きSQLの存在に気づけるようにする。
  it("the hand-written P1 migration file exists and defines prompt_variant", () => {
    const migrationPath = join(
      import.meta.dirname,
      "..",
      "..",
      "drizzle",
      "0047_prompt_variant_quality_measurement.sql",
    );
    const sql = readFileSync(migrationPath, "utf8");
    expect(sql).toContain("CREATE TABLE prompt_variant");
    expect(sql).toContain("CREATE TABLE quality_measurement");
    expect(sql).toContain("CREATE TABLE promotion_log");
    // reason 列は 0047_message_feedback_reason.sql の担当。ここで重複追加すると
    // 新品D1が duplicate column name で死ぬため、含まれていないことを固定する。
    expect(sql).not.toContain("ADD COLUMN reason");
    expect(sql).toContain("ALTER TABLE message_feedback ADD COLUMN variant_id TEXT");
  });
});
