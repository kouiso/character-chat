// v2 リビルド用テーブル宣言。既存テーブル（character 等）は src/schema/* 側の宣言を再 export して使う。
// 列名・制約は drizzle/0070_v2_tables.sql と一致させる。
import { sql } from "drizzle-orm";
import {
  blob,
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { characterTable } from "../../../src/schema/character";

export const v2ConversationTable = sqliteTable(
  "v2_conversation",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    legacySourceUserId: text("legacy_source_user_id"),
    characterId: text("character_id")
      .notNull()
      .references(() => characterTable.id),
    title: text("title").notNull().default(""),
    threadId: text("thread_id").notNull(),
    promptVersion: text("prompt_version").notNull(),
    // 会話開始時のキャラ版を固定する。旧会話は NULL のまま character 行を使う。
    characterVersionId: text("character_version_id"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [index("v2_conversation_user_updated_idx").on(table.userId, table.updatedAt)],
);

// キャラの版。content_json が正で、character 表の同名列は互換ミラー。
// 版は不変（INSERT専用）で、現在版は character.current_version_id の参照切替。
export const characterVersionTable = sqliteTable(
  "character_version",
  {
    id: text("id").primaryKey(),
    characterId: text("character_id")
      .notNull()
      .references(() => characterTable.id),
    ownerUserId: text("owner_user_id").notNull(),
    version: integer("version").notNull(),
    schemaVersion: integer("schema_version").notNull().default(1),
    contentJson: text("content_json").notNull(),
    // 同内容の再送で版を増やさんよう canonical contentJson の SHA-256 で一意にする。
    contentHash: text("content_hash").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("character_version_character_hash_unique").on(table.characterId, table.contentHash),
    uniqueIndex("character_version_character_version_unique").on(table.characterId, table.version),
    index("character_version_character_idx").on(table.characterId),
  ],
);

export const characterRevisionTable = sqliteTable(
  "character_revision",
  {
    characterId: text("character_id")
      .notNull()
      .references(() => characterTable.id),
    revision: integer("revision").notNull(),
    versionId: text("version_id")
      .notNull()
      .references(() => characterVersionTable.id),
    action: text("action", {
      enum: ["create", "update", "restore", "legacy"],
    }).notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.characterId, table.revision] }),
    index("character_revision_character_idx").on(table.characterId),
  ],
);

export const v2MessageTable = sqliteTable(
  "v2_message",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => v2ConversationTable.id),
    turn: integer("turn").notNull(),
    role: text("role", { enum: ["user", "assistant"] }).notNull(),
    content: text("content").notNull(),
    action: text("action"),
    dialogue: text("dialogue"),
    inner: text("inner"),
    generationId: text("generation_id"),
    // 実行先（OpenRouter provider 名）と上流の生成 id。generation 表を持たん話しかけ・
    // 単発返事でも返事を作った実行先が残る（RIT-100）。
    provider: text("provider"),
    upstreamId: text("upstream_id"),
    // v2 で生成した画像メッセージの R2 キー。旧 message 表の image_key ではなく、
    // v2 メッセージへ直接持たせる（旧表は移行済み行だけが join で拾われる）。
    imageKey: text("image_key"),
    // RIT-202: 枝分かれ。同じ (conversation, turn, role) の代替系列は branch_no で
    // 区別し、表示対象は active=1 の1本だけ。戻る/進むは active の張り替えでやる
    // （消すと記憶の出処 cascade が消えるので行は残す）。
    branchNo: integer("branch_no").notNull().default(0),
    active: integer("active").notNull().default(1),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    // 表示対象は (会話,ターン,役割) につき1本。代替系列は active=0 で眠らせる。
    uniqueIndex("v2_message_active_idx")
      .on(table.conversationId, table.turn, table.role)
      .where(sql`${table.active} = 1`),
    uniqueIndex("v2_message_branch_idx").on(
      table.conversationId,
      table.turn,
      table.role,
      table.branchNo,
    ),
    check("v2_message_role_check", sql`${table.role} in ('user','assistant')`),
  ],
);

