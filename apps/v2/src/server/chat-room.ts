import { DurableObject } from "cloudflare:workers";

import { loadHistory, loadStoredTurn, startTurn } from "./engine";

import type { ChatSseEvent } from "../lib/sse-events";

const CHAT_TURN_FAILURE_EVENT = "chat_turn_failed";
const CHAT_TURN_FAILURE_CATEGORY = "turn_processing_failure";
const MAX_ATTEMPTS = 3;
const HISTORY_READ_LIMIT = 3;

// ログへ出してよいのは、ここで決めた固定の理由だけ。外から来た例外の message には
// 会話本文や接続先の詳細が混ざりうるので、名前しか出さん。
type TurnFailureReason =
  | "attempt_limit"
  | "conversation_rewound"
  | "conversation_advanced"
  | "generation_failed"
  | "test_interruption";

class TurnFailure extends Error {
  readonly reason: TurnFailureReason;
  constructor(reason: TurnFailureReason) {
    super(reason);
    this.name = "TurnFailure";
    this.reason = reason;
  }
}

// 会話が別の送信で進んだ・巻き戻ったのは、何回やり直しても同じ結果になる。
const DETERMINISTIC_REASONS: ReadonlySet<TurnFailureReason> = new Set([
  "conversation_advanced",
  "conversation_rewound",
]);
const isDeterministic = (error: unknown): boolean =>
  error instanceof TurnFailure && DETERMINISTIC_REASONS.has(error.reason);

