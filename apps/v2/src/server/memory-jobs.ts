// 記憶まわりの後回し仕事（事実の抜き出し・埋め込み・要約）を運ぶ Queue の受け手。
// 土台では「受け取る・形を確かめる・記録する」までで、中身はまだ無い（PBI-06 で育てる）。
// 届いた仕事は処理せず ack して捨てる。送り手はまだどこにも無く、送り手を足すと
// memory-jobs.test.ts の送信探しが落ちるので、中身より先に送り手だけが出ることは無い。
import { z } from "zod";

export const MEMORY_JOB_KINDS = ["extract-facts", "embed-memory", "summarize-window"] as const;
export type MemoryJobKind = (typeof MEMORY_JOB_KINDS)[number];

// DO の alarm が生成を終えた後に送る想定の封筒。会話・キャラ・ターンで追跡できる形に固定する。
const MemoryJobSchema = z.object({
  kind: z.enum(MEMORY_JOB_KINDS),
  characterId: z.string().min(1).max(120),
  conversationId: z.string().min(1).max(120),
  turn: z.number().int().nonnegative().optional(),
});

export type MemoryJob = z.infer<typeof MemoryJobSchema>;

// 形が合わん仕事は何回やり直しても直らんので、受け取りを終えて落とす（キューを詰まらせん）。
// 返り値は「記録して良い仕事」だけ。
export const parseMemoryJob = (body: unknown): MemoryJob | null => {
  const parsed = MemoryJobSchema.safeParse(body);
  return parsed.success ? parsed.data : null;
};

type AckingMessage = { body: unknown; ack(): void; retry(): void };

// バッチ内の各仕事を 1 件ずつ ack/retry する。全体を throw してまとめて再送にすると、
// 済んだ仕事が二重に走るので使わん。
export const handleMemoryJobBatch = async (batch: { messages: readonly AckingMessage[] }) => {
  for (const message of batch.messages) {
    const job = parseMemoryJob(message.body);
    if (!job) {
      console.warn(JSON.stringify({ event: "memory_job_rejected", reason: "invalid_envelope" }));
      message.ack();
      continue;
    }
    try {
      // 処理済みと取り違えんよう「捨てた」と記録する。
      console.warn(
        JSON.stringify({
          event: "memory_job_discarded",
          reason: "not_implemented",
          kind: job.kind,
          characterId: job.characterId,
          conversationId: job.conversationId,
          turn: job.turn ?? null,
        }),
      );
      message.ack();
    } catch {
      message.retry();
    }
  }
};