export const v2ChunkTable = sqliteTable(
  "v2_chunk",
  {
    id: text("id").primaryKey(),
    messageId: text("message_id")
      .notNull()
      .references(() => v2MessageTable.id),
    seq: integer("seq").notNull(),
    text: text("text").notNull(),
    judgeJson: text("judge_json").notNull(),
    attempt: integer("attempt").notNull().default(1),
    // 塊を画面へ出す予定時刻。既存行は NULL（出し分け側は created_at へ倒す）。
    sendAt: integer("send_at"),
    // 1 = 判定で落ちて配らんかった塊。理由は judge_json に残す（RIT-70）。
    dropped: integer("dropped").notNull().default(0),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [uniqueIndex("v2_chunk_message_seq_idx").on(table.messageId, table.seq)],
);

// 窓から押し出された履歴の巻き取り要約（RIT-72）。level 1 = 押し出し分の要約、
// level 2 = レベル 1 がたまった分のまとめ直し。covered_to は履歴先頭から何件を
// この要約（列）が吸収したか。行は追記のみで、画面には最新の level 2 と
// それ以降の level 1 を時系列で見せる。
export const v2SummaryTable = sqliteTable(
  "v2_summary",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => v2ConversationTable.id),
    level: integer("level").notNull(),
    coveredTo: integer("covered_to").notNull(),
    text: text("text").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("v2_summary_conversation_idx").on(table.conversationId, table.level, table.coveredTo),
  ],
);

export const v2LedgerTable = sqliteTable(
  "v2_ledger",
  {
    conversationId: text("conversation_id")
      .notNull()
      .references(() => v2ConversationTable.id),
    turn: integer("turn").notNull(),
    ledgerJson: text("ledger_json").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.conversationId, table.turn] })],
);

export const v2GenerationTable = sqliteTable(
  "v2_generation",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => v2ConversationTable.id),
    turn: integer("turn").notNull(),
    model: text("model").notNull(),
    // 実行先（OpenRouter provider 名）と上流の生成 id。規約確認・課金照合に使う（RIT-100）。
    provider: text("provider"),
    upstreamId: text("upstream_id"),
    promptVersion: text("prompt_version").notNull(),
    systemPrompt: text("system_prompt").notNull(),
    requestJson: text("request_json").notNull(),
    rawOutput: text("raw_output"),
    usageJson: text("usage_json"),
    latencyMs: integer("latency_ms"),
    status: text("status", { enum: ["ok", "error", "aborted"] }).notNull(),
    error: text("error"),
    // RIT-102: 逃げ道チェーンの試行履歴（JSON 配列）と、掛けた締切 ms。
    attemptsJson: text("attempts_json"),
    timeoutMs: integer("timeout_ms"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("v2_generation_conv_turn_idx").on(table.conversationId, table.turn),
    check("v2_generation_status_check", sql`${table.status} in ('ok','error','aborted')`),
  ],
);

export const v2MemoryTable = sqliteTable(
  "v2_memory",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => v2ConversationTable.id),
    kind: text("kind", { enum: ["fact", "summary", "preference"] }).notNull(),
    content: text("content").notNull(),
    // 手で固定した記憶は類似度に負けても指示文へ入る（RIT-92）。手で足した記憶は 1 が既定。
    pinned: integer("pinned").notNull().default(0),
    sourceTurn: integer("source_turn"),
    // bge-m3 1024 次元 float32 の生バイト（script/rag/ingest.ts の rag_chunk と同形式）。M0 は NULL のまま。
    embedding: blob("embedding", { mode: "buffer" }),
    createdAt: integer("created_at").notNull(),
    // 抽出が付ける主題ラベル。同じ主題の新しい記憶に置き換わった印が supersededBy（RIT-86）。
    subject: text("subject").notNull().default(""),
    supersededBy: text("superseded_by"),
  },
  (table) => [
    index("v2_memory_conv_kind_idx").on(table.conversationId, table.kind),
    check("v2_memory_kind_check", sql`${table.kind} in ('fact','summary','preference')`),
  ],
);

