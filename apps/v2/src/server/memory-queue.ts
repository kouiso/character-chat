import { FakeListChatModel } from "@langchain/core/utils/testing";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import {
  applySummaryRedaction,
  createDb,
  describeError,
  dropSummary,
  failMemoryExtraction,
  failMemoryIndex,
  listForgottenContents,
  listPendingMemoryJobs,
  listRedactPendingSummaries,
  loadMemoryExtractionSource,
  markMemoryJobsQueued,
  markMemoryPublishFailure,
  memoryQueueBodySchema,
  type ExtractionScope,
  type MemoryExtractionSource,
  type MemoryQueueBody,
  type V2Db,
} from "@v2/db";
import {
  createModelChain,
  createOpenRouterModel,
  extractMemorySource,
  type ModelCandidate,
} from "@v2/engine";
import { buildSummaryRedactInstruction } from "@v2/prompt";

import { indexMemoryJob } from "./memory-rag";
import { purgeExpiredMemories } from "./memory-purge";
import { memoryVectorReady, type MemoryVectorBindings } from "./memory-vector";
import { reportFailure } from "./log";
import { readSafeMode } from "./user-settings";

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseMessage } from "@langchain/core/messages";

export const MEMORY_RETRY_DELAY_MS = 30_000;
export const MEMORY_CONSUMER_ATTEMPTS = 5;
// 伏せ直しは要約 1 行につきモデル 1 回。4 回失敗したらその要約の行を消す（FR-4）。
export const SUMMARY_REDACT_ATTEMPTS = 4;

type QueuePublisher = Pick<Queue<MemoryQueueBody>, "sendBatch">;

export const publishMemoryJobs = async (
  db: V2Db,
  queue: QueuePublisher,
  scope: ExtractionScope,
  beforeSend: () => Promise<void>,
  includeUnindexed = false,
  env: unknown = {},
): Promise<boolean> => {
  const jobs = await listPendingMemoryJobs(db, scope, includeUnindexed);
  if (jobs.length === 0) return false;
  await beforeSend();
  const ids = jobs.map((job) => job.id);
  try {
    await queue.sendBatch(ids.map((jobId) => ({ body: { jobId } })));
  } catch {
    await markMemoryPublishFailure(db, ids);
    reportFailure(env, {
      event: "memory_queue_publish_failed",
      level: "error",
      count: ids.length,
    });
    return (await listPendingMemoryJobs(db, scope, includeUnindexed)).length > 0;
  }
  await markMemoryJobsQueued(db, ids);
  return (await listPendingMemoryJobs(db, scope, includeUnindexed)).length > 0;
};

type MemoryModelEnv = Partial<
  Pick<
    Cloudflare.Env,
    | "APP_ENV"
    | "V2_FAKE_MODEL"
    | "V2_MODEL"
    | "V2_MODEL_CHAIN"
    | "V2_SAFE_MODEL_CHAIN"
    | "V2_OPENROUTER_BASE_URL"
    | "OPENROUTER_API_KEY"
    | "V2_TEST_FAULT"
  >
>;

// 抜き出しのモデル鎖（RIT-73 FR-8）。返事と同じ選び方: セーフモードが入なら
// V2_SAFE_MODEL_CHAIN、切なら V2_MODEL_CHAIN の順で試す。試験環境では固定文の偽モデル 1 本。
export const createMemoryExtractionModels = (
  env: MemoryModelEnv,
  safeMode: boolean,
  source: string,
): ModelCandidate[] => {
  if (env.APP_ENV === "test" && env.V2_FAKE_MODEL === "1") {
    return [
      {
        name: "fake",
        model: new FakeListChatModel({
          responses: [
            JSON.stringify({
              memories: source.trim()
                ? [
                    {
                      kind: "fact",
                      content: source.trim().slice(0, 500),
                      importance: 3,
                      validFrom: null,
                      validUntil: null,
                    },
                  ]
                : [],
            }),
          ],
        }),
      },
    ];
  }
  return createModelChain(env, { safeMode });
};

