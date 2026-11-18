import { describe, expect, it } from "vitest";

import { createLocalVectorIndex } from "./vector-index";

const vec = (seed: number): number[] => {
  const values = Array.from({ length: 1024 }, () => 0);
  values[seed % 1024] = 1;
  return values;
};

describe("local vector index", () => {
  it("namespace を分け、conversation_id と kind.$in で絞れる", async () => {
    const index = createLocalVectorIndex();
    await index.upsert([
      {
        id: "a",
        namespace: "ns1",
        values: vec(0),
        metadata: { memory_id: "a", kind: "fact", conversation_id: "c1" },
      },
      {
        id: "b",
        namespace: "ns1",
        values: vec(0),
        metadata: { memory_id: "b", kind: "summary", conversation_id: "c1" },
      },
      {
        id: "c",
        namespace: "ns1",
        values: vec(0),
        metadata: { memory_id: "c", kind: "preference", conversation_id: "c2" },
      },
      {
        id: "d",
        namespace: "ns2",
        values: vec(0),
        metadata: { memory_id: "d", kind: "fact", conversation_id: "c1" },
      },
    ]);

    // 別 namespace は絶対に出ない
    const ns1 = await index.query(vec(0), { namespace: "ns1", topK: 10 });
    expect(ns1.matches.map((match) => match.id).sort()).toEqual(["a", "b", "c"]);

    // conversation_id 等値
    const c1 = await index.query(vec(0), {
      namespace: "ns1",
      topK: 10,
      filter: { conversation_id: "c1" },
    });
    expect(c1.matches.map((match) => match.id).sort()).toEqual(["a", "b"]);

    // kind の $in（本番の検索フィルタと同じ形）
    const filtered = await index.query(vec(0), {
      namespace: "ns1",
      topK: 10,
      returnMetadata: "all",
      filter: { conversation_id: "c1", kind: { $in: ["fact", "preference"] } },
    });
    expect(filtered.matches.map((match) => match.id)).toEqual(["a"]);
    expect(filtered.matches[0].metadata?.memory_id).toBe("a");
  });

  it("deleteByIds で消え、似たベクトル順に返す", async () => {
    const index = createLocalVectorIndex();
    const near = Array.from({ length: 1024 }, () => 0);
    near[0] = 0.9;
    near[1] = 0.1;
    await index.upsert([
      { id: "same", values: vec(0), metadata: {} },
      { id: "near", values: near, metadata: {} },
      { id: "far", values: vec(5), metadata: {} },
    ]);
    const ranked = await index.query(vec(0), { topK: 3 });
    expect(ranked.matches[0].id).toBe("same");
    expect(ranked.matches[1].id).toBe("near");
    expect(index.count()).toBe(3);
    await index.deleteByIds?.(["same", "far"]);
    expect(index.count()).toBe(1);
    const after = await index.query(vec(0), { topK: 3 });
    expect(after.matches.map((match) => match.id)).toEqual(["near"]);
  });
});