export const v2MemoryJobTable = sqliteTable(
  "v2_memory_job",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => v2ConversationTable.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    characterId: text("character_id").notNull(),
    sourceMessageId: text("source_message_id")
      .notNull()
      .references(() => v2MessageTable.id, { onDelete: "cascade" }),
    sourceTurn: integer("source_turn").notNull(),
    state: text("state", { enum: ["pending", "queued", "completed", "failed"] })
      .notNull()
      .default("pending"),
    publishAttempts: integer("publish_attempts").notNull().default(0),
    errorCode: text("error_code"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [index("v2_memory_job_pending").on(table.conversationId, table.state)],
);

export const v2MemorySourceTable = sqliteTable("v2_memory_source", {
  memoryId: text("memory_id")
    .primaryKey()
    .references(() => v2MemoryTable.id, { onDelete: "cascade" }),
  sourceMessageId: text("source_message_id")
    .notNull()
    .references(() => v2MessageTable.id, { onDelete: "cascade" }),
  sourceContentHash: text("source_content_hash").notNull(),
  importance: integer("importance").notNull(),
  validFrom: text("valid_from"),
  validUntil: text("valid_until"),
});

// グループ会話（同じ場）。1場=1行。メンバーは v2_group_member。
export const v2GroupTable = sqliteTable("v2_group", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  title: text("title").notNull(),
  promptVersion: text("prompt_version").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const v2GroupMemberTable = sqliteTable(
  "v2_group_member",
  {
    id: text("id").primaryKey(),
    groupId: text("group_id")
      .notNull()
      .references(() => v2GroupTable.id, { onDelete: "cascade" }),
    characterId: text("character_id").notNull(),
    position: integer("position").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("v2_group_member_unique").on(table.groupId, table.characterId),
    index("v2_group_member_group_idx").on(table.groupId, table.position),
  ],
);

// 場の発言。speaker_character_id が NULL ならユーザー。turn は場内の連番。
export const v2GroupMessageTable = sqliteTable(
  "v2_group_message",
  {
    id: text("id").primaryKey(),
    groupId: text("group_id")
      .notNull()
      .references(() => v2GroupTable.id, { onDelete: "cascade" }),
    turn: integer("turn").notNull(),
    speakerCharacterId: text("speaker_character_id"),
    content: text("content").notNull(),
    // 声混ざり検査の記録（RIT-112）。NULL は未検査。
    voiceMismatch: integer("voice_mismatch"),
    generationId: text("generation_id"),
    // 実行先（OpenRouter provider 名）。照合は generation_id の上流 id で（RIT-100）。
    provider: text("provider"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("v2_group_message_turn_unique").on(table.groupId, table.turn),
    index("v2_group_message_speaker_idx").on(table.groupId, table.speakerCharacterId),
  ],
);

// 場での出来事は場にいたキャラだけの記憶へ（RIT-111: その場にいなかったキャラは知らん）。
export const v2GroupMemoryTable = sqliteTable(
  "v2_group_memory",
  {
    id: text("id").primaryKey(),
    groupId: text("group_id")
      .notNull()
      .references(() => v2GroupTable.id, { onDelete: "cascade" }),
    characterId: text("character_id").notNull(),
    content: text("content").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("v2_group_memory_character_idx").on(table.characterId, table.groupId)],
);

// Web Push の購読。端末ごとに1行。話しかけの着信に使う。
export const v2PushSubscriptionTable = sqliteTable(
  "v2_push_subscription",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("v2_push_subscription_endpoint_idx").on(table.endpoint),
    index("v2_push_subscription_user_idx").on(table.userId),
  ],
);

// 会話起点の画像生成記録（RIT-182）。成功・失敗ともに1回の起動で1行残し、
// 失敗理由は画面へ見せる根拠と後続の返却連動 SBI の参照元にする。
export const v2ImageGenerationTable = sqliteTable(
  "v2_image_generation",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => v2ConversationTable.id, { onDelete: "cascade" }),
    characterId: text("character_id")
      .notNull()
      .references(() => characterTable.id),
    // 成功時に書いた v2_message。失敗行は NULL。
    messageId: text("message_id"),
    // Novita の非同期タスク id。起動失敗（init が 4xx/5xx）は NULL。
    taskId: text("task_id"),
    model: text("model").notNull(),
    prompt: text("prompt").notNull(),
    negativePrompt: text("negative_prompt"),
    seed: integer("seed"),
    // 生成時に確定したパラメータ（RIT-183: 同じ条件で再生成できるよう全て残す）。
    // 既存行は NULL のまま。width/height/steps/guidance はレシピ既定値へ倒した最終値。
    width: integer("width"),
    height: integer("height"),
    steps: integer("steps"),
    guidanceScale: real("guidance_scale"),
    // img2img 専用（後続 SBI）。txt2img 経路では指定されても上流へ送らん。
    strength: real("strength"),
    // img2img の参照元となった生成行（RIT-184）。どの画像から派生したか辿るためのもの。
    sourceGenerationId: text("source_generation_id"),
    // 4コマ漫画など1回の起動で複数枚を出す依頼の束（RIT-189）。同じ起動の行は同じ値を持ち、
    // 単発生成は NULL。コマ内の並び順は panel_index（0始まり）。
    groupId: text("group_id"),
    panelIndex: integer("panel_index"),
    status: text("status", { enum: ["ok", "failed"] }).notNull(),
    failureReason: text("failure_reason"),
    imageKey: text("image_key"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("v2_image_generation_conv_idx").on(table.conversationId, table.createdAt),
    check("v2_image_generation_status_check", sql`${table.status} in ('ok','failed')`),
  ],
);

// 画像→動画変換の生成記録（RIT-190）。v2_image_generation と同じ「記録は監査・実体は v2_message
// の image_key→R2」構成。動画は非同期なので queued/processing を経て ok/failed へ落ちる。
export const v2VideoGenerationTable = sqliteTable(
  "v2_video_generation",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => v2ConversationTable.id, { onDelete: "cascade" }),
    characterId: text("character_id")
      .notNull()
      .references(() => characterTable.id),
    // 成功時に書いた v2_message（image_key に videos/*.mp4 を持つ）。未完了・失敗行は NULL。
    messageId: text("message_id"),
    // first-frame にした元画像の v2_message。どの画像から動かしたか辿るためのもの。
    sourceMessageId: text("source_message_id"),
    // Runware の非同期タスク id。起動失敗（init が 4xx/5xx）は NULL。
    taskId: text("task_id"),
    model: text("model").notNull(),
    prompt: text("prompt").notNull(),
    durationSeconds: integer("duration_seconds").notNull(),
    resolution: text("resolution").notNull(),
    // queued=依頼受付 / processing=上流で生成中。ポーリング経路で ok/failed へ終端化する。
    status: text("status", { enum: ["queued", "processing", "ok", "failed"] }).notNull(),
    failureReason: text("failure_reason"),
    videoKey: text("video_key"),
    // 上流が返した実績コスト（RIT-135 の課金台帳・RIT-188 の失敗返却と突き合わせる基）。
    costUsd: real("cost_usd"),
    createdAt: integer("created_at").notNull(),
    finishedAt: integer("finished_at"),
  },
  (table) => [
    index("v2_video_generation_conv_idx").on(table.conversationId, table.createdAt),
    check(
      "v2_video_generation_status_check",
      sql`${table.status} in ('queued','processing','ok','failed')`,
    ),
  ],
);

