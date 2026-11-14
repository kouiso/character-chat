import { createDb } from "@v2/db";
import { DurableObject } from "cloudflare:workers";

import { parseChatSseEvent, type ChatSseEvent } from "../lib/sse-events";

import { loadHistory, loadStoredTurn, startTurn } from "./engine";
import { LOCAL_USER_ID } from "./identity";
import { MEMORY_RETRY_DELAY_MS, publishMemoryJobs } from "./memory-queue";
import { memoryVectorReady } from "./memory-vector";

const parseStoredEvent = (raw: string): ChatSseEvent => {
  try {
    const value: unknown = JSON.parse(raw);
    const event = parseChatSseEvent(value);
    if (event) return event;
  } catch {
    // 保存内容を例外本文へ含めず、破損行で再送位置を進めない。
  }
  throw new Error("保存されたイベントの形式が不正です。");
};

const CHAT_TURN_FAILURE_EVENT = "chat_turn_failed";
const CHAT_TURN_FAILURE_CATEGORY = "turn_processing_failure";
const MAX_ATTEMPTS = 3;
const WITHDRAWN_MESSAGE = "返信を完了できませんでした。入力に戻してください。";
// 受付・alarm の拾い上げ・予約・状態の問い合わせが、同じ「処理中」の定義を使う。
const ACTIVE_STATUS_SQL = "status IN ('queued','running')";
// 1 回に返す事象の上限。readEvents は続きがあるかを hasMore で返すので、呼び出し側はこの数を知らん。
const EVENT_PAGE_SIZE = 100;
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
export type EventPage = {
  events: StoredEvent[];
  status: JobStatus | "missing";
  hasMore: boolean;
};

