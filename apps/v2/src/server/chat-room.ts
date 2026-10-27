import { ConversationAccessError } from "@v2/db";
import { DurableObject } from "cloudflare:workers";

import { loadRoomHistory, loadStoredReply, loadStoredTurn, startTurn } from "./engine";
import { StoredReplyConflictError } from "./stored-reply";

import type { ChatSseEvent } from "../lib/sse-events";

type JobStatus = "queued" | "running" | "succeeded" | "failed";
type Job = {
  id: string;
  generation_id: string | null;
  character_id: string;
  conversation_id: string;
  text: string;
  digest: string;
  turn: number;
  attempts: number;
  status: JobStatus;
};

export type SubmitTurn = {
  requestId: string;
  characterId: string;
  conversationId: string;
  text: string;
  retry?: boolean;
  turn?: number;
};

export type TurnReceipt = { status: "accepted" | "conflict" | "busy"; requestId: string };
export type StoredEvent = { id: number; event: ChatSseEvent };
export type EventPage = { events: StoredEvent[]; status: JobStatus | "missing" };

const hashInput = async (input: SubmitTurn): Promise<string> => {
  const bytes = new TextEncoder().encode(
    JSON.stringify([input.characterId, input.conversationId, input.text]),
  );
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

class RecoveryConflictError extends Error {}

const isRecoveryConflict = (error: unknown): boolean =>
  error instanceof RecoveryConflictError ||
  error instanceof StoredReplyConflictError ||
  error instanceof ConversationAccessError;

type SavedGeneration = NonNullable<Awaited<ReturnType<typeof loadStoredReply>>>;
const matchesSavedGeneration = (
  job: Job,
  generation: SavedGeneration | null,
): generation is SavedGeneration =>
  generation !== null && (job.generation_id === null || generation.id === job.generation_id);

export class ChatRoom extends DurableObject<Cloudflare.Env> {
  private running = false;

  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY, character_id TEXT NOT NULL, conversation_id TEXT NOT NULL,
      text TEXT NOT NULL, digest TEXT NOT NULL, turn INTEGER NOT NULL, generation_id TEXT,
      attempts INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, created_at INTEGER NOT NULL
    )`);
    const jobColumns = this.ctx.storage.sql
      .exec<{ name: string }>("PRAGMA table_info(jobs)")
      .toArray();
    if (!jobColumns.some((column) => column.name === "generation_id")) {
      this.ctx.storage.sql.exec("ALTER TABLE jobs ADD COLUMN generation_id TEXT");
    }
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL, event TEXT NOT NULL,
      confirmed INTEGER NOT NULL DEFAULT 0
    )`);
    const columns = this.ctx.storage.sql
      .exec<{ name: string }>("PRAGMA table_info(events)")
      .toArray();
    if (!columns.some((column) => column.name === "confirmed")) {
      this.ctx.storage.sql.exec(
        "ALTER TABLE events ADD COLUMN confirmed INTEGER NOT NULL DEFAULT 0",
      );
    }
  }

  async submit(input: SubmitTurn): Promise<TurnReceipt> {
    const digest = await hashInput(input);
    const history = await loadRoomHistory(input);
    return this.ctx.storage.transaction(async (transaction) => {
      const receipt = this.accept(input, digest, history.turn);
      const job = this.job(input.requestId);
      if (
        receipt.status === "accepted" &&
        job &&
        (job.status === "queued" || (job.status === "running" && !this.running))
      ) {
        await transaction.setAlarm(Date.now() + 50);
      }
      return receipt;
    });
  }

  private accept(input: SubmitTurn, digest: string, nextTurn: number): TurnReceipt {
    const existing = this.job(input.requestId);
    if (existing) return this.existingReceipt(input, digest, existing);
    if (!this.matchesRoom(input)) return { status: "conflict", requestId: input.requestId };
    const active = this.activeJob();
    if (active) return { status: "busy", requestId: input.requestId };
    const reserved =
      this.ctx.storage.sql
        .exec<{
          turn: number | null;
        }>("SELECT MAX(turn) AS turn FROM jobs WHERE status != 'failed'")
        .toArray()[0]?.turn ?? 0;
    if (nextTurn <= reserved || (input.turn !== undefined && input.turn !== nextTurn))
      return { status: "conflict", requestId: input.requestId };
    this.ctx.storage.sql.exec(
      "INSERT INTO jobs (id,character_id,conversation_id,text,digest,turn,generation_id,status,created_at) VALUES (?,?,?,?,?,?,?,'queued',?)",
      input.requestId,
      input.characterId,
      input.conversationId,
      input.text,
      digest,
      nextTurn,
      crypto.randomUUID(),
      Date.now(),
    );
    return { status: "accepted", requestId: input.requestId };
  }

  readEvents(requestId: string, after: number): EventPage {
    const job = this.job(requestId);
    if (!job) return { events: [], status: "missing" };
    const rows = this.ctx.storage.sql
      .exec<{
        id: number;
        event: string;
      }>(
        "SELECT id,event FROM events WHERE job_id = ? AND id > ? AND confirmed = 1 ORDER BY id LIMIT 100",
        requestId,
        after,
      )
      .toArray();
    return {
      events: rows.map((row) => {
        const event = JSON.parse(row.event) as ChatSseEvent;
        // 再接続時に古い時差を再適用して配送を遅らせない。
        return {
          id: row.id,
          event: event.type === "delivery" ? { ...event, serverNow: Date.now() } : event,
        };
      }),
      status: job.status,
    };
  }

  async alarm(): Promise<void> {
    if (this.running) return;
    this.running = true;
    let completed = false;
    try {
      const job = this.ctx.storage.sql
        .exec<Job>(
          "SELECT * FROM jobs WHERE status IN ('queued','running') ORDER BY created_at LIMIT 1",
        )
        .toArray()[0];
      if (job) await this.process(job);
      completed = true;
    } finally {
      this.running = false;
      if (completed && this.activeJob()) await this.ctx.storage.setAlarm(Date.now() + 50);
    }
  }

  private matchesRoom(input: SubmitTurn): boolean {
    const room = this.ctx.storage.sql
      .exec<{
        character_id: string;
        conversation_id: string;
      }>("SELECT character_id, conversation_id FROM jobs LIMIT 1")
      .toArray()[0];
    return (
      !room ||
      (room.character_id === input.characterId && room.conversation_id === input.conversationId)
    );
  }

  private existingReceipt(input: SubmitTurn, digest: string, existing: Job): TurnReceipt {
    if (existing.digest !== digest || (input.turn !== undefined && existing.turn !== input.turn))
      return { status: "conflict", requestId: input.requestId };
    if (input.retry && existing.status === "failed") {
      const active = this.activeJob();
      if (active && active.id !== existing.id)
        return { status: "busy", requestId: input.requestId };
      this.ctx.storage.sql.exec("UPDATE jobs SET status = 'queued' WHERE id = ?", input.requestId);
      this.ctx.storage.sql.exec("DELETE FROM events WHERE job_id = ?", input.requestId);
    }
    return { status: "accepted", requestId: input.requestId };
  }

  private activeJob(): Job | undefined {
    return this.ctx.storage.sql
      .exec<Job>(
        "SELECT * FROM jobs WHERE status IN ('queued','running') ORDER BY created_at LIMIT 1",
      )
      .toArray()[0];
  }

  private job(id: string): Job | undefined {
    return this.ctx.storage.sql.exec<Job>("SELECT * FROM jobs WHERE id = ?", id).toArray()[0];
  }

  private finish(job: Job, events: ChatSseEvent[], status: JobStatus): void {
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec("DELETE FROM events WHERE job_id = ?", job.id);
      for (const event of events) {
        this.ctx.storage.sql.exec(
          "INSERT INTO events (job_id,event,confirmed) VALUES (?,?,1)",
          job.id,
          JSON.stringify(event),
        );
      }
      this.ctx.storage.sql.exec("UPDATE jobs SET status = ? WHERE id = ?", status, job.id);
    });
  }

  private async recover(job: Job): Promise<boolean> {
    const history = await loadRoomHistory({
      characterId: job.character_id,
      conversationId: job.conversation_id,
    });
    if (history.turn < job.turn) throw new RecoveryConflictError("conversation rewound");
    if (history.turn === job.turn) return false;
    const messages = await loadStoredTurn(job.character_id, job.conversation_id, job.turn);
    const user = messages.find((message) => message.role === "user");
    const assistant = messages.find((message) => message.role === "assistant");
    if (user?.content !== job.text) throw new RecoveryConflictError("conversation advanced");
    if (!assistant) throw new RecoveryConflictError("saved assistant missing");
    const generation = await loadStoredReply(job.character_id, job.conversation_id, job.turn);
    if (!matchesSavedGeneration(job, generation))
      throw new RecoveryConflictError("saved generation mismatch");
    const usable =
      generation.status === "ok" || (generation.status === "aborted" && generation.error === null);
    if (!usable) {
      this.finish(
        job,
        [
          ...this.savedReplyEvents(generation),
          {
            type: "error",
            message:
              "返信の生成が途中で終了しました。保存済みの内容は会話一覧から確認してください。",
            retryable: false,
            code: "recovery_conflict",
          },
        ],
        "failed",
      );
      return true;
    }
    this.completeRecovered(job, assistant.content, generation);
    return true;
  }

  private savedReplyEvents(generation: SavedGeneration): ChatSseEvent[] {
    return [
      ...(generation.delivery ? [{ type: "delivery" as const, ...generation.delivery }] : []),
      ...generation.events,
    ];
  }

  private completeRecovered(job: Job, content: string, generation: SavedGeneration): void {
    if (content && generation.events.length === 0)
      throw new RecoveryConflictError("saved chunks missing");
    this.finish(
      job,
      [
        ...this.savedReplyEvents(generation),
        {
          type: "done",
          conversationId: job.conversation_id,
          turn: job.turn,
          generationId: generation.id,
        },
      ],
      "succeeded",
    );
  }

  private async generate(job: Job): Promise<ChatSseEvent[]> {
    this.ctx.storage.sql.exec("DELETE FROM events WHERE job_id = ? AND confirmed = 0", job.id);
    const turn = await startTurn({
      characterId: job.character_id,
      conversationId: job.conversation_id,
      text: job.text,
      expectedTurn: job.turn,
      generationId: job.generation_id ?? job.id,
    });
    const events: ChatSseEvent[] = [];
    let failed = false;
    for await (const event of turn.events) {
      if (event.type === "error") failed = true;
      if (["chunk", "delivery", "turn-meta", "done"].includes(event.type)) {
        events.push(event);
        this.ctx.storage.sql.exec(
          "INSERT INTO events (job_id,event,confirmed) VALUES (?,?,0)",
          job.id,
          JSON.stringify(event),
        );
      }
    }
    if (failed || !events.some((event) => event.type === "done"))
      throw new Error("generation failed");
    return events;
  }

  private shouldInterrupt(job: Job): boolean {
    return (
      this.env.APP_ENV === "test" &&
      this.env.V2_TEST_FAULT === "after-persist-once" &&
      job.attempts === 0
    );
  }

  private async process(job: Job): Promise<void> {
    try {
      // 確定保存済みの返信は、生成上限に達した後も再実行せず回収する。
      if (await this.recover(job)) return;
      if (job.attempts >= 3) throw new Error("attempt limit");
      if (!job.generation_id) {
        job.generation_id = crypto.randomUUID();
        this.ctx.storage.sql.exec(
          "UPDATE jobs SET generation_id = ? WHERE id = ?",
          job.generation_id,
          job.id,
        );
      }
      this.ctx.storage.sql.exec(
        "UPDATE jobs SET status = 'running', attempts = attempts + 1 WHERE id = ?",
        job.id,
      );
      await this.generate(job);
    } catch (error) {
      if (!isRecoveryConflict(error) && job.attempts < 2) throw error;
      this.finish(
        job,
        [
          {
            type: "error",
            message: "返信を完了できませんでした。会話一覧から再開してください。",
            retryable: false,
            code: isRecoveryConflict(error) ? "recovery_conflict" : "generation_exhausted",
          },
        ],
        "failed",
      );
      return;
    }
    // 永続化後の中断は running を保ち、alarm の再試行で確定結果を回収させる。
    if (this.shouldInterrupt(job)) {
      throw new Error("test interruption after persistence");
    }
    if (!(await this.recover(job))) throw new Error("saved reply missing");
  }
}
