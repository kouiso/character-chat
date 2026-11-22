// 記憶の索引と検索の本番部品。apps/v2 から RIT-99 のベンチでも直に使うため engine へ
// 移した（apps/v2/src/server/memory-rag.ts は薄い再 export のみ）。
// 失敗の知らせ方は呼び出し側で差し替えられるよう onFailure で受ける（既定は logEvent、
// apps/v2 は Slack 連携つきの reportFailure を渡す）。
import {
  describeError,
  failMemoryIndex,
  hashMemorySource,
  loadMemoryCandidates,
  loadMemoryExtractionPolicy,
  loadPinnedMemories,
  loadUnindexedMemoryJob,
  logEvent,
  saveMemoryEmbedding,
  type ExtractionScope,
  type LogEntry,
  type V2Db,
} from "@v2/db";

import { jstDateKey } from "./jst-date";
import type { MemoryContextEntry, MemoryRetrievalResult } from "./memory-context";
import {
  embedMemoryText,
  memoryNamespace,
  memoryVectorId,
  memoryVectorReady,
  type MemoryVectorBindings,
} from "./memory-vector";

export type MemoryFailureReporter = (env: unknown, entry: LogEntry) => void;

const logOnlyReporter: MemoryFailureReporter = (_env, entry) => logEvent(entry);

export const indexMemoryJob = async (
  db: V2Db,
  env: MemoryVectorBindings,
  jobId: string,
): Promise<void> => {
  if (!memoryVectorReady(env)) return;
  const memories = await loadUnindexedMemoryJob(db, jobId);
  for (const memory of memories) {
    if ((await hashMemorySource(memory.sourceContent)) !== memory.sourceContentHash) {
      // 元発言が抜き出し後に変わった食い違いはやり直しても一致せんので、
      // 回数を数えず即 index_failed（terminal）にして送りを止める。
      await failMemoryIndex(db, jobId, true);
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

// 埋め込み・検索を試す前に投げる故障注入（RIT-48 の共通の作り）。
// staging・test だけに効き、本番（APP_ENV=production）では無視する。
const throwMemorySearchFault = (env: MemoryVectorBindings): void => {
  if (
    env.V2_TEST_FAULT === "memory-search-fail" &&
    (env.APP_ENV === "staging" || env.APP_ENV === "test")
  ) {
    throw new Error("V2_TEST_FAULT=memory-search-fail");
  }
};

type MemoryCandidateMatch = {
  id: string;
  hash: string;
  vectorId: string;
  similarity: number;
};

export const rankMemoryCandidates = async (
  rows: Awaited<ReturnType<typeof loadMemoryCandidates>>,
  matches: MemoryCandidateMatch[],
  now: number,
): Promise<(MemoryContextEntry & { via: "search" })[]> => {
  const today = jstDateKey(now);
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
      via: "search" as const,
    }));
};

export type MemorySearchScope = ExtractionScope & {
  beforeTurn?: number;
  topK?: number;
  kinds?: ("fact" | "preference")[];
};

type VectorOutcome =
  | { status: "ok"; entries: (MemoryContextEntry & { via: "search" })[] }
  | { status: "failed" };

