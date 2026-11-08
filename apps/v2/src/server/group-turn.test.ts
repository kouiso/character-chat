// @vitest-environment node
import { AIMessageChunk } from "@langchain/core/messages";
import { FakeListChatModel } from "@langchain/core/utils/testing";
import { addGroupMember, createGroup, listGroupHistory, listGroupMemories } from "@v2/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openLocalD1, type LocalD1 } from "../../../../packages/db/src/test/local-d1";

import { pickNextSpeaker, postUserToGroup, runGroupTurn } from "./group-turn";

const CHARACTERS: Record<string, { name: string; systemPrompt: string }> = {
  "char-a": { name: "爺や", systemPrompt: "あなたは爺やです。一人称は「わし」。" },
  "char-b": { name: "小娘", systemPrompt: "あなたは小娘です。一人称は「あたし」。" },
  "char-c": { name: "無口", systemPrompt: "あなたは無口です。一人称は「ボク」。" },
};

const makeModel = (responder: (speaker: string) => string) =>
  new (class extends FakeListChatModel {
    override async invoke(input: { role: string; content: string }[]) {
      const prompt = input[0]?.content ?? "";
      const speaker =
        Object.entries(CHARACTERS).find(([, c]) => prompt.includes(c.systemPrompt))?.[0] ?? "?";
      return new AIMessageChunk(responder(speaker));
    }
  })({ responses: ["unused"] });

const setup = async (local: LocalD1) => {
  const groupId = await createGroup(local.db, {
    userId: "u-group-turn",
    title: "3人の場",
    promptVersion: "test",
    now: 1,
  });
  for (const [i, id] of ["char-a", "char-b", "char-c"].entries()) {
    await addGroupMember(local.db, { groupId, characterId: id, position: i, now: 1 });
  }
  return groupId;
};

describe("pickNextSpeaker", () => {
  it("直前の発言者を外し、発言回数の最少者を取る", () => {
    const members = ["a", "b", "c"];
    expect(pickNextSpeaker(members, [])).toBe("a");
    expect(pickNextSpeaker(members, [{ speakerCharacterId: "a" }])).toBe("b");
    expect(
      pickNextSpeaker(members, [
        { speakerCharacterId: "a" },
        { speakerCharacterId: "b" },
        { speakerCharacterId: "a" },
      ]),
    ).toBe("c");
  });
});

describe("runGroupTurn", () => {
  let local: LocalD1;
  let groupId: string;

  beforeEach(async () => {
    local = await openLocalD1();
    groupId = await setup(local);
  });

  afterEach(async () => {
    await local.dispose();
  });

  it("3人の場で20ターン回して全員が1回以上話し、同じ人が5回連続で話さん", async () => {
    const deps = {
      db: local.db,
      model: makeModel((s) => `「${s}の発言」`),
      loadCharacter: async (id: string) => CHARACTERS[id] ?? null,
      now: () => 1,
    };
    const speakers: string[] = [];
    for (let i = 0; i < 20; i++) {
      const result = await runGroupTurn(deps, { groupId });
      expect(result).not.toBeNull();
      speakers.push(result?.speakerCharacterId ?? "");
    }
    for (const id of ["char-a", "char-b", "char-c"]) {
      expect(speakers.filter((s) => s === id).length).toBeGreaterThanOrEqual(1);
    }
    for (let i = 4; i < speakers.length; i++) {
      expect(new Set(speakers.slice(i - 4, i + 1)).size).toBeGreaterThan(1);
    }
    const history = await listGroupHistory(local.db, groupId);
    expect(history).toHaveLength(20);
  });

  it("その場にいなかったキャラは場の出来事を知らん", async () => {
    const deps = {
      db: local.db,
      model: makeModel(() => "テスト発言"),
      loadCharacter: async (id: string) => CHARACTERS[id] ?? null,
      now: () => 1,
    };
    await postUserToGroup(local.db, { groupId, content: "みんなで祭りへ行った", now: 1 });
    await runGroupTurn(deps, { groupId });
    for (const id of ["char-a", "char-b", "char-c"]) {
      const memories = await listGroupMemories(local.db, { groupId, characterId: id });
      expect(memories.some((m) => m.includes("祭り"))).toBe(true);
    }
    // char-z は場のメンバーではないので何も記録されん
    expect(await listGroupMemories(local.db, { groupId, characterId: "char-z" })).toHaveLength(0);
  });

  it("キャラの声が混ざった発言は件数として記録される", async () => {
    // 一人称「わし」のキャラが「わたし」と喋ったら混ざり判定になる
    const deps = {
      db: local.db,
      model: makeModel((s) =>
        s === "char-a"
          ? "「わたしは負けない」と言う"
          : s === "char-b"
            ? "「あたし、元気だよ」"
            : "「ボクも元気」",
      ),
      loadCharacter: async (id: string) => CHARACTERS[id] ?? null,
      now: () => 1,
    };
    const mismatched: number[] = [];
    for (let i = 0; i < 3; i++) {
      mismatched.push((await runGroupTurn(deps, { groupId }))?.voiceMismatch ?? -1);
    }
    const history = await listGroupHistory(local.db, groupId);
    expect(history.map((h) => h.voiceMismatch)).toEqual(mismatched);
    expect(history[0].voiceMismatch).toBe(1);
    expect(history[1].voiceMismatch).toBe(0);
  });
});
