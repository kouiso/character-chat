// v2 の記録の唯一の出口（RIT-66 FR-1）。会話本文を残さんため、出せる項目は
// NFR-1 の決めた物だけを型で受ける。自由な文字列（例外の message 等）は型で受けん。
export type LogEventName =
  | "worker_request_failed"
  | "chat_turn_failed"
  | "chat_stop_truncate_failed"
  | "legacy_migration_failed"
  | "context_budget_config_invalid"
  | "memory_queue_publish_failed"
  | "memory_queue_invalid_message"
  | "memory_extraction_failed"
  | "memory_manual_index_failed"
  | "memory_vector_drop_failed"
  | "memory_purge_failed"
  | "summary_redact_publish_failed"
  | "summary_redact_failed"
  | "summary_redact_dropped"
  | "memory_pinned_load_failed"
  | "memory_retrieval_failed"
  | "document_vector_delete_failed"
  | "document_r2_delete_failed"
  | "document_retrieval_failed"
  | "proactive_push_failed"
  | "image_generation_error"
  | "image_lora_trigger_missing"
  | "ledger_fallback"
  | "legacy_migration_failed"
  | "binding_unavailable"
  | "failure_drill"
  | "failure_notice_failed";

export type LogEntry = {
  event: LogEventName;
  level: "error" | "warn" | "info";
  // describeError の返す値だけを入れる（"unexpected:<例外のクラス名>" か決めた列挙値）。
  reason?: string;
  status?: number;
  method?: string;
  // 経路はテンプレート形（/api/chat/:id）。実際の id・クエリは入れん。
  route?: string;
  attempt?: number;
  terminal?: boolean;
  count?: number;
  durationMs?: number;
  jobId?: string;
  documentId?: string;
  generationId?: string;
  // キャラの id は出さん（名前が入った id が在るので NFR-1 の許可リストに無い）。
  conversationId?: string;
};

// 例外の message には会話本文や接続先の詳細・上流のエラー文が混ざりうるので、
// 記録にはクラス名だけを残す。message は絶対に読まん。
export const describeError = (error: unknown): string =>
  error instanceof Error ? `unexpected:${error.name}` : `unexpected:${typeof error}`;

// 出力は JSON 1 行。Workers Logs が `event` で全文検索できる形にする。
export const logEvent = (entry: LogEntry): void => {
  let line: string;
  try {
    line = JSON.stringify(entry);
  } catch {
    // LogEntry は平らな型なので循環は起きん設計だが、起きた時は出来事名だけは必ず残す。
    line = JSON.stringify({ event: entry.event });
  }
  if (entry.level === "error") console.error(line);
  else if (entry.level === "warn") console.warn(line);
  else console.info(line);
};