// 失敗の再現用（RIT-73 6-b）。staging・test の時だけモデルを呼ぶ前に投げる。
// 本番（APP_ENV=production）では値が残っていても無視する。
const memoryExtractFault = (env: MemoryModelEnv): boolean =>
  env.V2_TEST_FAULT === "memory-extract-fail" &&
  (env.APP_ENV === "staging" || env.APP_ENV === "test");

// 利用者のセーフモード設定を読んで抜き出しの鎖を組む（RIT-73 FR-8）。
export const resolveMemoryExtractionModels = async (
  env: MemoryModelEnv & Pick<Cloudflare.Env, "DB">,
  source: MemoryExtractionSource,
): Promise<ModelCandidate[]> =>
  createMemoryExtractionModels(env, await readSafeMode(env.DB, source.userId), source.content);

// 1 件の予約を抜き出しから保存まで流す。models は試験が鎖を差し替える口
// （未指定なら利用者のセーフモードで env から組む）。policy・既知 subject の解決と
// 保存の実体は engine の extractMemorySource（RIT-99 でベンチと共有するため移動）。
export const runMemoryExtraction = async (
  db: V2Db,
  env: MemoryModelEnv & Pick<Cloudflare.Env, "DB">,
  source: MemoryExtractionSource,
  models?: readonly BaseChatModel[],
): Promise<void> => {
  if (memoryExtractFault(env)) throw new Error("test fault: memory-extract-fail");
  const resolved = models ?? (await resolveMemoryExtractionModels(env, source)).map((c) => c.model);
  await extractMemorySource(db, source, resolved);
};

// 伏せ直し用のモデル。試験環境では固定文を返す偽モデル（出力が消した事柄を含まん事を確かめる）。
export const createSummaryRedactModel = (env: MemoryModelEnv): BaseChatModel => {
  if (env.APP_ENV === "test" && env.V2_FAKE_MODEL === "1") {
    return new FakeListChatModel({ responses: ["（伏せ直し済みのあらすじ）"] });
  }
  return createOpenRouterModel(env);
};

// OpenAI 系は content を {type:"text",text} のブロック配列で返す事がある。文字列だけ拾う。
const contentToText = (content: BaseMessage["content"]): string => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      if (typeof block === "string") return block;
      if (block.type === "text" && "text" in block && typeof block.text === "string")
        return block.text;
      return "";
    })
    .join("");
};

// 伏せ直し（FR-4）。待ちの要約を 1 行ずつ、墓標の本文を「書かない事柄」として書き直す。
// モデルが空を返した時は失敗として扱い、要約を空で上書きせん。
// message は Queue の配送そのもの（attempts/ack/retry）をテストから差し替えられる形。
export const runSummaryRedact = async (
  db: V2Db,
  env: unknown,
  model: BaseChatModel,
  message: Pick<Message, "attempts" | "ack" | "retry">,
  conversationId: string,
): Promise<void> => {
  const forgotten = await listForgottenContents(db, conversationId);
  const pendings = await listRedactPendingSummaries(db, conversationId);
  for (const summary of pendings) {
    try {
      const result = await model.invoke(
        [
          new SystemMessage(buildSummaryRedactInstruction(forgotten)),
          new HumanMessage(JSON.stringify({ summary: summary.text })),
        ],
        { signal: AbortSignal.timeout(30_000) },
      );
      const text = contentToText(result.content).trim();
      if (text.length === 0) throw new Error("redact returned empty");
      await applySummaryRedaction(db, summary.id, text);
    } catch {
      // 4 回失敗したらその要約の行を消す（あらすじは次の summarize で作り直される）。
      if (message.attempts >= SUMMARY_REDACT_ATTEMPTS) {
        await dropSummary(db, summary.id);
        reportFailure(env, {
          event: "summary_redact_dropped",
          level: "error",
          conversationId,
        });
        continue;
      }
      reportFailure(env, {
        event: "summary_redact_failed",
        level: "error",
        conversationId,
        attempt: message.attempts,
      });
      message.retry({ delaySeconds: MEMORY_RETRY_DELAY_MS / 1_000 });
      return;
    }
  }
  message.ack();
};