// クリップ（RIT-30 ギャップ: Saylo のショート動画フィード）。会話に紐付かん
// 単発の画像→動画生成と、その再生数。動画実体は R2 の videos/*.mp4。
export const v2ClipTable = sqliteTable(
  "v2_clip",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    characterId: text("character_id")
      .notNull()
      .references(() => characterTable.id),
    // first-frame にした v2_image_generation 行。元画像・プロンプトはそっちが正本。
    sourceGenerationId: text("source_generation_id"),
    taskId: text("task_id"),
    model: text("model").notNull(),
    prompt: text("prompt").notNull(),
    // v2_video_generation と同じ遷移。queued=依頼受付 / processing=上流生成中。
    status: text("status", { enum: ["queued", "processing", "ok", "failed"] }).notNull(),
    failureReason: text("failure_reason"),
    videoKey: text("video_key"),
    playCount: integer("play_count").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    finishedAt: integer("finished_at"),
  },
  (table) => [
    index("v2_clip_character_idx").on(table.characterId, table.createdAt),
    index("v2_clip_user_idx").on(table.userId, table.createdAt),
    check("v2_clip_status_check", sql`${table.status} in ('queued','processing','ok','failed')`),
  ],
);

// 手で消した記憶の内容ハッシュ。抽出の再実行で同じ内容が蘇らんようにする（RIT-94）。
// 会話ごとの帳簿なので、別会話で同じ内容を覚えるのは妨げない。
export const v2MemoryTombstoneTable = sqliteTable(
  "v2_memory_tombstone",
  {
    conversationId: text("conversation_id")
      .notNull()
      .references(() => v2ConversationTable.id),
    contentHash: text("content_hash").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.conversationId, table.contentHash] })],
);

