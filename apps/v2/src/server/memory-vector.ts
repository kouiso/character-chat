// 実体は packages/engine/src/memory-vector.ts（RIT-99: ベンチでも本番部品を使うため移動）。
// ここは既存の import 先を保つ薄い入口だけにする。
export {
  embedMemoryText,
  MEMORY_EMBEDDING_MODEL,
  MEMORY_VECTOR_DIMENSIONS,
  memoryNamespace,
  memoryVectorId,
  memoryVectorReady,
  validateMemoryVector,
  type MemoryVectorBindings,
  type MemoryVectorIndex,
} from "@v2/engine";
