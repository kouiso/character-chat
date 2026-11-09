import {
  failMemoryIndex,
  hashMemorySource,
  loadMemoryCandidates,
  loadPinnedMemories,
  loadUnindexedMemoryJob,
  saveMemoryEmbedding,
  type ExtractionScope,
  type V2Db,
} from "@v2/db";

import {
  embedMemoryText,
  memoryNamespace,
  memoryVectorId,
  memoryVectorReady,
  type MemoryVectorBindings,
} from "./memory-vector";

import type { MemoryContextEntry } from "@v2/engine";

export const indexMemoryJob = async (
  db: V2Db,
  env: MemoryVectorBindings,
  jobId: string,
): Promise<void> => {
  if (!memoryVectorReady(env)) return;
  const memories = await loadUnindexedMemoryJob(db, jobId);
  for (const memory of memories) {
    if ((await hashMemorySource(memory.sourceContent)) !== memory.sourceContentHash) {
      await failMemoryIndex(db, jobId);
      return;
    }
    const hash = await hashMemorySource(memory.content);
    const values = await embedMemoryText(env.AI, memory.content);
    await env.MEMORY_INDEX.upsert([
      {
        id: await memoryVectorId(memory.id, hash),
        namespace: await memoryNamespace(memory),
        values,
        metadata: {
          memory_id: memory.id,
          content_hash: hash,
          kind: memory.kind,
          conversation_id: memory.conversationId,
        },
      },
    ]);
    await saveMemoryEmbedding(db, memory, values);
  }
};

type MemoryCandidateMatch = {
  id: string;
  hash: string;
  vectorId: string;
  similarity: number;
};

const rankMemoryCandidates = async (
  rows: Awaited<ReturnType<typeof loadMemoryCandidates>>,
  matches: MemoryCandidateMatch[],
  now: number,
): Promise<MemoryContextEntry[]> => {
  const today = new Date(now).toISOString().slice(0, 10);
  const ranked: (MemoryContextEntry & { score: number })[] = [];
  for (const row of rows) {
    if ((row.validFrom && row.validFrom > today) || (row.validUntil && row.validUntil < today))
      continue;
    if ((await hashMemorySource(row.sourceContent)) !== row.sourceContentHash) continue;
    const hash = await hashMemorySource(row.content);
    const vectorId = await memoryVectorId(row.id, hash);
    const match = matches.find(
      (candidate) =>
        candidate.id === row.id && candidate.hash === hash && candidate.vectorId === vectorId,
    );
    if (!match) continue;
    const ageDays = Math.max(0, now - row.createdAt) / 86_400_000;
    const score = match.similarity * row.importance * 2 ** (-ageDays / 30);
    ranked.push({ id: row.id, content: row.content, score });
  }
  return ranked
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .map(({ id, content }) => ({
      id,
      content,
    }));
};

export const retrieveMemories = async (
  db: V2Db,
  env: MemoryVectorBindings,
  scope: ExtractionScope & { beforeTurn?: number; topK?: number },
  query: string,
  now = Date.now(),
): Promise<MemoryContextEntry[]> => {
  // 記憶の深さはプランの機能差（RIT-193）。未指定は従来どおり20。
  const topK = scope.topK ?? 20;
  // 固定済みは類似度を必要とせんので vector 非依存で必ず先に返す（手で足した記憶の既定経路）。
  const pinned = await loadPinnedMemories(db, scope).catch(() => {
    globalThis.console.error(JSON.stringify({ event: "memory_pinned_load_failed" }));
    return [];
  });
  const pinnedEntries = pinned.map(({ id, content }) => ({ id, content }));
  if (!memoryVectorReady(env) || !query.trim()) return pinnedEntries;
  try {
    const values = await embedMemoryText(env.AI, query);
    const result = await env.MEMORY_INDEX.query(values, {
      namespace: await memoryNamespace(scope),
      topK,
      returnMetadata: "all",
      returnValues: false,
      filter: { conversation_id: scope.conversationId, kind: { $in: ["fact", "preference"] } },
    });
    const matches = result.matches.slice(0, topK).flatMap((match) => {
      const id = match.metadata?.memory_id;
      const hash = match.metadata?.content_hash;
      return typeof id === "string" &&
        typeof hash === "string" &&
        Number.isFinite(match.score) &&
        match.score > 0
        ? [{ id, hash, vectorId: match.id, similarity: Math.min(1, match.score) }]
        : [];
    });
    const rows = await loadMemoryCandidates(
      db,
      scope,
      matches.map((match) => match.id),
    );
    const ranked = await rankMemoryCandidates(rows, matches, now);
    const pinnedIds = new Set(pinnedEntries.map((entry) => entry.id));
    return [...pinnedEntries, ...ranked.filter((entry) => !pinnedIds.has(entry.id))];
  } catch {
    globalThis.console.error(JSON.stringify({ event: "memory_retrieval_failed" }));
    return pinnedEntries;
  }
};
