export type {
  CharacterSheet,
  ComposedPrompt,
  GenerationRecord,
  HistoryMessage,
  TurnEvent,
  TurnStore,
} from "./types";
export {
  createTurnGraph,
  DEFAULT_TURN_TIMEOUT_MS,
  EXTEND_BELOW_RATIO,
  maxTokensForTarget,
  runTurn,
  streamedCharCap,
  type TurnGraph,
  type TurnGraphDeps,
  type TurnInput,
  type TurnModel,
  type TurnModelCallOptions,
} from "./graph";
export { createOpenRouterModel, OpenRouterKeyMissingError, type ModelEnv } from "./model";
export {
  createOpenRouterFallbackModel,
  FallbackChatModel,
  FallbackModelError,
  type FallbackAttempt,
  type FallbackModelOptions,
} from "./fallback-model";
export { hardRefusalDetect } from "./refusal-detect";
export { createMemoryTurnStore, type MemoryTurnStore } from "./memory-store";
export { TurnState, type JudgedChunk, type TurnStateUpdate, type TurnStateValue } from "./state";
export {
  composeContextPrompt,
  DEFAULT_CONTEXT_BUDGET,
  resolveContextBudget,
  selectRecentMessages,
  type ContextBudget,
  type ContextUsage,
} from "./context-window";

export {
  DocumentMetadataSchema,
  DocumentSettingsSchema,
  retrieveDocumentContext,
  createDocumentProjection,
  type DocumentChunk,
  type DocumentMetadata,
  type DocumentSettings,
  type DocumentSource,
  type DocumentProjectionInput,
  type DocumentProjection,
} from "./document-retrieval";
export {
  createDocumentService,
  splitDocumentText,
  DocumentServiceError,
  MAX_DOCUMENT_BYTES,
  type DocumentBucket,
  type DocumentService,
  type UploadDocumentInput,
} from "./document-service";
export { DocumentPdfError, extractDocumentPdf } from "./document-pdf";

export {
  appendRetrievedContext,
  type TurnContextSources,
  type ContextProjectionInput,
} from "./retrieval-context";

export {
  createScopedMemoryProjection,
  createMemoryProjectionSource,
  type MemoryProjectionInput,
  type MemoryProjectionResult,
  type MemoryProjectionSource,
} from "./memory-projection";