// RIT-115: キャラの設定資料。原本は R2、切り分けた断片は D1 に残して検索箱（Vectorize）
// への載せ替え・無効化・削除を全部 D1 経由にする（R2 の一覧は走らん）。
export const v2CharacterDocumentTable = sqliteTable(
  "v2_character_document",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    characterId: text("character_id").notNull(),
    title: text("title").notNull(),
    r2Key: text("r2_key").notNull(),
    mime: text("mime").notNull(),
    byteSize: integer("byte_size").notNull(),
    status: text("status", { enum: ["active", "disabled"] })
      .notNull()
      .default("active"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("v2_character_document_char_idx").on(table.characterId, table.status)],
);

export const v2CharacterDocumentChunkTable = sqliteTable(
  "v2_character_document_chunk",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id")
      .notNull()
      .references(() => v2CharacterDocumentTable.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    content: text("content").notNull(),
    vectorId: text("vector_id").notNull(),
  },
  (table) => [index("v2_character_document_chunk_doc_idx").on(table.documentId, table.seq)],
);

// RIT-191: 通貨の取引台帳と残高。全ての増減は台帳へ1行で記録し、残高は台帳挿入と同一
// バッチで更新する。idempotency_key は再送・リトライの二重計上を防ぐ（一意）。
// kind: grant=付与 / purchase=購入 / spend=消費 / refund=返却 / bonus=特典 / tip=贈与受取。
// amount は常に正の最小単位、増減方向は kind で決まる（負数を持たない）。
export const v2CurrencyLedgerTable = sqliteTable(
  "v2_currency_ledger",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    kind: text("kind", {
      enum: ["grant", "purchase", "spend", "refund", "bonus", "tip"],
    }).notNull(),
    amount: integer("amount").notNull(),
    balanceAfter: integer("balance_after").notNull(),
    reason: text("reason").notNull(),
    refType: text("ref_type"),
    refId: text("ref_id"),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("v2_currency_ledger_user_idx").on(table.userId, table.createdAt),
    uniqueIndex("v2_currency_ledger_idempotency_unique").on(table.idempotencyKey),
    check(
      "v2_currency_ledger_kind_check",
      sql`${table.kind} in ('grant','purchase','spend','refund','bonus','tip')`,
    ),
  ],
);

