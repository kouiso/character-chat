import { FakeListChatModel } from "@langchain/core/utils/testing";
import {
  completeMemoryExtraction,
  createDb,
  failMemoryExtraction,
  listPendingMemoryJobs,
  loadMemoryExtractionSource,
  markMemoryJobsQueued,
  markMemoryPublishFailure,
  memoryQueueBodySchema,
  type ExtractionScope,
  type MemoryQueueBody,
  type V2Db,
} from "@v2/db";
import { createOpenRouterModel, extractMemories } from "@v2/engine";

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

export const MEMORY_RETRY_DELAY_MS = 30_000;
export const MEMORY_CONSUMER_ATTEMPTS = 5;

const reportMemoryEvent = (event: Record<string, unknown>): void => {
  globalThis.console.error(JSON.stringify(event));
};

type QueuePublisher = Pick<Queue<MemoryQueueBody>, "sendBatch">;

export const publishMemoryJobs = async (
  db: V2Db,
  queue: QueuePublisher,
  scope: ExtractionScope,
  beforeSend: () => Promise<void>,
): Promise<boolean> => {
  const jobs = await listPendingMemoryJobs(db, scope);
  if (jobs.length === 0) return false;
  await beforeSend();
  const ids = jobs.map((job) => job.id);
  try {
    await queue.sendBatch(ids.map((jobId) => ({ body: { jobId } })));
    await markMemoryJobsQueued(db, ids);
  } catch {
    await markMemoryPublishFailure(db, ids);
    reportMemoryEvent({ event: "memory_queue_publish_failed", jobs: ids.length });
  }
  return (await listPendingMemoryJobs(db, scope)).length > 0;
};

type MemoryModelEnv = Pick<
  Cloudflare.Env,
  "APP_ENV" | "V2_FAKE_MODEL" | "V2_MODEL" | "OPENROUTER_API_KEY"
>;

export const createMemoryExtractionModel = (env: MemoryModelEnv, source: string): BaseChatModel => {
  if (env.APP_ENV === "test" && env.V2_FAKE_MODEL === "1") {
    return new FakeListChatModel({
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
    });
  }
  return createOpenRouterModel(env);
};

export const consumeMemoryJobs = async (
  batch: MessageBatch<unknown>,
  env: MemoryModelEnv & Pick<Cloudflare.Env, "DB">,
): Promise<void> => {
  const db = createDb(env.DB);
  for (const message of batch.messages) {
    const parsed = memoryQueueBodySchema.safeParse(message.body);
    if (!parsed.success) {
      reportMemoryEvent({ event: "memory_queue_invalid_message" });
      message.ack();
      continue;
    }
    const { jobId } = parsed.data;
    try {
      const source = await loadMemoryExtractionSource(db, jobId);
      if (source) {
        const memories = await extractMemories(
          createMemoryExtractionModel(env, source.content),
          source.content,
        );
        await completeMemoryExtraction(db, source, memories);
      }
      message.ack();
    } catch {
      const terminal = message.attempts >= MEMORY_CONSUMER_ATTEMPTS;
      reportMemoryEvent({
        event: "memory_extraction_failed",
        jobId,
        attempt: message.attempts,
        terminal,
      });
      if (terminal) {
        await failMemoryExtraction(db, jobId);
        message.ack();
      } else {
        message.retry({ delaySeconds: MEMORY_RETRY_DELAY_MS / 1_000 });
      }
    }
  }
};
