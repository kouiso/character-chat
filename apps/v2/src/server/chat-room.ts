import { DurableObject } from "cloudflare:workers";

import { loadHistory, loadStoredTurn, startTurn } from "./engine";

import type { ChatSseEvent } from "../lib/sse-events";

const CHAT_TURN_FAILURE_EVENT = "chat_turn_failed";
const CHAT_TURN_FAILURE_CATEGORY = "turn_processing_failure";

type JobStatus = "queued" | "running" | "succeeded" | "failed";
type Job = {
  id: string;
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

export class ChatRoom extends DurableObject<Cloudflare.Env> {
  private running = false;

  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY, character_id TEXT NOT NULL, conversation_id TEXT NOT NULL,
      text TEXT NOT NULL, digest TEXT NOT NULL, turn INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, created_at INTEGER NOT NULL
    )`);
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
    const history = await loadHistory(input);
    const previous = this.job(input.requestId);
    if (
      !previous ||
      previous.status === "queued" ||
      (previous.status === "running" && !this.running) ||
      (previous.status === "failed" && input.retry && previous.attempts < 3)
    ) {
      await this.ctx.storage.setAlarm(Date.now() + 50);
    }
    const receipt = this.ctx.storage.transactionSync((): TurnReceipt => {
      const existing = this.job(input.requestId);
      if (existing) {
        if (existing.digest !== digest) return { status: "conflict", requestId: input.requestId };
        if (input.retry && existing.status === "failed" && existing.attempts < 3) {
          this.ctx.storage.sql.exec(
            "UPDATE jobs SET status = 'queued' WHERE id = ?",
            input.requestId,
          );
          this.ctx.storage.sql.exec("DELETE FROM events WHERE job_id = ?", input.requestId);
        }
        return { status: "accepted", requestId: input.requestId };
      }
      const room = this.ctx.storage.sql
        .exec<{
          character_id: string;
          conversation_id: string;
        }>("SELECT character_id, conversation_id FROM jobs LIMIT 1")
        .toArray()[0];
      if (
        room &&
        (room.character_id !== input.characterId || room.conversation_id !== input.conversationId)
      ) {
        return { status: "conflict", requestId: input.requestId };
      }
      const active = this.ctx.storage.sql
        .exec("SELECT id FROM jobs WHERE status IN ('queued','running') LIMIT 1")
        .toArray()[0];
      if (active) return { status: "busy", requestId: input.requestId };
      this.ctx.storage.sql.exec(
        "INSERT INTO jobs (id,character_id,conversation_id,text,digest,turn,status,created_at) VALUES (?,?,?,?,?,?,'queued',?)",
        input.requestId,
        input.characterId,
        input.conversationId,
        input.text,
        digest,
        history.turn,
        Date.now(),
      );
      return { status: "accepted", requestId: input.requestId };
    });
    return receipt;
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
      events: rows.map((row) => ({ id: row.id, event: JSON.parse(row.event) as ChatSseEvent })),
      status: job.status,
    };
  }

  async alarm(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const job = this.ctx.storage.sql
        .exec<Job>(
          "SELECT * FROM jobs WHERE status IN ('queued','running') ORDER BY created_at LIMIT 1",
        )
        .toArray()[0];
      if (job) await this.process(job);
    } finally {
      this.running = false;
    }
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
    const history = await loadHistory({
      characterId: job.character_id,
      conversationId: job.conversation_id,
    });
    if (history.turn < job.turn) throw new Error("conversation rewound");
    if (history.turn === job.turn) return false;
    const messages = await loadStoredTurn(job.character_id, job.conversation_id, job.turn);
    const user = messages.find((message) => message.role === "user");
    const assistant = messages.find((message) => message.role === "assistant");
    if (user?.content !== job.text || history.turn !== job.turn + 1)
      throw new Error("conversation advanced");
    if (!assistant?.content) return false;
    this.finish(
      job,
      [{ type: "done", conversationId: job.conversation_id, turn: job.turn, generationId: null }],
      "succeeded",
    );
    return true;
  }

  private async generate(job: Job): Promise<ChatSseEvent[]> {
    const turn = await startTurn({
      characterId: job.character_id,
      conversationId: job.conversation_id,
      text: job.text,
      expectedTurn: job.turn,
    });
    const events: ChatSseEvent[] = [];
    let failed = false;
    for await (const event of turn.events) {
      if (event.type === "error") failed = true;
      if (["chunk", "turn-meta", "done"].includes(event.type)) {
        events.push(event);
      }
    }
    if (failed || !events.some((event) => event.type === "done"))
      throw new Error("generation failed");
    return events;
  }

  private async process(job: Job): Promise<void> {
    try {
      if (job.attempts >= 3) throw new Error("attempt limit");
      this.ctx.storage.sql.exec(
        "UPDATE jobs SET status = 'running', attempts = attempts + 1 WHERE id = ?",
        job.id,
      );
      if (await this.recover(job)) return;
      const events = await this.generate(job);
      if (
        this.env.APP_ENV === "test" &&
        this.env.V2_TEST_FAULT === "after-persist-once" &&
        job.attempts === 0
      ) {
        throw new Error("test interruption after persistence");
      }
      this.finish(job, events, "succeeded");
    } catch {
      const attempt = job.attempts + 1;
      const terminal = attempt >= 3;
      console.error(
        JSON.stringify({
          event: CHAT_TURN_FAILURE_EVENT,
          category: CHAT_TURN_FAILURE_CATEGORY,
          jobId: job.id,
          attempt,
        }),
      );
      this.finish(
        job,
        [
          {
            type: "error",
            message: terminal
              ? "返信を完了できませんでした。入力に戻してください。"
              : "返信を完了できませんでした。再試行してください。",
            terminal,
          },
        ],
        "failed",
      );
    }
  }
}