// 検索箱を通る道だけの検索（埋める → query → 候補読み直し → 順位付け）。
// 失敗は例外を飲んで status で返す（記憶が取れなくても返事は作る）。
const searchVectorMemories = async (
  db: V2Db,
  env: MemoryVectorBindings,
  scope: MemorySearchScope,
  query: string,
  now: number,
  onFailure: MemoryFailureReporter,
): Promise<VectorOutcome> => {
  // 束ね無しの呼び出しは検索を試さん（retrieveMemories 側で固定だけに倒す）。
  if (!memoryVectorReady(env)) return { status: "ok", entries: [] };
  // 記憶の深さはプランの機能差（RIT-193）。検索箱へ頼む件数の上限は 50（RIT-84 NFR-2）。
  const topK = Math.min(scope.topK ?? 20, 50);
  if (!query.trim()) return { status: "ok", entries: [] };
  try {
    throwMemorySearchFault(env);
    const values = await embedMemoryText(env.AI, query);
    const result = await env.MEMORY_INDEX.query(values, {
      namespace: await memoryNamespace(scope),
      topK,
      returnMetadata: "all",
      returnValues: false,
      // その会話が覚える種類だけを拾う（memoryKinds が片方の時はその種類だけ、RIT-84 FR-10）。
      // verify 経路のように種類未指定なら従来どおり両方。
      filter: {
        conversation_id: scope.conversationId,
        kind: { $in: scope.kinds ?? ["fact", "preference"] },
      },
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
    return { status: "ok", entries: await rankMemoryCandidates(rows, matches, now) };
  } catch (error) {
    onFailure(env, {
      event: "memory_retrieval_failed",
      level: "error",
      reason: describeError(error),
    });
    return { status: "failed" };
  }
};

// 検索箱を通る道だけの検索（埋める → query → 候補読み直し → 順位付け）。固定の道は通らない。
// RIT-78 の verify-memory が「会話の検索で実際に引けるか」を確かめるのに使う。
export const retrieveVectorMemories = async (
  db: V2Db,
  env: MemoryVectorBindings,
  scope: MemorySearchScope,
  query: string,
  now = Date.now(),
  onFailure: MemoryFailureReporter = logOnlyReporter,
): Promise<MemoryContextEntry[]> => {
  if (!memoryVectorReady(env)) return [];
  const outcome = await searchVectorMemories(db, env, scope, query, now, onFailure);
  return outcome.status === "ok" ? outcome.entries : [];
};

// そのターンの記憶の取り出し（RIT-84）。固定の道と束ねの検索の道を束ね、
// 終わり方（ok / pinned_only / disabled / off）を印として返す。
export const retrieveMemories = async (
  db: V2Db,
  env: MemoryVectorBindings,
  scope: MemorySearchScope,
  query: string,
  now = Date.now(),
  onFailure: MemoryFailureReporter = logOnlyReporter,
): Promise<MemoryRetrievalResult> => {
  // その会話が固定したキャラ版の「覚える種類」。方針を読めん会話は全種類を通す
  // （RIT-73 のキューと同じ既定）。読み自体が失敗したら既定へ倒して検索は続ける。
  const policy = await loadMemoryExtractionPolicy(db, scope.conversationId).catch(
    (error: unknown) => {
      onFailure(env, {
        event: "memory_retrieval_failed",
        level: "error",
        reason: describeError(error),
      });
      return null;
    },
  );
  const kinds = policy?.memoryKinds ?? ["fact", "preference"];
  // 覚える種類を両方切った会話は記憶を出さん（固定の読み出し・埋め込み・検索も止める、FR-10）。
  if (kinds.length === 0) return { entries: [], status: "off" };

  // 固定済みは類似度を必要とせんので vector 非依存で必ず先に返す（手で足した記憶の既定経路）。
  const pinned = await loadPinnedMemories(db, scope)
    .then((rows) =>
      rows.map(({ id, content }): MemoryContextEntry & { via: "pinned" } => ({
        id,
        content,
        via: "pinned",
      })),
    )
    .catch((error: unknown) => {
      onFailure(env, {
        event: "memory_pinned_load_failed",
        level: "error",
        reason: describeError(error),
      });
      return null;
    });
  // 固定の読み自体が落ちた時は記憶なしで返事を作る（検索も試さん。印 pinned_only）。
  if (pinned === null) return { entries: [], status: "pinned_only" };

  // 束ねが無い環境では検索を走らせんが、固定した記憶は毎回入れる（FR-9、UR-6）。
  if (!memoryVectorReady(env)) return { entries: pinned, status: "disabled" };

  const outcome = await searchVectorMemories(db, env, { ...scope, kinds }, query, now, onFailure);
  const pinnedIds = new Set(pinned.map((entry) => entry.id));
  const searched =
    outcome.status === "ok" ? outcome.entries.filter((entry) => !pinnedIds.has(entry.id)) : [];
  return {
    entries: [...pinned, ...searched],
    status: outcome.status === "ok" ? "ok" : "pinned_only",
  };
};
