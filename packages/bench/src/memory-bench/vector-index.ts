// メモリ内の VectorizeIndex。本番と同じ MemoryVectorIndex 契約に乗せ、
// namespace 分離・metadata フィルタ（$in 含む）・cosine 類似度を実装する。
// 外部サービスを呼ばんので fake モードの決定論が保てる。
import type { MemoryVectorIndex } from "@v2/engine";

type StoredVector = {
  values: number[];
  namespace: string;
  metadata: Record<string, VectorizeVectorMetadata>;
};

const cosine = (a: number[], b: number[]): number => {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
};

const scalar = (value: VectorizeVectorMetadataValue | undefined): unknown =>
  Array.isArray(value) ? value[0] : value;

const compareScalar = (a: unknown, b: unknown): number =>
  typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b));

const ORDER_OPS: Record<string, (r: number) => boolean> = {
  $eq: (r) => r === 0,
  $ne: (r) => r !== 0,
  $lt: (r) => r < 0,
  $lte: (r) => r <= 0,
  $gt: (r) => r > 0,
  $gte: (r) => r >= 0,
};

const matchField = (actual: unknown, expected: unknown): boolean => {
  if (expected === null || typeof expected !== "object") {
    return actual === expected;
  }
  return Object.entries(expected as Record<string, unknown>).every(([op, operand]) => {
    if (op === "$in" || op === "$nin") {
      const list = operand as unknown[];
      const hit = Array.isArray(actual)
        ? actual.some((v) => list.includes(v))
        : list.includes(actual);
      return op === "$in" ? hit : !hit;
    }
    // 未知の演算子は一致しなし — 本番と同じく通さん方が安全。
    return ORDER_OPS[op]?.(compareScalar(actual, operand)) ?? false;
  });
};

const matchFilter = (
  metadata: Record<string, VectorizeVectorMetadata>,
  filter: VectorizeVectorMetadataFilter | undefined,
): boolean => {
  if (!filter) return true;
  return Object.entries(filter).every(([field, expected]) =>
    matchField(scalar(metadata[field] as VectorizeVectorMetadataValue | undefined), expected),
  );
};

export type LocalVectorIndex = MemoryVectorIndex & {
  // 件数確かめ（試験: 5 件以上入ったか・破壊試験で消えたか）。
  count: (namespace?: string) => number;
};

export const createLocalVectorIndex = (): LocalVectorIndex => {
  const store = new Map<string, Map<string, StoredVector>>();
  const bucketFor = (ns: string): Map<string, StoredVector> => {
    let bucket = store.get(ns);
    if (!bucket) {
      bucket = new Map();
      store.set(ns, bucket);
    }
    return bucket;
  };
  return {
    count: (namespace) =>
      namespace === undefined
        ? [...store.values()].reduce((sum, bucket) => sum + bucket.size, 0)
        : (store.get(namespace)?.size ?? 0),
    upsert: async (vectors) => {
      for (const vector of vectors) {
        bucketFor(vector.namespace ?? "").set(vector.id, {
          values: Array.from(vector.values),
          namespace: vector.namespace ?? "",
          metadata: vector.metadata ?? {},
        });
      }
      return { ids: vectors.map((vector) => vector.id), count: vectors.length };
    },
    deleteByIds: async (ids) => {
      let removed = 0;
      for (const bucket of store.values()) {
        for (const id of ids) {
          if (bucket.delete(id)) removed += 1;
        }
      }
      return { ids, count: removed };
    },
    query: async (vector, options) => {
      const bucket = store.get(options?.namespace ?? "");
      if (!bucket) return { matches: [], count: 0 };
      const topK = options?.topK ?? 5;
      const query = Array.from(vector);
      const scored = [...bucket.entries()]
        .filter(([, entry]) => matchFilter(entry.metadata, options?.filter))
        .map(([id, entry]) => ({ id, entry, score: cosine(query, entry.values) }))
        .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
        .slice(0, topK);
      return {
        count: scored.length,
        matches: scored.map(({ id, entry, score }) => ({
          id,
          score,
          namespace: entry.namespace,
          ...(options?.returnValues ? { values: entry.values } : {}),
          ...(options?.returnMetadata ? { metadata: entry.metadata } : {}),
        })),
      };
    },
  };
};
