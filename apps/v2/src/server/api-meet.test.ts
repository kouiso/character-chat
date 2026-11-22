// @vitest-environment node
// 出会う（板 Meet・MeetList・MeetEmpty）: 会える子の一覧と「とっておく」。
// 見せる範囲（local・公式・移行元名義）は canAccessCharacter と同じ定義であること、
// とっておくが他の人に見えんこと、冪等であることを確かめる。
import { characterTable, ensureLocalUser, v2ConversationTable } from "@v2/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { userTable } from "../../../../src/schema/user";

import {
  FRESH_LOCAL_D1_TIMEOUT_MS,
  openLocalD1,
  type LocalD1,
} from "../../../../packages/db/src/test/local-d1";

const platform = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
vi.mock("./platform", () => ({ getPlatform: async () => ({ env: platform.env }) }));

const { listMeetCharacters, handleKeepSet, handleKeepUnset } = await import("./api-meet");

const now = Date.now();

const seedCharacter = async (
  local: LocalD1,
  over: {
    id: string;
    userId: string;
    name: string;
    isOfficial?: boolean;
    displayOrder?: number;
    tags?: string[];
  },
) => {
  await local.db.insert(characterTable).values({
    id: over.id,
    userId: over.userId,
    name: over.name,
    isOfficial: over.isOfficial ?? false,
    systemPrompt: "テスト用です。",
    greeting: "こんばんは。",
    tags: over.tags ?? ["幼なじみ", "甘々"],
    displayOrder: over.displayOrder ?? 0,
    createdAt: now,
  });
};

describe("出会う", () => {
  let local: LocalD1;

  const ownId = crypto.randomUUID();
  const officialId = crypto.randomUUID();
  const otherUserId = `other-${crypto.randomUUID()}`;
  const otherId = crypto.randomUUID();
  const legacySourceId = `legacy-${crypto.randomUUID()}`;
  const legacyId = crypto.randomUUID();

  beforeAll(async () => {
    local = await openLocalD1();
    platform.env = { DB: local.d1 };
    await ensureLocalUser(local.db);
    // 外部キーの都合で、置くキャラの持ち主ぶんの user 行を先に立てる
    for (const userId of ["system", otherUserId, legacySourceId]) {
      await local.db.insert(userTable).values({
        id: userId,
        email: `${userId}@example.invalid`,
        createdAt: now,
      });
    }
    await seedCharacter(local, { id: ownId, userId: "local", name: "自分の子" });
    await seedCharacter(local, {
      id: officialId,
      userId: "system",
      name: "公式の子",
      isOfficial: true,
    });
    await seedCharacter(local, { id: otherId, userId: otherUserId, name: "他人の子" });
    await seedCharacter(local, { id: legacyId, userId: legacySourceId, name: "移行した子" });
    // 移行元名義のキャラは、移行で持ち込まれた会話（legacy_source_user_id）で見える
    await local.db.insert(v2ConversationTable).values({
      id: crypto.randomUUID(),
      userId: "local",
      legacySourceUserId: legacySourceId,
      characterId: legacyId,
      threadId: crypto.randomUUID(),
      promptVersion: "test",
      createdAt: now,
      updatedAt: now,
    });
  }, FRESH_LOCAL_D1_TIMEOUT_MS);

  afterAll(async () => {
    platform.env = {};
    await local.dispose();
  });

  it("local・公式・移行元名義の子を出し、他人の子は出さん", async () => {
    const items = await listMeetCharacters(local.d1);
    const ids = items.map((item) => item.id);
    expect(ids).toContain(ownId);
    expect(ids).toContain(officialId);
    expect(ids).toContain(legacyId);
    expect(ids).not.toContain(otherId);

    const official = items.find((item) => item.id === officialId);
    const own = items.find((item) => item.id === ownId);
    const legacy = items.find((item) => item.id === legacyId);
    expect(official?.official).toBe(true);
    expect(official?.own).toBe(false);
    expect(own?.own).toBe(true);
    // 移行した子も「つくった子」として出す（元の持ち主は同じ人）
    expect(legacy?.own).toBe(true);
  });

  it("公式の子が先に並ぶ（板 MeetList の並び）", async () => {
    const items = await listMeetCharacters(local.d1);
    const officialIndex = items.findIndex((item) => item.id === officialId);
    const ownIndex = items.findIndex((item) => item.id === ownId);
    expect(officialIndex).toBeGreaterThanOrEqual(0);
    expect(officialIndex).toBeLessThan(ownIndex);
  });

  it("話したことがある子には最後に話した時刻がつく", async () => {
    const items = await listMeetCharacters(local.d1);
    expect(items.find((item) => item.id === legacyId)?.lastTalkedAt).not.toBeNull();
    expect(items.find((item) => item.id === ownId)?.lastTalkedAt).toBeNull();
  });

  it("とっておく・外すが冪等で、keptAt が一覧に出る", async () => {
    let res = await handleKeepSet(ownId);
    expect(res.status).toBe(200);
    // 2 回目も失敗しない
    res = await handleKeepSet(ownId);
    expect(res.status).toBe(200);

    let items = await listMeetCharacters(local.d1);
    expect(items.find((item) => item.id === ownId)?.keptAt).not.toBeNull();
    expect(items.find((item) => item.id === officialId)?.keptAt).toBeNull();

    res = await handleKeepUnset(ownId);
    expect(res.status).toBe(200);
    items = await listMeetCharacters(local.d1);
    expect(items.find((item) => item.id === ownId)?.keptAt).toBeNull();
  });

  it("とっておきは人ごとに別の印（他人の一覧には出ない）", async () => {
    // 他人が公式の子をとっておいても、自分の一覧には keptAt が出ない
    await local.d1
      .prepare("INSERT INTO v2_character_keep (character_id, user_id, kept_at) VALUES (?, ?, ?)")
      .bind(officialId, otherUserId, now)
      .run();
    const mine = await listMeetCharacters(local.d1);
    expect(mine.find((item) => item.id === officialId)?.keptAt).toBeNull();
    const theirs = await listMeetCharacters(local.d1, otherUserId);
    expect(theirs.find((item) => item.id === officialId)?.keptAt).not.toBeNull();
    await local.d1
      .prepare("DELETE FROM v2_character_keep WHERE character_id = ? AND user_id = ?")
      .bind(officialId, otherUserId)
      .run();
  });

  it("見えないキャラはとっておけない（404）", async () => {
    const res = await handleKeepSet(otherId);
    expect(res.status).toBe(404);
    const res2 = await handleKeepSet(crypto.randomUUID());
    expect(res2.status).toBe(404);
  });

  it("札のJSONが壊れた行は札なしで出す", async () => {
    const brokenId = crypto.randomUUID();
    await local.d1
      .prepare(
        "INSERT INTO character (id, user_id, name, is_official, system_prompt, greeting, tags, display_order, revision, created_at) VALUES (?, 'local', ?, 0, 'x', 'y', ?, 0, 0, ?)",
      )
      .bind(brokenId, "壊れた札の子", "{not-json", now)
      .run();
    const items = await listMeetCharacters(local.d1);
    const broken = items.find((item) => item.id === brokenId);
    expect(broken).toBeDefined();
    expect(broken?.tags).toEqual([]);
    await local.d1.prepare("DELETE FROM character WHERE id = ?").bind(brokenId).run();
  });
});
