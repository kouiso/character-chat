// RIT-78: memory_note → v2_memory 移行の実行側。D1 の行移しは @v2/db、
// 埋め込み（Workers AI bge-m3）と Vectorize への索引は束縛が要るので worker 側で回す。
import {
  hashMemorySource,
  loadConversationCharacterMap,
  loadMigratedMemories,
  loadRagChunks,
  migrateMemoryNotes,
  saveMigratedEmbedding,
  type LegacyMemoryMigrationReport,
} from "@v2/db";

import {
  embedMemoryText,
  memoryNamespace,
  memoryVectorId,
  memoryVectorReady,
} from "./memory-vector";

import type { MemoryVectorBindings } from "./memory-vector";
import type { V2Db } from "@v2/db";

export type LegacyMigrationRunOptions = {
  sourceUserId: string;
  targetUserId: string;
  characterId?: string;
  dryRun?: boolean;
  corpus?: boolean;
};

export type LegacyMigrationRunReport = {
  notes: LegacyMemoryMigrationReport;
  indexed: number;
  corpusChunks: number;
  corpusIndexed: number;
};

// rag_chunk（共有コーパス）は会話メモとは別の名前空間へ。v2 の会話検索が
// conversation_id で絞るので混ざらん。種類は metadata で残す。
export const LEGACY_CORPUS_NAMESPACE = "legacy-corpus";

const indexMigratedMemories = async (
  db: V2Db,
  env: MemoryVectorBindings,
  targetUserId: string,
  memoryIds: string[],
): Promise<number> => {
  if (memoryIds.length === 0 || !memoryVectorReady(env)) return 0;
  const memories = await loadMigratedMemories(db, memoryIds);
  const convIds = [...new Set(memories.map((m) => m.conversationId))];
  const charByConv = await loadConversationCharacterMap(db, convIds);
  let indexed = 0;
  for (const memory of memories) {
    const characterId = charByConv.get(memory.conversationId);
    if (!characterId) continue;
    const hash = await hashMemorySource(memory.content);
    const values = await embedMemoryText(env.AI, memory.content);
    await env.MEMORY_INDEX.upsert([
      {
        id: await memoryVectorId(memory.id, hash),
        namespace: await memoryNamespace({ userId: targetUserId, characterId }),
        values,
        metadata: {
          memory_id: memory.id,
          content_hash: hash,
          kind: memory.kind,
          conversation_id: memory.conversationId,
        },
      },
    ]);
    await saveMigratedEmbedding(db, memory.id, values);
    indexed += 1;
  }
  return indexed;
};

export const indexCorpusChunks = async (
  db: V2Db,
  env: MemoryVectorBindings,
  dryRun: boolean | undefined,
): Promise<{ total: number; indexed: number }> => {
  const chunks = await loadRagChunks(db);
  if (dryRun || !memoryVectorReady(env)) return { total: chunks.length, indexed: 0 };
  const vectors = [];
  for (const chunk of chunks) {
    vectors.push({
      id: `legacy-rag-${chunk.id}`,
      namespace: LEGACY_CORPUS_NAMESPACE,
      values: await embedMemoryText(env.AI, chunk.text),
      metadata: {
        source: "rag_chunk",
        type: chunk.type,
        phase: chunk.phase,
        ...(chunk.characterId ? { character_id: chunk.characterId } : {}),
      },
    });
  }
  if (vectors.length > 0) await env.MEMORY_INDEX.upsert(vectors);
  return { total: chunks.length, indexed: vectors.length };
};

export const runLegacyMemoryMigration = async (
  db: V2Db,
  env: MemoryVectorBindings,
  opts: LegacyMigrationRunOptions,
): Promise<LegacyMigrationRunReport> => {
  const notes = await migrateMemoryNotes(db, opts);
  const indexed = opts.dryRun
    ? 0
    : await indexMigratedMemories(db, env, opts.targetUserId, notes.migratedMemoryIds);
  const corpus = opts.corpus
    ? await indexCorpusChunks(db, env, opts.dryRun)
    : { total: 0, indexed: 0 };
  return { notes, indexed, corpusChunks: corpus.total, corpusIndexed: corpus.indexed };
};