const describeFailure = (error: unknown): { reason: string } =>
  error instanceof TurnFailure
    ? { reason: error.reason }
    : {
        reason: error instanceof Error ? `unexpected:${error.name}` : `unexpected:${typeof error}`,
      };

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
    // job が終わるたびに上がる番号。D1 の履歴を読む間に別の job が終わったかを、受付の時に見分ける。
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS room_state (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL)",
    );
    this.ctx.storage.sql.exec("INSERT OR IGNORE INTO room_state (id, version) VALUES (1, 0)");
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
    const previous = this.job(input.requestId);
    if (
      !previous ||
      previous.status === "queued" ||
      (previous.status === "running" && !this.running) ||
      (previous.status === "failed" && input.retry && previous.attempts < MAX_ATTEMPTS)
    ) {
      await this.ctx.storage.setAlarm(Date.now() + 50);
    }
    for (let read = 0; read < HISTORY_READ_LIMIT; read++) {
      const version = this.version();
      const history = await loadHistory(input);
      const receipt = this.ctx.storage.transactionSync(() =>
        this.admit(input, digest, history.turn, version),
      );
      if (receipt) return receipt;
    }
    return { status: "busy", requestId: input.requestId };
  }

  private version(): number {
    return (
      this.ctx.storage.sql
        .exec<{ version: number }>("SELECT version FROM room_state WHERE id = 1")
        .toArray()[0]?.version ?? 0
    );
  }

  // transactionSync の中から呼ぶ。読んだ履歴が古くなっとったら null を返し、読み直させる。
  private admit(
    input: SubmitTurn,
    digest: string,
    turn: number,
    version: number,
  ): TurnReceipt | null {
    const existing = this.job(input.requestId);
    if (existing) return this.resubmit(existing, input, digest);
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
    // 履歴を読んどる間に別の job が終わると、読んだターン番号はもう埋まっとる。
    if (this.version() !== version) return null;
    this.ctx.storage.sql.exec(
      "INSERT INTO jobs (id,character_id,conversation_id,text,digest,turn,status,created_at) VALUES (?,?,?,?,?,?,'queued',?)",
      input.requestId,
      input.characterId,
      input.conversationId,
      input.text,
      digest,
      turn,
      Date.now(),
    );
    return { status: "accepted", requestId: input.requestId };
  }

  // 同じ受付番号の送り直し。transactionSync の中から呼ぶ。
  private resubmit(existing: Job, input: SubmitTurn, digest: string): TurnReceipt {
    if (existing.digest !== digest) return { status: "conflict", requestId: input.requestId };
    if (input.retry && existing.status === "failed" && existing.attempts < MAX_ATTEMPTS) {
      // 失敗した間に別の送信が受け付けられとったら、同じターンを二つの job が取り合う。
      const other = this.ctx.storage.sql
        .exec(
          "SELECT id FROM jobs WHERE status IN ('queued','running') AND id != ? LIMIT 1",
          input.requestId,
        )
        .toArray()[0];
      if (other) return { status: "busy", requestId: input.requestId };
      this.ctx.storage.sql.exec("UPDATE jobs SET status = 'queued' WHERE id = ?", input.requestId);
      this.ctx.storage.sql.exec("DELETE FROM events WHERE job_id = ?", input.requestId);
    }
    return { status: "accepted", requestId: input.requestId };
  }

  // 「入力に戻す」が、その送信が実際に割り当てられたターンを確かめる口。画面が覚えとる番号は、
  // 別のタブが会話を進めとるとずれる。
  jobTurn(requestId: string): number | null {
    return this.job(requestId)?.turn ?? null;
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
    // alarm は 1 回で 1 件だけ処理する。残りがあれば次を予約せんと、そのまま止まる。
    const remaining = this.ctx.storage.sql
      .exec("SELECT id FROM jobs WHERE status IN ('queued','running') LIMIT 1")
      .toArray()[0];
    if (remaining) await this.ctx.storage.setAlarm(Date.now() + 50);
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
      this.ctx.storage.sql.exec("UPDATE room_state SET version = version + 1 WHERE id = 1");
    });
  }

  private async recover(job: Job): Promise<boolean> {
    const history = await loadHistory({
      characterId: job.character_id,
      conversationId: job.conversation_id,
    });
    if (history.turn < job.turn) throw new TurnFailure("conversation_rewound");
    if (history.turn === job.turn) return false;
    const messages = await loadStoredTurn(job.character_id, job.conversation_id, job.turn);
    const user = messages.find((message) => message.role === "user");
    const assistant = messages.find((message) => message.role === "assistant");
    if (user?.content !== job.text || history.turn !== job.turn + 1)
      throw new TurnFailure("conversation_advanced");
    if (!assistant?.content.trim()) return false;
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
      throw new TurnFailure("generation_failed");
    return events;
  }

  private async process(job: Job): Promise<void> {
    let attempt = job.attempts;
    try {
      // 最後の試行が D1 へ保存した直後に止まった job もここへ来る。保存済みなら生成し直さず完了にする。
      if (job.attempts >= MAX_ATTEMPTS) {
        if (await this.recover(job)) return;
        throw new TurnFailure("attempt_limit");
      }
      this.ctx.storage.sql.exec(
        "UPDATE jobs SET status = 'running', attempts = attempts + 1 WHERE id = ?",
        job.id,
      );
      attempt = job.attempts + 1;
      if (await this.recover(job)) return;
      const events = await this.generate(job);
      if (
        this.env.APP_ENV === "test" &&
        this.env.V2_TEST_FAULT === "after-persist-once" &&
        job.attempts === 0
      ) {
        throw new TurnFailure("test_interruption");
      }
      this.finish(job, events, "succeeded");
    } catch (error) {
      this.fail(job, attempt, error);
    }
  }

  private fail(job: Job, attempt: number, error: unknown): void {
    const deterministic = isDeterministic(error);
    const terminal = deterministic || attempt >= MAX_ATTEMPTS;
    // 再試行を受け付けんよう、試行回数を上限まで進めておく。
    if (deterministic) {
      this.ctx.storage.sql.exec("UPDATE jobs SET attempts = ? WHERE id = ?", MAX_ATTEMPTS, job.id);
    }
    console.error(
      JSON.stringify({
        event: CHAT_TURN_FAILURE_EVENT,
        category: CHAT_TURN_FAILURE_CATEGORY,
        jobId: job.id,
        attempt,
        terminal,
        ...describeFailure(error),
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