export const v2CurrencyBalanceTable = sqliteTable(
  "v2_currency_balance",
  {
    userId: text("user_id").primaryKey(),
    balance: integer("balance").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  // 残高が負にならないことは DB が保証する（同時 spend 競合の最後の砦）。
  (table) => [check("v2_currency_balance_nonnegative", sql`${table.balance} >= 0`)],
);

// RIT-194: ログイン特典の受取記録。user_id×day の一意で1日1回の冪等を担保し、
// streak（連続日数）で付与量を増やす。day は UTC の YYYY-MM-DD。
export const v2LoginBonusTable = sqliteTable(
  "v2_login_bonus",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    day: text("day").notNull(),
    streak: integer("streak").notNull(),
    amount: integer("amount").notNull(),
    ledgerId: text("ledger_id").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [uniqueIndex("v2_login_bonus_user_day_unique").on(table.userId, table.day)],
);

// RIT-194: 1日券など時間限定の機能解放券。有効判定は expires_at > now。
// spend した台帳行を ledger_id で紐づける（購入→解放の追跡）。
export const v2FeaturePassTable = sqliteTable(
  "v2_feature_pass",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    kind: text("kind", { enum: ["daily"] }).notNull(),
    ledgerId: text("ledger_id").notNull(),
    startedAt: integer("started_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("v2_feature_pass_user_idx").on(table.userId, table.expiresAt)],
);

// RIT-193: 月額プランの保有状態。plan は free/standard/premium、有効期間は
// expires_at > now。cancelled_at は自動更新しない意思表示（期限で落ちる）。
// 通貨で購入した場合は spend 行を ledger_id で紐づける。
export const v2SubscriptionTable = sqliteTable("v2_subscription", {
  userId: text("user_id").primaryKey(),
  plan: text("plan", { enum: ["free", "standard", "premium"] }).notNull(),
  startedAt: integer("started_at").notNull(),
  expiresAt: integer("expires_at"),
  ledgerId: text("ledger_id"),
  cancelledAt: integer("cancelled_at"),
  updatedAt: integer("updated_at").notNull(),
});

// RIT-199: ユーザー単位のアプリ設定。safe_mode=1 はアダルト応答を返さん
// モデルチェーンへ切り替えるセーフモード（zeta のセーフ/アンリミテッド相当）。
export const v2UserSettingsTable = sqliteTable("v2_user_settings", {
  userId: text("user_id").primaryKey(),
  safeMode: integer("safe_mode").notNull().default(0),
  // RIT-205: チャットモード。quality/standard/light。モデルチェーンと長さ上限の切替軸。
  chatMode: text("chat_mode").notNull().default("standard"),
  // RIT-203: 文体スタイル。balanced/prose/dialogue。出力形式の配分だけ変える。
  style: text("style").notNull().default("balanced"),
  // RIT-211: 応答音声の自動再生。ON でもブラウザの自動再生制限は別途かかる。
  voiceAutoplay: integer("voice_autoplay").notNull().default(0),
  // RIT-30 ギャップ: 「AIから見たユーザー」の人物像。空文字は未設定と同じ扱い。
  userPersona: text("user_persona"),
  updatedAt: integer("updated_at").notNull(),
});

// RIT-206: キャラの公開状態。character は v1 共有表なので公開は別テーブルに持つ。
export const v2CharacterPublishTable = sqliteTable(
  "v2_character_publish",
  {
    characterId: text("character_id").primaryKey(),
    userId: text("user_id").notNull(),
    summary: text("summary"),
    publishedAt: integer("published_at").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("idx_v2_character_publish_published").on(table.publishedAt)],
);

// RIT-204: メッセージへの印。kind=bookmark は有無だけ、kind=feedback は value=1/-1。
// 行は消さず「押した時に付け・同じ値で再押しで外す」冪等トグルにする。
export const v2MessageMarkTable = sqliteTable(
  "v2_message_mark",
  {
    messageId: text("message_id").notNull(),
    conversationId: text("conversation_id").notNull(),
    kind: text("kind").notNull(),
    value: integer("value").notNull().default(1),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.messageId, table.kind] }),
    index("idx_v2_message_mark_conversation").on(table.conversationId),
  ],
);

// RIT-207: 公開キャラへのリアクション。user_id 列を持たせて多ユーザー移行を阻まない。
// kind=character はキャラ、kind=creator は作者（target_id=user_id）へのフォロー。
export const v2CatalogLikeTable = sqliteTable(
  "v2_catalog_like",
  {
    characterId: text("character_id").notNull(),
    userId: text("user_id").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.characterId, table.userId] })],
);

