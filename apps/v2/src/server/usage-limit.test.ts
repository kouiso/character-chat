// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openLocalD1, type LocalD1 } from "../../../../packages/db/src/test/local-d1";

import { checkDailyTurnLimit, dailyTurnLimit, jstDayStartMs } from "./usage-limit";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("dailyTurnLimit", () => {
  it("env の数字がそのまま上限になる", () => {
    expect(dailyTurnLimit({ V2_DAILY_TURN_LIMIT: "3" })).toBe(3);
  });
  it("未設定・不正なら既定 300", () => {
    expect(dailyTurnLimit({})).toBe(300);
    expect(dailyTurnLimit({ V2_DAILY_TURN_LIMIT: "abc" })).toBe(300);
    expect(dailyTurnLimit({ V2_DAILY_TURN_LIMIT: "-5" })).toBe(300);
  });
});

describe("jstDayStartMs", () => {
  it("JST の日付境界で始まる", () => {
    // 2026-11-09 00:30 JST = 2026-11-08 15:30 UTC。その日の始まりは 2026-11-08 15:00 UTC。
    const now = Date.UTC(2026, 10, 8, 15, 30);
    expect(jstDayStartMs(now)).toBe(Date.UTC(2026, 10, 8, 15, 0));
    // UTC 23:59 は JST 翌朝 8:59 — JST の始まりは同日 UTC 15:00。
    expect(jstDayStartMs(Date.UTC(2026, 10, 8, 23, 59))).toBe(Date.UTC(2026, 10, 8, 15, 0));
    // JST 0 時ちょうど（UTC 15:00）。
    expect(jstDayStartMs(Date.UTC(2026, 10, 8, 15, 0))).toBe(Date.UTC(2026, 10, 8, 15, 0));
  });
});

describe("checkDailyTurnLimit", () => {
  let local: LocalD1;

  const characterId = "usage-limit-test-character";

  beforeEach(async () => {
    local = await openLocalD1();
    await local.d1
      .prepare("INSERT OR IGNORE INTO user (id, email, created_at) VALUES ('local', 'l@l', 0)")
      .run();
    await local.d1
      .prepare(
        `INSERT OR IGNORE INTO character
          (id, user_id, name, system_prompt, greeting, tags, created_at)
         VALUES (?, 'local', '上限試験役', 'テスト', 'こんにちは', '["test"]', 0)`,
      )
      .bind(characterId)
      .run();
  });

  afterEach(async () => {
    await local.dispose();
  });

  it("使った数が上限未満なら allowed、達したら止まる", async () => {
    const env = { V2_DAILY_TURN_LIMIT: "1" };
    const userId = `limit-user-${crypto.randomUUID()}`;
    const before = await checkDailyTurnLimit(local.db, env, Date.now(), userId);
    expect(before.allowed).toBe(true);
    // 今日分の発言を1つ直接 INSERT する
    const convId = `limit-${crypto.randomUUID()}`;
    const now = Date.now();
    await local.d1
      .prepare(
        "INSERT INTO v2_conversation (id, user_id, character_id, thread_id, prompt_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(convId, userId, characterId, "main", "test", now, now)
      .run();
    await local.d1
      .prepare(
        "INSERT INTO v2_message (id, conversation_id, turn, role, content, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .bind(crypto.randomUUID(), convId, 1, "user", "発言", now)
      .run();
    const after = await checkDailyTurnLimit(local.db, env, now, userId);
    expect(after.used).toBeGreaterThanOrEqual(1);
    expect(after.allowed).toBe(false);
  });

  it("昨日の発言は今日の回数に入らん", async () => {
    const env = { V2_DAILY_TURN_LIMIT: "1" };
    const userId = `limit-user-${crypto.randomUUID()}`;
    const convId = `limit-${crypto.randomUUID()}`;
    const now = Date.now();
    await local.d1
      .prepare(
        "INSERT INTO v2_conversation (id, user_id, character_id, thread_id, prompt_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(convId, userId, characterId, "main", "test", now, now)
      .run();
    // 昨日の発言は回数に入れん
    await local.d1
      .prepare(
        "INSERT INTO v2_message (id, conversation_id, turn, role, content, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .bind(crypto.randomUUID(), convId, 1, "user", "昨日の発言", now - DAY_MS)
      .run();
    const result = await checkDailyTurnLimit(local.db, env, now, userId);
    expect(result.used).toBe(0);
    expect(result.allowed).toBe(true);
  });
});
