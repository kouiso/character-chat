// @vitest-environment node
// RIT-216: 場一覧と表示データ（発言者名つき履歴）の検証。
import { addGroupMember, createGroup, listGroups, saveGroupMessage } from "@v2/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ waitUntil: () => undefined }));

import { openLocalD1, type LocalD1 } from "../../../../packages/db/src/test/local-d1";

import { loadGroupView } from "./api-group";

const NAMES: Record<string, string> = { "char-a": "爺や", "char-b": "小娘" };

const setup = async (local: LocalD1, userId = `u-${crypto.randomUUID()}`) => {
  const groupId = await createGroup(local.db, {
    userId,
    title: "二人の場",
    promptVersion: "test",
    now: 1,
  });
  for (const [i, id] of ["char-a", "char-b"].entries()) {
    await addGroupMember(local.db, { groupId, characterId: id, position: i, now: 1 });
  }
  return { groupId, userId };
};

describe("listGroups", () => {
  let local: LocalD1;

  beforeEach(async () => {
    local = await openLocalD1();
  }, 30000);

  afterEach(async () => {
    await local.dispose();
  });

  it("自分の場だけがメンバーIDつきで返る", async () => {
    const { groupId, userId } = await setup(local);
    await createGroup(local.db, {
      userId: `u-other-${crypto.randomUUID()}`,
      title: "他人の場",
      promptVersion: "test",
      now: 2,
    });
    const groups = await listGroups(local.db, userId);
    expect(groups).toHaveLength(1);
    expect(groups[0].id).toBe(groupId);
    expect(groups[0].memberIds).toEqual(["char-a", "char-b"]);
  });
});

describe("loadGroupView", () => {
  let local: LocalD1;

  beforeEach(async () => {
    local = await openLocalD1();
  }, 30000);

  afterEach(async () => {
    await local.dispose();
  });

  it("発言がどのキャラのものか分かる speakerName が付く", async () => {
    const { groupId } = await setup(local);
    await saveGroupMessage(local.db, {
      groupId,
      speakerCharacterId: null,
      content: "こんにちは",
      now: 2,
    });
    await saveGroupMessage(local.db, {
      groupId,
      speakerCharacterId: "char-a",
      content: "ほう、元気か",
      now: 3,
    });
    const view = await loadGroupView(local.db, groupId, async (id) => NAMES[id] ?? null);
    expect(view?.members.map((m) => m.name)).toEqual(["爺や", "小娘"]);
    expect(view?.messages.map((m) => m.speakerName)).toEqual([null, "爺や"]);
  });

  it("存在しない場は null", async () => {
    expect(await loadGroupView(local.db, "nope", async () => null)).toBeNull();
  });
});