export const v2CatalogCommentTable = sqliteTable(
  "v2_catalog_comment",
  {
    id: text("id").primaryKey(),
    characterId: text("character_id").notNull(),
    userId: text("user_id").notNull(),
    body: text("body").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("idx_v2_catalog_comment_character").on(table.characterId)],
);

export const v2FollowTable = sqliteTable(
  "v2_follow",
  {
    userId: text("user_id").notNull(),
    kind: text("kind").notNull(),
    targetId: text("target_id").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.kind, table.targetId] }),
    index("idx_v2_follow_target").on(table.kind, table.targetId),
  ],
);

// RIT-209: 雑談広場の投稿。公開ボードなので会話・キャラとは独立した表。
// created_at 降順のカーソルページングを索引で支える。
export const v2BoardPostTable = sqliteTable(
  "v2_board_post",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    body: text("body").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("idx_v2_board_post_created").on(table.createdAt)],
);

// RIT-195: クリエイター収益行。課金イベント（台帳の tip 行など）から50%還元分を
// 集計して積む。source_ledger_id 一意で冪等（同じイベントは二度積まない）。
export const v2CreatorRevenueTable = sqliteTable(
  "v2_creator_revenue",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    sourceLedgerId: text("source_ledger_id").notNull(),
    sourceType: text("source_type").notNull(),
    refId: text("ref_id"),
    grossAmount: integer("gross_amount").notNull(),
    shareAmount: integer("share_amount").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("v2_creator_revenue_source_unique").on(table.sourceLedgerId),
    index("idx_v2_creator_revenue_user").on(table.userId),
  ],
);

// RIT-214: 章構成ストーリー。story はキャラ＋世界観設定を持つ入れ物、
// chapter は順序・本文・ナレーションを持つ1章。ord は story 内の連番。
export const v2StoryTable = sqliteTable(
  "v2_story",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    characterId: text("character_id").notNull(),
    title: text("title").notNull(),
    worldview: text("worldview").notNull().default(""),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [index("idx_v2_story_user").on(table.userId)],
);

export const v2ChapterTable = sqliteTable(
  "v2_chapter",
  {
    id: text("id").primaryKey(),
    storyId: text("story_id")
      .notNull()
      .references(() => v2StoryTable.id, { onDelete: "cascade" }),
    ord: integer("ord").notNull(),
    title: text("title").notNull().default(""),
    body: text("body").notNull().default(""),
    narration: text("narration").notNull().default(""),
    // RIT-215: 章挿絵の R2 キー（images/*.png）。未生成は NULL。
    imageKey: text("image_key"),
    // RIT-217: 4コマの R2 キー配列（JSON）。動画は video_key + 処理中の task id。
    comicKeys: text("comic_keys"),
    videoKey: text("video_key"),
    videoTaskId: text("video_task_id"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [index("idx_v2_chapter_story").on(table.storyId, table.ord)],
);

// RIT-213: 音声通話の日次無料枠（秒）。日次区切りは usage-limit と同じ JST 0 時。
export const v2VoiceCallUsageTable = sqliteTable(
  "v2_voice_call_usage",
  {
    userId: text("user_id").notNull(),
    dayStart: integer("day_start").notNull(),
    seconds: integer("seconds").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.userId, table.dayStart] })],
);

// RIT-210: キャラ別ボイス設定。engine は TTS 実装の識別子（VOICEVOX 等）、
// speaker_id はエンジン側の話者番号。未設定行は既定値へ倒す。
export const v2CharacterVoiceTable = sqliteTable("v2_character_voice", {
  characterId: text("character_id").primaryKey(),
  engine: text("engine").notNull(),
  speakerId: text("speaker_id").notNull(),
  speed: real("speed").notNull(),
  pitch: real("pitch").notNull(),
  intonation: real("intonation").notNull(),
  updatedAt: integer("updated_at").notNull(),
});
