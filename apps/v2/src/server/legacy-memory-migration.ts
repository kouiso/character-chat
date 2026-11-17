// RIT-78: memory_note → v2_memory / rag_chunk → Vectorize 移行の実行側。
// D1 の行移しと計画は @v2/db、埋め込み（Workers AI bge-m3）と Vectorize への索引は
// 束縛が要るので worker 側で回す。検索箱が使えない時は例外にして受け口が 503 を返す
// （0 件の成功として返さない。UR-2/FR-6）。
import {
  hashMemorySource,
  LegacyCorpusPlanChangedError,
  legacyRagVectorId,
  loadRagChunks,
  saveMigratedEmbedding,
  type MemoryIndexTarget,
} from "@v2/db";

import {
  embedMemoryText,
  memoryNamespace,
  memoryVectorId,
  memoryVectorReady,
} from "./memory-vector";

import type { MemoryVectorBindings } from "./memory-vector";
import type { V2Db } from "@v2/db";

// rag_chunk（共有コーパス）は会話メモとは別の名前空間へ。v2 の会話検索は
// 記憶の区画だけを見るので、コーパスの物は 1 件も返らない（FR-12）。種類は metadata で残す。
export const LEGACY_CORPUS_NAMESPACE = "legacy-corpus";

// 検索箱・Workers AI が使えない（V2_RAG_ENABLED=0 または束縛無し）。受け口は 503。
export class MemoryVectorUnavailableError extends Error {
  constructor() {
    super("vector unavailable");
    this.name = "MemoryVectorUnavailableError";
  }
}

export type MemoryIndexFailure = { noteId: string; code: "index_failed" };

// 埋める対象を 1 件ずつ: 埋める → 検索箱に入れる → embedding を書き戻す。
// 途中の失敗はその 1 件だけ index_failed にして次へ進む（行は残り、次の実行で埋まる）。
export const indexMemoryTargets = async (
  db: V2Db,
  env: MemoryVectorBindings,
  targetUserId: string,
  targets: MemoryIndexTarget[],
): Promise<{ indexed: number; failures: MemoryIndexFailure[] }> => {
  if (targets.length === 0) return { indexed: 0, failures: [] };
  if (!memoryVectorReady(env)) throw new MemoryVectorUnavailableError();
  let indexed = 0;
  const failures: MemoryIndexFailure[] = [];
  for (const target of targets) {
    try {
      const hash = await hashMemorySource(target.content);
      const values = await embedMemoryText(env.AI, target.content);
      await env.MEMORY_INDEX.upsert([
        {
          id: await memoryVectorId(target.memoryId, hash),
          namespace: await memoryNamespace({
            userId: targetUserId,
            characterId: target.characterId,
          }),
          values,
          metadata: {
            memory_id: target.memoryId,
            content_hash: hash,
            kind: target.kind,
            conversation_id: target.conversationId,
          },
        },
      ]);
      await saveMigratedEmbedding(db, target.memoryId, values);
      indexed += 1;
    } catch {
      failures.push({ noteId: target.noteId, code: "index_failed" });
    }
  }
  return { indexed, failures };
};

export type CorpusPageResult = {
  chunks: number;
  indexed: number;
  failures: { chunkId: string; code: "index_failed" }[];
  nextCursor: string | null;
};

const corpusVector = async (
  env: Pick<Ai, "run">,
  chunk: { id: string; type: string; phase: string; characterId: string | null; text: string },
) => ({
  id: legacyRagVectorId(chunk.id),
  namespace: LEGACY_CORPUS_NAMESPACE,
  values: await embedMemoryText(env, chunk.text),
  metadata: {
    source: "rag_chunk",
    type: chunk.type,
    phase: chunk.phase,
    ...(chunk.characterId ? { character_id: chunk.characterId } : {}),
  },
});

// `corpus`: 検索の塊を 1 件ずつ埋め直し、id legacy-rag-<旧の id>・区画 legacy-corpus で
// 検索箱に入れる。apply を付けない時は確認だけ（件数だけ返す）。
export const runLegacyCorpusPage = async (
  db: V2Db,
  env: MemoryVectorBindings,
  opts: { apply?: boolean; cursor?: string; limit: number; expected?: { chunks: number } },
): Promise<CorpusPageResult> => {
  const fetched = await loadRagChunks(db, { cursor: opts.cursor, limit: opts.limit + 1 });
  const hasMore = fetched.length > opts.limit;
  const chunks = fetched.slice(0, opts.limit);
  const nextCursor = hasMore ? chunks[chunks.length - 1].id : null;
  if (opts.apply !== true) {
    return { chunks: chunks.length, indexed: 0, failures: [], nextCursor };
  }
  // 検査が通った後でないと env.AI・env.MEMORY_INDEX が絞れないので 503 を先に投げる。
  if (!memoryVectorReady(env)) {
    throw new MemoryVectorUnavailableError();
  }
  if (opts.expected !== undefined && chunks.length !== opts.expected.chunks) {
    throw new LegacyCorpusPlanChangedError({ chunks: chunks.length });
  }
  let indexed = 0;
  const failures: { chunkId: string; code: "index_failed" }[] = [];
  for (const chunk of chunks) {
    try {
      await env.MEMORY_INDEX.upsert([await corpusVector(env.AI, chunk)]);
      indexed += 1;
    } catch {
      failures.push({ chunkId: chunk.id, code: "index_failed" });
    }
  }
  return { chunks: chunks.length, indexed, failures, nextCursor };
};

export type VerifyCorpusResult = {
  chunks: number;
  present: number;
  missingIds: string[];
  nextCursor: string | null;
};

// `verify-corpus`: そのページの id を検索箱へ問い合わせ、無い id を missingIds に返す。何も書かない。
export const verifyLegacyCorpusPage = async (
  db: V2Db,
  env: MemoryVectorBindings,
  opts: { cursor?: string; limit: number },
): Promise<VerifyCorpusResult> => {
  if (!memoryVectorReady(env) || typeof env.MEMORY_INDEX.getByIds !== "function") {
    throw new MemoryVectorUnavailableError();
  }
  const fetched = await loadRagChunks(db, { cursor: opts.cursor, limit: opts.limit + 1 });
  const hasMore = fetched.length > opts.limit;
  const chunks = fetched.slice(0, opts.limit);
  const nextCursor = hasMore ? chunks[chunks.length - 1].id : null;
  const ids = chunks.map((chunk) => legacyRagVectorId(chunk.id));
  const found = new Set(((await env.MEMORY_INDEX.getByIds(ids)) ?? []).map((vector) => vector.id));
  const missingIds = ids.filter((id) => !found.has(id));
  return {
    chunks: chunks.length,
    present: chunks.length - missingIds.length,
    missingIds,
    nextCursor,
  };
};
