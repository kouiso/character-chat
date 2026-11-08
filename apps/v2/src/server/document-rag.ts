// RIT-115: 設定資料の検索。会話の記憶と同じ検索箱を kind=doc_chunk で分けて使う。
// 資料はキャラごと（会話を跨ぐ）なので memory の conversation_id 絞りは掛けん。
import { loadActiveDocumentChunks, type V2Db } from "@v2/db";

import {
  embedMemoryText,
  memoryNamespace,
  memoryVectorReady,
  type MemoryVectorBindings,
} from "./memory-vector";

const DOC_TOP_K = 8;
const DOC_MAX_CHUNKS = 4;

export type DocumentContextEntry = {
  documentId: string;
  title: string;
  content: string;
};

export const retrieveDocumentChunks = async (
  db: V2Db,
  env: MemoryVectorBindings,
  scope: { userId: string; characterId: string },
  query: string,
): Promise<DocumentContextEntry[]> => {
  if (!memoryVectorReady(env) || !query.trim()) return [];
  try {
    const values = await embedMemoryText(env.AI, query);
    const result = await env.MEMORY_INDEX.query(values, {
      namespace: await memoryNamespace(scope),
      topK: DOC_TOP_K,
      returnMetadata: "all",
      returnValues: false,
      filter: { kind: "doc_chunk", character_id: scope.characterId },
    });
    const chunkIds = result.matches.flatMap((match) => {
      const chunkId = match.metadata?.chunk_id;
      return typeof chunkId === "string" && Number.isFinite(match.score) && match.score > 0
        ? [chunkId]
        : [];
    });
    const rows = await loadActiveDocumentChunks(db, scope.characterId, scope.userId, chunkIds);
    const order = new Map(chunkIds.map((id, index) => [id, index]));
    const seen = new Map<string, number>();
    return rows
      .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
      .flatMap((row) => {
        // 同じ資料から断片が続くと要点が偏るので、資料ごとに 2 断片まで。
        const count = seen.get(row.documentId) ?? 0;
        if (count >= 2) return [];
        seen.set(row.documentId, count + 1);
        return [{ documentId: row.documentId, title: row.documentTitle, content: row.content }];
      })
      .slice(0, DOC_MAX_CHUNKS);
  } catch (error) {
    globalThis.console.error(
      JSON.stringify({ event: "document_retrieval_failed", error: String(error) }),
    );
    return [];
  }
};
