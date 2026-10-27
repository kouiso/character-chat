import { MemoryAccessError } from "@v2/db";

import { createMemoryProjectionSource } from "../src/memory-projection";

import type { ManagedMemory, MemoryScope } from "@v2/db";

const scope: MemoryScope = {
  ownerUserId: "synthetic-owner",
  characterId: "synthetic-character",
  worldlineId: "synthetic-worldline",
  conversationId: "synthetic-conversation",
};
const memory = (
  id: string,
  content: string,
  extra: Partial<ManagedMemory> = {},
): ManagedMemory => ({
  id,
  content,
  conversationId: scope.conversationId,
  memoryKey: id,
  kind: "fact",
  supersededById: null,
  sourceTurn: null,
  createdAt: 0,
  updatedAt: 0,
  state: "active",
  pinned: false,
  enabled: true,
  eligible: true,
  sourceType: "user",
  sourceMessageId: null,
  sourceRevision: null,
  characterVersionId: null,
  ...extra,
});
const input = { characterId: scope.characterId, query: "合成の確認", maxChars: 100 };

describe("live memory projection", () => {
  it("uses only freshly revalidated content and returns the exact adopted version IDs", async () => {
    const store = {
      listCurrent: jest.fn().mockResolvedValue([memory("version", "古い候補本文")]),
      selectForGeneration: jest.fn().mockResolvedValue([memory("version", "現在の合成本文")]),
    };
    const result = await createMemoryProjectionSource(scope, store)(input);
    expect(result).toEqual({ context: ["【記憶】\n- 現在の合成本文"], usedMemoryIds: ["version"] });
    expect(store.selectForGeneration).toHaveBeenCalledWith(["version"]);
    expect(result.context.join("")).not.toContain("古い候補本文");
  });

  it("does not reuse stale candidates after deletion, correction or global OFF", async () => {
    const store = {
      listCurrent: jest.fn().mockResolvedValue([memory("old", "消える合成本文")]),
      selectForGeneration: jest.fn().mockResolvedValue([]),
    };
    expect(await createMemoryProjectionSource(scope, store)(input)).toEqual({
      context: [],
      usedMemoryIds: [],
    });
  });

  it("does not let pinning, retired IDs or unexpected returned IDs bypass eligibility", async () => {
    const values = [
      memory("deleted", "削除済み", { state: "deleted", pinned: true }),
      memory("disabled", "停止中", { enabled: false, pinned: true }),
      memory("old", "訂正前", { supersededById: "new" }),
      memory("invalidated", "失効", { eligible: false, pinned: true }),
      memory("safe", "利用する合成本文"),
    ];
    const store = {
      listCurrent: jest.fn().mockResolvedValue(values),
      selectForGeneration: jest
        .fn()
        .mockResolvedValue([...values, values.at(-1), memory("unexpected", "要求していない本文")]),
    };
    expect(await createMemoryProjectionSource(scope, store)(input)).toEqual({
      context: ["【記憶】\n- 利用する合成本文"],
      usedMemoryIds: ["safe"],
    });
  });

  it("includes framing and Unicode code points in the budget without truncating a fact", async () => {
    const values = [memory("large", "a".repeat(100_000)), memory("unicode", "🙂青")];
    const store = {
      listCurrent: jest.fn().mockResolvedValue(values),
      selectForGeneration: jest.fn().mockResolvedValue(values),
    };
    const project = createMemoryProjectionSource(scope, store);
    const result = await project({ ...input, maxChars: 9 });
    expect(result).toEqual({ context: ["【記憶】\n- 🙂青"], usedMemoryIds: ["unicode"] });
    expect([...result.context[0]]).toHaveLength(9);
    expect(await project({ ...input, maxChars: 8 })).toEqual({ context: [], usedMemoryIds: [] });
  });

  it("starts no lookup for zero budget or an incompatible character", async () => {
    const store = { listCurrent: jest.fn(), selectForGeneration: jest.fn() };
    const project = createMemoryProjectionSource(scope, store);
    expect(await project({ ...input, maxChars: 0 })).toEqual({ context: [], usedMemoryIds: [] });
    await expect(project({ ...input, characterId: "other" })).rejects.toBeInstanceOf(
      MemoryAccessError,
    );
    expect(store.listCurrent).not.toHaveBeenCalled();
    expect(store.selectForGeneration).not.toHaveBeenCalled();
  });

  it.each([-1, NaN, Infinity, 0.5])("rejects invalid budget %s before lookup", async (maxChars) => {
    const store = { listCurrent: jest.fn(), selectForGeneration: jest.fn() };
    await expect(
      createMemoryProjectionSource(scope, store)({ ...input, maxChars }),
    ).rejects.toThrow(RangeError);
    expect(store.listCurrent).not.toHaveBeenCalled();
  });

  it("does not redirect a constructed projection when its caller changes the scope object", async () => {
    const mutable = { ...scope };
    const store = { listCurrent: jest.fn().mockResolvedValue([]), selectForGeneration: jest.fn() };
    const project = createMemoryProjectionSource(mutable, store);
    mutable.characterId = "changed-after-construction";
    expect(await project(input)).toEqual({ context: [], usedMemoryIds: [] });
  });
});
