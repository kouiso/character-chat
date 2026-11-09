// RIT-198: 記憶キュー判定の確かめ — 記念日・昨日の話・久しぶりの3系統と、
// キュー無し・記憶無しの見送りを実 D1 で見る。
// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { openLocalD1, type LocalD1 } from "../../../../packages/db/src/test/local-d1";

import { findRecallCue, LONGTIME_DAYS } from "./proactive-recall";

const DAY_MS = 24 * 60 * 60 * 1000;
const JAPAN_OFFSET_MS = 9 * 60 * 60 * 1000;

let local: LocalD1;
const now = Date.parse("2026-11-09T12:00:00.000Z"); // JST 21:00
const owner = "local";

const japanDay = (time: number): string =>
  new Date(time + JAPAN_OFFSET_MS).toISOString().slice(0, 10);

const newCharacter = async (): Promise<string> => {
  const id = crypto.randomUUID();
  await local.d1
    .prepare(
      "INSERT INTO character (id, user_id, name, system_prompt, greeting, tags, created_at) VALUES (?,?,?,?,?,?,?)",
    )
    .bind(id, owner, "想起役", "テスト用", "こんにちは", "[]", now)
    .run();
  return id;
};

const seedConversation = async (characterId: string): Promise<string> => {
  const conversationId = crypto.randomUUID();
  await local.d1
    .prepare(
      "INSERT INTO v2_conversation (id, user_id, character_id, thread_id, prompt_version, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
    )
    .bind(conversationId, owner, characterId, conversationId, "test", now, now)
    .run();
  return conversationId;
};

const seedMemory = async (conversationId: string, content: string, createdAt: number) => {
  await local.d1
    .prepare(
      "INSERT INTO v2_memory (id, conversation_id, kind, content, pinned, created_at) VALUES (?,?,?,?,?,?)",
    )
    .bind(crypto.randomUUID(), conversationId, "fact", content, 0, createdAt)
    .run();
};

const seedMessage = async (conversationId: string, createdAt: number) => {
  await local.d1
    .prepare(
      "INSERT INTO v2_message (id, conversation_id, turn, role, content, created_at) VALUES (?,?,?,?,?,?)",
    )
    .bind(crypto.randomUUID(), conversationId, 1, "user", "やあ", createdAt)
    .run();
};

const cueFor = (characterId: string) =>
  findRecallCue(local.d1, { userId: owner, characterId, now });

beforeAll(async () => {
  local = await openLocalD1();
  await local.d1
    .prepare("INSERT OR IGNORE INTO user (id, email, created_at) VALUES ('local','l@l',0)")
    .run();
}, 60_000);

afterAll(async () => {
  await local?.dispose();
});

describe("findRecallCue", () => {
  it("30日前の記憶は記念日キューになる", async () => {
    const characterId = await newCharacter();
    const conversationId = await seedConversation(characterId);
    await seedMemory(conversationId, "初めて出会った日", now - 30 * DAY_MS);
    expect(await cueFor(characterId)).toEqual({
      kind: "anniversary",
      days: 30,
      content: "初めて出会った日",
    });
  });

  it("JST 前日に作られた記憶は「昨日の話」キューになる", async () => {
    const characterId = await newCharacter();
    const conversationId = await seedConversation(characterId);
    const yesterdayNoonUtc = Date.parse(`${japanDay(now - DAY_MS)}T03:00:00.000Z`);
    expect(japanDay(yesterdayNoonUtc)).toBe(japanDay(now - DAY_MS));
    await seedMemory(conversationId, "昨日ケーキを食べた話", yesterdayNoonUtc);
    expect(await cueFor(characterId)).toEqual({
      kind: "yesterday",
      content: "昨日ケーキを食べた話",
    });
  });

  it("記念日と昨日が競合したら記念日が優先", async () => {
    const characterId = await newCharacter();
    const conversationId = await seedConversation(characterId);
    const yesterdayNoonUtc = Date.parse(`${japanDay(now - DAY_MS)}T03:00:00.000Z`);
    await seedMemory(conversationId, "昨日の雑談", yesterdayNoonUtc);
    await seedMemory(conversationId, "30日前の約束", now - 30 * DAY_MS);
    expect((await cueFor(characterId))?.kind).toBe("anniversary");
  });

  it("直近会話が古く記憶だけ新しければ「久しぶり」キュー", async () => {
    const characterId = await newCharacter();
    const conversationId = await seedConversation(characterId);
    await seedMessage(conversationId, now - (LONGTIME_DAYS + 1) * DAY_MS);
    await seedMemory(conversationId, "ユーザーの誕生日は春", now - (LONGTIME_DAYS + 1) * DAY_MS);
    expect(await cueFor(characterId)).toEqual({
      kind: "longtime",
      content: "ユーザーの誕生日は春",
    });
  });

  it("直近に会話があり節目でも前日でも無ければ送らん", async () => {
    const characterId = await newCharacter();
    const conversationId = await seedConversation(characterId);
    await seedMessage(conversationId, now - DAY_MS);
    await seedMemory(conversationId, "10日前のメモ", now - 10 * DAY_MS);
    expect(await cueFor(characterId)).toBeNull();
  });

  it("記憶が無い・会話が無いキャラはキュー無し", async () => {
    const characterId = await newCharacter();
    expect(await cueFor(characterId)).toBeNull();
    const conversationId = await seedConversation(characterId);
    void conversationId;
    expect(await cueFor(characterId)).toBeNull();
  });
});