const consumeSummaryRedact = async (
  db: V2Db,
  env: MemoryModelEnv & Pick<Cloudflare.Env, "DB"> & MemoryVectorBindings,
  message: Message,
  conversationId: string,
): Promise<void> => {
  // Queue 受け手の始めに復元窓切れの論理削除を物理削除する（RIT-94 FR-7）。
  // 掃除の失敗で伏せ直し自体を止めん — 次の配送か API 要求でまた走る。
  try {
    await purgeExpiredMemories(db, env, { conversationId });
  } catch {
    reportFailure(env, { event: "memory_purge_failed", level: "error" });
  }
  await runSummaryRedact(db, env, createSummaryRedactModel(env), message, conversationId);
};

// 受け手の始めの物理削除（FR-7）。失敗は抜き出し自体を止めん。
const tryPurgeExpiredMemories = async (
  db: V2Db,
  env: MemoryVectorBindings,
  conversationId: string,
): Promise<void> => {
  try {
    await purgeExpiredMemories(db, env, { conversationId });
  } catch {
    reportFailure(env, { event: "memory_purge_failed", level: "error" });
  }
};

// 抜き出し job 1 件の配送。索引の失敗は job ごとに数える（RIT-74 FR-5）。
// 抜き出しの失敗は terminal だけ failed にする — 抜き出し済みの再配送で数を混ぜんため。
const consumeOneMemoryJob = async (
  db: V2Db,
  env: MemoryModelEnv & Pick<Cloudflare.Env, "DB"> & MemoryVectorBindings,
  message: Pick<Message, "attempts" | "ack" | "retry">,
  jobId: string,
): Promise<void> => {
  let indexing = false;
  try {
    const source = await loadMemoryExtractionSource(db, jobId);
    if (source) {
      await tryPurgeExpiredMemories(db, env, source.conversationId);
      await runMemoryExtraction(db, env, source);
    }
    if (memoryVectorReady(env)) {
      indexing = true;
      await indexMemoryJob(db, env, jobId);
    }
    message.ack();
  } catch (error) {
    const terminal = message.attempts >= MEMORY_CONSUMER_ATTEMPTS;
    if (indexing) await failMemoryIndex(db, jobId, terminal);
    reportFailure(env, {
      event: indexing ? "memory_index_failed" : "memory_extraction_failed",
      level: "error",
      jobId,
      attempt: message.attempts,
      terminal,
      reason: describeError(error),
    });
    if (!terminal) {
      message.retry({ delaySeconds: MEMORY_RETRY_DELAY_MS / 1_000 });
      return;
    }
    if (!indexing) await failMemoryExtraction(db, jobId);
    message.ack();
  }
};

export const consumeMemoryJobs = async (
  batch: MessageBatch<unknown>,
  env: MemoryModelEnv &
    Pick<Cloudflare.Env, "DB"> & {
      SLACK_ERROR_WEBHOOK_URL?: string;
    } & MemoryVectorBindings,
): Promise<void> => {
  const db = createDb(env.DB);
  for (const message of batch.messages) {
    const parsed = memoryQueueBodySchema.safeParse(message.body);
    if (!parsed.success) {
      reportFailure(env, {
        event: "memory_queue_invalid_message",
        level: "error",
      });
      message.ack();
      continue;
    }
    // 判別共用体: 伏せ直しの仕事は { type: "summary_redact", conversationId }（本文は D1 の墓標から読む）
    if ("type" in parsed.data) {
      await consumeSummaryRedact(db, env, message, parsed.data.conversationId);
      continue;
    }
    await consumeOneMemoryJob(db, env, message, parsed.data.jobId);
  }
};
