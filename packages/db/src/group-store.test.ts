import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  addGroupMember,
  createGroup,
  listGroupContinuations,
  listGroupHistory,
  listGroupMembers,
  listGroupMemories,
  rememberGroupEvent,
  saveGroupMessage,
  updateGroupMessageProvider,
} from "./group-store";
import { openLocalD1, type LocalD1 } from "./test/local-d1";

const NOW = 1_800_000_000_000;

describe("group-store", () => {
  let local: LocalD1;
  let groupId: string;

  beforeEach(async () => {
    local = await openLocalD1();
    groupId = await createGroup(local.db, {
      userId: "u-group-test",
      title: "テストの場",
      promptVersion: "test",
      now: NOW,
    });
  });

  afterEach(async () => {
    await local.dispose();
  });

  const addThree = async () => {
    await addGroupMember(local.db, { groupId, characterId: "char-a", position: 0, now: NOW });
    await addGroupMember(local.db, { groupId, characterId: "char-b", position: 1, now: NOW });
    await addGroupMember(local.db, { groupId, characterId: "char-c", position: 2, now: NOW });
  };

  it("メンバーは position 順で返る", async () => {
    await addThree();
    const members = await listGroupMembers(local.db, groupId);
    expect(members.map((m) => m.characterId)).toEqual(["char-a", "char-b", "char-c"]);
  });

  it("発言は turn 連番で積まれ、speaker と voiceMismatch が残る", async () => {
    await saveGroupMessage(local.db, {
      groupId,
      speakerCharacterId: null,
      content: "みんな元気？",
      now: NOW,
    });
    await saveGroupMessage(local.db, {
      groupId,
      speakerCharacterId: "char-a",
      content: "元気だよ",
      voiceMismatch: 0,
      now: NOW + 1,
    });
    await saveGroupMessage(local.db, {
      groupId,
      speakerCharacterId: "char-b",
      content: "ボクも元気",
      voiceMismatch: 1,
      now: NOW + 2,
    });
    const history = await listGroupHistory(local.db, groupId);
    expect(history.map((h) => h.turn)).toEqual([1, 2, 3]);
    expect(history[1].speakerCharacterId).toBe("char-a");
    expect(history[2].voiceMismatch).toBe(1);
  });

  it("保存した発言の provider は後から id で追記できる（RIT-100 の遅延解決）", async () => {
    const { id } = await saveGroupMessage(local.db, {
      groupId,
      speakerCharacterId: "char-a",
      content: "やあ",
      provider: null,
      now: NOW,
    });
    await updateGroupMessageProvider(local.db, id, "Wafer");
    const history = await listGroupHistory(local.db, groupId);
    expect(history[0]).toMatchObject({ provider: "Wafer" });
  });

  it("つづきから用の場一覧: 新しい発言順、直近の発言と話し手・position 順メンバーを返す", async () => {
    // ローカル D1 はテスト間で残るので、この検査だけの名義で場を立てる
    const uid = `u-cont-${crypto.randomUUID()}`;
    const firstId = await createGroup(local.db, {
      userId: uid,
      title: "一つ目の場",
      promptVersion: "test",
      now: NOW,
    });
    const secondId = await createGroup(local.db, {
      userId: uid,
      title: "二つ目の場",
      promptVersion: "test",
      now: NOW + 1,
    });
    await addGroupMember(local.db, {
      groupId: firstId,
      characterId: "char-a",
      position: 0,
      now: NOW,
    });
    await addGroupMember(local.db, {
      groupId: firstId,
      characterId: "char-b",
      position: 1,
      now: NOW,
    });
    await saveGroupMessage(local.db, {
      groupId: firstId,
      speakerCharacterId: "char-b",
      content: "あとで駅前ね",
      now: NOW + 10,
    });
    const rows = await listGroupContinuations(local.db, uid);
    expect(rows).toHaveLength(2);
    // 発言(NOW+10)のある場が、作っただけの場(NOW+1)より先に来る
    expect(rows[0].id).toBe(firstId);
    expect(rows[0].updatedAt).toBe(NOW + 10);
    expect(rows[0].speakerCharacterId).toBe("char-b");
    expect(rows[0].lastMessage).toBe("あとで駅前ね");
    expect(rows[0].memberIds).toEqual(["char-a", "char-b"]);
    // 発言の無い場は場の更新時刻で並び、話し手・文・memberIds は空
    expect(rows[1].id).toBe(secondId);
    expect(rows[1].updatedAt).toBe(NOW + 1);
    expect(rows[1].speakerCharacterId).toBeNull();
    expect(rows[1].lastMessage).toBeNull();
    expect(rows[1].memberIds).toEqual([]);
  });

  it("場の出来事はメンバー全員の記憶へ入り、場外のキャラには入らん", async () => {
    await addThree();
    await rememberGroupEvent(local.db, {
      groupId,
      characterIds: ["char-a", "char-b"],
      content: "みんなで海へ行った",
      now: NOW,
    });
    expect(await listGroupMemories(local.db, { groupId, characterId: "char-a" })).toEqual([
      "みんなで海へ行った",
    ]);
    expect(await listGroupMemories(local.db, { groupId, characterId: "char-b" })).toHaveLength(1);
    // char-c はイベント時点の参加者に含めておらず、知らない
    expect(await listGroupMemories(local.db, { groupId, characterId: "char-c" })).toHaveLength(0);
  });
});