const isActive = (status: JobStatus): boolean => status === "queued" || status === "running";

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
      id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL, event TEXT NOT NULL
    )`);
    // job が終わるたびに上がる番号。D1 の履歴を読む間に別の job が終わったかを、受付の時に見分ける。
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS room_state (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL)",
    );
    this.ctx.storage.sql.exec("INSERT OR IGNORE INTO room_state (id, version) VALUES (1, 0)");
  }

  async submit(input: SubmitTurn): Promise<TurnReceipt> {
    const digest = await hashInput(input);
    for (let read = 0; read < HISTORY_READ_LIMIT; read++) {
      const version = this.version();
      const history = await loadHistory(input);
      const receipt = this.ctx.storage.transactionSync(() =>
        this.admit(input, digest, history.turn, version),
      );
      if (!receipt) continue;
      if (receipt.status === "accepted") await this.scheduleIfWaiting(input.requestId);
      return receipt;
    }
    return { status: "busy", requestId: input.requestId };
  }

  // 受け付けた後で予約する。履歴を読む前に予約すると、読んどる間に alarm が先に走って空振りし、
  // 後から入った job が誰にも処理されんまま残る。
  private async scheduleIfWaiting(requestId: string): Promise<void> {
    const job = this.job(requestId);
    if (job && isActive(job.status) && !(job.status === "running" && this.running)) {
      await this.ctx.storage.setAlarm(Date.now() + 50);
    }
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
      .exec(`SELECT id FROM jobs WHERE ${ACTIVE_STATUS_SQL} LIMIT 1`)
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
        .exec(`SELECT id FROM jobs WHERE ${ACTIVE_STATUS_SQL} AND id != ? LIMIT 1`, input.requestId)
        .toArray()[0];
      if (other) return { status: "busy", requestId: input.requestId };
      this.ctx.storage.sql.exec("UPDATE jobs SET status = 'queued' WHERE id = ?", input.requestId);
      this.ctx.storage.sql.exec("DELETE FROM events WHERE job_id = ?", input.requestId);
    }
    return { status: "accepted", requestId: input.requestId };
  }

  // 「入力に戻す」が、その送信が実際に割り当てられたターンを確かめる口。画面が覚えとる番号は、
  // 別のタブが会話を進めとるとずれる。作成中でない失敗済みの送信は、ここで取り下げ済みにする。
  withdraw(requestId: string): { turn: number; active: boolean } | null {
    const job = this.job(requestId);
    if (!job) return null;
    if (isActive(job.status)) return { turn: job.turn, active: true };
    if (job.status === "failed" && job.attempts < MAX_ATTEMPTS) {
      // 取り下げた後に古いタブの再試行で同じ送信が生成し直されると、入力へ戻した文と二重になる。
      this.ctx.storage.sql.exec("UPDATE jobs SET attempts = ? WHERE id = ?", MAX_ATTEMPTS, job.id);
      this.finish(job, [{ type: "error", message: WITHDRAWN_MESSAGE, terminal: true }], "failed");
    }
    return { turn: job.turn, active: false };
  }

  readEvents(requestId: string, after: number): EventPage {
    const job = this.job(requestId);
    if (!job) return { events: [], status: "missing", hasMore: false };
    const rows = this.ctx.storage.sql
      .exec<{
        id: number;
        event: string;
      }>(
        "SELECT id,event FROM events WHERE job_id = ? AND id > ? ORDER BY id LIMIT ?",
        requestId,
        after,
        EVENT_PAGE_SIZE + 1,
      )
      .toArray();
    return {
      events: rows
        .slice(0, EVENT_PAGE_SIZE)
        .map((row) => ({ id: row.id, event: parseStoredEvent(row.event) })),
      status: job.status,
      hasMore: rows.length > EVENT_PAGE_SIZE,
    };
  }

  async alarm(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const job = this.ctx.storage.sql
        .exec<Job>(`SELECT * FROM jobs WHERE ${ACTIVE_STATUS_SQL} ORDER BY created_at LIMIT 1`)
        .toArray()[0];
      if (job) {
        // D1確定後に実行が止まっても、未送信の記憶予約を次のalarmで拾えるよう先に予約する。
        if (this.env.MEMORY_QUEUE) {
          await this.ctx.storage.setAlarm(Date.now() + MEMORY_RETRY_DELAY_MS);
        }
        await this.process(job);
      }
      await this.publishMemories();
    } finally {
      this.running = false;
    }
    // alarm は 1 回で 1 件だけ処理する。残りがあれば次を予約せんと、そのまま止まる。
    const remaining = this.ctx.storage.sql
      .exec(`SELECT id FROM jobs WHERE ${ACTIVE_STATUS_SQL} LIMIT 1`)
      .toArray()[0];
    if (remaining) await this.ctx.storage.setAlarm(Date.now() + 50);
  }

  private job(id: string): Job | undefined {
    return this.ctx.storage.sql.exec<Job>("SELECT * FROM jobs WHERE id = ?", id).toArray()[0];
  }

  private async publishMemories(): Promise<void> {
    if (!this.env.MEMORY_QUEUE) return;
    const room = this.ctx.storage.sql
      .exec<Job>("SELECT * FROM jobs ORDER BY created_at DESC LIMIT 1")
      .toArray()[0];
    if (!room) return;
    const reserve = () => this.ctx.storage.setAlarm(Date.now() + MEMORY_RETRY_DELAY_MS);
    const pending = await publishMemoryJobs(
      createDb(this.env.DB),
      this.env.MEMORY_QUEUE,
      {
        userId: LOCAL_USER_ID,
        characterId: room.character_id,
        conversationId: room.conversation_id,
      },
      reserve,
      memoryVectorReady(this.env),
    );
    if (pending) await reserve();
  }

  private finish(job: Job, events: ChatSseEvent[], status: JobStatus): void {
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec("DELETE FROM events WHERE job_id = ?", job.id);
      for (const event of events) {
        this.ctx.storage.sql.exec(
          "INSERT INTO events (job_id,event) VALUES (?,?)",
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
      [
        {
          type: "done",
          conversationId: job.conversation_id,
          turn: job.turn,
          generationId: null,
          // 保存済みターンの回復は予定時刻を持たん。空 = 全部経過済みとして即出す。
          sendAt: [],
        },
      ],
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
      waitUntil: (promise) => this.ctx.waitUntil(promise),
    });
    const events: ChatSseEvent[] = [];
    let failed = false;
    for await (const event of turn.events) {
      if (event.type === "error") failed = true;
      const publicEvent = parseChatSseEvent(event);
      if (publicEvent && ["chunk", "turn-meta", "done"].includes(publicEvent.type)) {
        events.push(publicEvent);
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
            ? WITHDRAWN_MESSAGE
            : "返信を完了できませんでした。再試行してください。",
          terminal,
        },
      ],
      "failed",
    );
  }
}
