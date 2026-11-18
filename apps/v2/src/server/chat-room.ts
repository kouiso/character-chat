import { createDb, describeError, logEvent } from "@v2/db";
import { PromptBudgetExceededError } from "@v2/engine";
import { DurableObject } from "cloudflare:workers";

import { parseChatSseEvent, type ChatSseEvent } from "../lib/sse-events";

import { loadHistory, loadStoredTurn, startTurn } from "./engine";
import { LOCAL_USER_ID } from "./identity";
import { reportFailure } from "./log";
import { MEMORY_RETRY_DELAY_MS, publishMemoryJobs } from "./memory-queue";
import { memoryVectorReady } from "./memory-vector";
import { summarizeConversation } from "./summary-runner";

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
const MAX_ATTEMPTS = 3;
const WITHDRAWN_MESSAGE = "返信を完了できませんでした。入力に戻してください。";
// 受付・alarm の拾い上げ・予約・状態の問い合わせが、同じ「処理中」の定義を使う。
const ACTIVE_STATUS_SQL = "status IN ('queued','running')";
// 1 回に返す事象の上限。readEvents は続きがあるかを hasMore で返すので、呼び出し側はこの数を知らん。
const EVENT_PAGE_SIZE = 100;
const HISTORY_READ_LIMIT = 3;
// 見張りの間隔。生成中に部屋の実行が消えた時、次の alarm が残りの受付を拾い直す。
const WATCHDOG_DELAY_MS = 30_000;
// 止めるの待ち時間の上限（NFR-4: stop の返りは 3.5 秒以内）。
const STOP_SETTLE_MS = 3_000;

// ログへ出してよいのは、ここで決めた固定の理由だけ。外から来た例外の message には
// 会話本文や接続先の詳細が混ざりうるので、名前しか出さん。
type TurnFailureReason =
  | "attempt_limit"
  | "conversation_rewound"
  | "conversation_advanced"
  | "generation_failed"
  | "prompt_budget_exceeded"
  | "stopped"
  | "test_interruption"
  | "withdrawn";

class TurnFailure extends Error {
  readonly reason: TurnFailureReason;
  constructor(reason: TurnFailureReason) {
    super(reason);
    this.name = "TurnFailure";
    this.reason = reason;
  }
}

// 会話が別の送信で進んだ・巻き戻った・取り下げられたのと、層の上限検査を抜けた
// 指示文は、何回やり直しても同じ結果になる。
const DETERMINISTIC_REASONS: ReadonlySet<TurnFailureReason> = new Set([
  "conversation_advanced",
  "conversation_rewound",
  "prompt_budget_exceeded",
  "withdrawn",
]);
const isDeterministic = (error: unknown): boolean =>
  error instanceof TurnFailure && DETERMINISTIC_REASONS.has(error.reason);

const describeFailure = (error: unknown): { reason: string } =>
  error instanceof TurnFailure ? { reason: error.reason } : { reason: describeError(error) };

type JobStatus = "queued" | "running" | "succeeded" | "failed" | "stopped";
type JobKind = "send" | "regenerate";
type Job = {
  id: string;
  character_id: string;
  conversation_id: string;
  text: string;
  digest: string;
  turn: number;
  attempts: number;
  status: JobStatus;
  kind: JobKind;
  stop_requested: number;
};
// ALTER で足した列。新しい部屋は DEFAULT、既存の部屋は足した時点の値で埋まる。
type JobColumns = {
  failure_code: string | null;
  finished_at: number | null;
  branch_base: number | null;
  created_at: number;
};

export type SubmitTurn = {
  requestId: string;
  characterId: string;
  conversationId: string;
  text: string;
  retry?: boolean;
  kind?: JobKind;
  // kind が "regenerate" の時だけ必須。作り直すターン番号。
  turn?: number;
};

export type TurnReceipt = {
  status: "accepted" | "conflict" | "busy";
  requestId: string;
  // この呼び出しで jobs に新しい行を入れた時だけ真。再接続の重複確かめに使う。
  created: boolean;
};
export type StoredEvent = { id: number; event: ChatSseEvent };
export type EventPage = {
  events: StoredEvent[];
  status: JobStatus | "missing";
  hasMore: boolean;
};
export type JobPeek = {
  requestId: string;
  status: JobStatus;
  turn: number;
  kind: JobKind;
  failureCode: string | null;
};
export type CurrentJob = {
  requestId: string;
  kind: JobKind;
  text: string;
  turn: number;
  status: JobStatus;
  attempts: number;
  startedAt: number;
};
export type StopOutcome = "stopped" | "already_saved" | "already_failed" | "missing";
export type StopResult = { outcome: StopOutcome; turn: number | null };

const isActive = (status: JobStatus | "missing"): boolean =>
  status === "queued" || status === "running";

const hashInput = async (input: SubmitTurn): Promise<string> => {
  const bytes = new TextEncoder().encode(
    JSON.stringify(
      input.kind === "regenerate"
        ? [input.characterId, input.conversationId, "regenerate", input.turn]
        : [input.characterId, input.conversationId, input.text],
    ),
  );
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class ChatRoom extends DurableObject<Cloudflare.Env> {
  private running = false;
  private runningJobId: string | null = null;
  private abortControllers = new Map<string, AbortController>();
  // 要約の係の中断（RIT-72）。新しい job が入ったら submit がここから止める。
  private summaryAbort: AbortController | null = null;
  private eventWaiters = new Set<() => void>();
  // abandon-once の故障を入れた試行は、alarm の末尾の再予約を止めて孤児を再現する。
  private abandonedByFault = false;

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
    // 取り下げ・止めた受付番号の印。後から届いた同じ番号の submit を生成させない。
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS withdrawn (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL)",
    );
    // 既存の部屋へ列を足す。ALTER は冪等でないので、無い列だけ足す。
    const columns = new Set(
      this.ctx.storage.sql
        .exec<{ name: string }>("PRAGMA table_info(jobs)")
        .toArray()
        .map((row) => row.name),
    );
    for (const ddl of [
      "ALTER TABLE jobs ADD COLUMN kind TEXT NOT NULL DEFAULT 'send'",
      "ALTER TABLE jobs ADD COLUMN finished_at INTEGER",
      "ALTER TABLE jobs ADD COLUMN stop_requested INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE jobs ADD COLUMN failure_code TEXT",
      "ALTER TABLE jobs ADD COLUMN branch_base INTEGER",
    ]) {
      const name = ddl.match(/ADD COLUMN (\w+)/)?.[1];
      if (name && !columns.has(name)) this.ctx.storage.sql.exec(ddl);
    }
  }

  private testFault(): string | null {
    return this.env.APP_ENV === "test" ? (this.env.V2_TEST_FAULT ?? null) : null;
  }

  // slow-events の待ち幅。既定は 1 ターンが十数秒で終わる程度なので、画面側の
  // 「少し時間がかかっています」（15 秒超の待ち）を確かめる時だけ長くできる口を残す。
  private faultEventDelayMs(): number {
    const raw = Number(this.env.V2_TEST_FAULT_MS);
    return Number.isFinite(raw) && raw > 0 ? raw : 1500;
  }

  async submit(input: SubmitTurn): Promise<TurnReceipt> {
    await this.checkOrphaned();
    if (this.testFault() === "slow-admit") await sleep(2000);
    const digest = await hashInput(input);
    for (let read = 0; read < HISTORY_READ_LIMIT; read++) {
      const version = this.version();
      const history = await loadHistory(input);
      const receipt = this.ctx.storage.transactionSync(() =>
        this.admit(input, digest, history.turn, version),
      );
      if (!receipt) continue;
      if (receipt.status === "accepted") {
        // 待ちの job が入ったので、走っとる要約は止める（部分保存せず、失敗に数えん）。
        this.summaryAbort?.abort();
        await this.scheduleIfWaiting(input.requestId);
      }
      return receipt;
    }
    return { status: "busy", requestId: input.requestId, created: false };
  }

  // 受け付けた後で予約する。履歴を読む前に予約すると、読んどる間に alarm が先に走って空振りし、
  // 後から入った job が誰にも処理されんまま残る。
  private async scheduleIfWaiting(requestId: string): Promise<void> {
    const job = this.job(requestId);
    if (job && isActive(job.status) && !(job.status === "running" && this.running)) {
      await this.ctx.storage.setAlarm(Date.now() + 50);
    }
  }

  // 孤児の確かめ。処理中の受付が在るのに処理も目覚ましの予約も無い時だけ予約する。
  private async checkOrphaned(): Promise<void> {
    const active = this.ctx.storage.sql
      .exec(`SELECT id FROM jobs WHERE ${ACTIVE_STATUS_SQL} LIMIT 1`)
      .toArray()[0];
    if (!active || this.running) return;
    if ((await this.ctx.storage.getAlarm()) === null) {
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

  private job(id: string): Job | undefined {
    return this.ctx.storage.sql.exec<Job>("SELECT * FROM jobs WHERE id = ?", id).toArray()[0];
  }

  private isWithdrawn(id: string): boolean {
    return (
      this.ctx.storage.sql.exec("SELECT id FROM withdrawn WHERE id = ?", id).toArray().length > 0
    );
  }

  private markWithdrawn(id: string): void {
    this.ctx.storage.sql.exec(
      "INSERT OR IGNORE INTO withdrawn (id, created_at) VALUES (?, ?)",
      id,
      Date.now(),
    );
  }

  // 取り下げ・止め済みの印が在る番号の受付。生成の受付は作らず失敗の行だけ書く。
  // 遅れて届いた送信に返事を付けんため（入力に戻した文と二重になる）。
  private admitWithdrawn(input: SubmitTurn, digest: string, turn: number): TurnReceipt {
    this.ctx.storage.sql.exec(
      "INSERT INTO jobs (id,character_id,conversation_id,text,digest,turn,attempts,status,kind,failure_code,finished_at,created_at) VALUES (?,?,?,?,?,?,?,'failed',?,'withdrawn',?,?)",
      input.requestId,
      input.characterId,
      input.conversationId,
      input.text,
      digest,
      turn,
      MAX_ATTEMPTS,
      input.kind ?? "send",
      Date.now(),
      Date.now(),
    );
    this.writeEventRow(input.requestId, {
      type: "error",
      code: "withdrawn",
      message: WITHDRAWN_MESSAGE,
      terminal: true,
    });
    this.bumpVersion();
    return { status: "accepted", requestId: input.requestId, created: false };
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
    if (this.isWithdrawn(input.requestId)) return this.admitWithdrawn(input, digest, turn);
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
      return { status: "conflict", requestId: input.requestId, created: false };
    }
    const active = this.ctx.storage.sql
      .exec(`SELECT id FROM jobs WHERE ${ACTIVE_STATUS_SQL} LIMIT 1`)
      .toArray()[0];
    if (active) return { status: "busy", requestId: input.requestId, created: false };
    // 履歴を読んどる間に別の job が終わると、読んだターン番号はもう埋まっとる。
    if (this.version() !== version) return null;
    this.insertQueuedJob(input, digest, turn);
    return { status: "accepted", requestId: input.requestId, created: true };
  }

  // 再生成の受付は、作り直すターンと受付時点の枝数（branch_base）も覚える。
  private insertQueuedJob(input: SubmitTurn, digest: string, turn: number): void {
    const regenerate = input.kind === "regenerate";
    this.ctx.storage.sql.exec(
      "INSERT INTO jobs (id,character_id,conversation_id,text,digest,turn,status,kind,branch_base,created_at) VALUES (?,?,?,?,?,?,'queued',?,?,?)",
      input.requestId,
      input.characterId,
      input.conversationId,
      input.text,
      digest,
      regenerate ? (input.turn ?? turn) : turn,
      input.kind ?? "send",
      regenerate ? (input.turn ?? null) : null,
      Date.now(),
    );
  }

  // 同じ受付番号の送り直し。transactionSync の中から呼ぶ。
  private resubmit(existing: Job, input: SubmitTurn, digest: string): TurnReceipt {
    if (existing.digest !== digest)
      return { status: "conflict", requestId: input.requestId, created: false };
    if (input.retry && existing.status === "failed" && existing.attempts < MAX_ATTEMPTS) {
      // 失敗した間に別の送信が受け付けられとったら、同じターンを二つの job が取り合う。
      const other = this.ctx.storage.sql
        .exec(`SELECT id FROM jobs WHERE ${ACTIVE_STATUS_SQL} AND id != ? LIMIT 1`, input.requestId)
        .toArray()[0];
      if (other) return { status: "busy", requestId: input.requestId, created: false };
      this.ctx.storage.sql.exec(
        "UPDATE jobs SET status = 'queued', stop_requested = 0 WHERE id = ?",
        input.requestId,
      );
      this.ctx.storage.sql.exec("DELETE FROM events WHERE job_id = ?", input.requestId);
    }
    // stopped・取り下げ済み・上限に達した受付は retry でも作り直さない。
    return { status: "accepted", requestId: input.requestId, created: false };
  }

  // 「入力に戻す」が、その送信が実際に割り当てられたターンを確かめる口。画面が覚えとる番号は、
  // 別のタブが会話を進めとるとずれる。作成中でない失敗済みの送信は、ここで取り下げ済みにする。
  withdraw(requestId: string): { turn: number; active: boolean } | null {
    const job = this.job(requestId);
    if (!job) {
      // 受付が届く前に取り下げだけ届いた時の印。後から届いた submit は生成しない。
      this.markWithdrawn(requestId);
      return null;
    }
    if (isActive(job.status)) return { turn: job.turn, active: true };
    if (job.status === "failed" && job.attempts < MAX_ATTEMPTS) {
      // 取り下げた後に古いタブの再試行で同じ送信が生成し直されると、入力へ戻した文と二重になる。
      this.ctx.storage.transactionSync(() => {
        this.ctx.storage.sql.exec(
          "UPDATE jobs SET attempts = ?, failure_code = 'withdrawn', finished_at = ? WHERE id = ?",
          MAX_ATTEMPTS,
          Date.now(),
          job.id,
        );
        this.ctx.storage.sql.exec("DELETE FROM events WHERE job_id = ?", job.id);
        this.writeEventRow(job.id, {
          type: "error",
          code: "withdrawn",
          message: WITHDRAWN_MESSAGE,
          terminal: true,
        });
        this.bumpVersion();
      });
      this.notifyEventWrite();
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

  // 新しい事象か終わりの状態が来るまで待つ。待ち切ったら今のページを返す。
  async waitEvents(requestId: string, after: number, waitMs: number): Promise<EventPage> {
    const deadline = Date.now() + waitMs;
    for (;;) {
      const page = this.readEvents(requestId, after);
      if (page.events.length > 0 || page.hasMore || !isActive(page.status)) return page;
      const left = deadline - Date.now();
      if (left <= 0) return page;
      await new Promise<void>((resolve) => {
        const wake = () => {
          this.eventWaiters.delete(wake);
          resolve();
        };
        this.eventWaiters.add(wake);
        setTimeout(
          () => {
            this.eventWaiters.delete(wake);
            resolve();
          },
          Math.min(left, 250),
        );
      });
    }
  }

  // 出来事・状態の変化を待っている呼び出しを起こす。
  private notifyEventWrite(): void {
    for (const wake of this.eventWaiters) wake();
    this.eventWaiters.clear();
  }

  peek(requestId: string): JobPeek | null {
    const job = this.jobFull(requestId);
    if (!job) return null;
    return {
      requestId: job.id,
      status: job.status,
      turn: job.turn,
      kind: job.kind ?? "send",
      failureCode: job.failure_code ?? null,
    };
  }

  private jobFull(id: string): (Job & JobColumns) | undefined {
    return this.ctx.storage.sql
      .exec<Job & JobColumns>("SELECT * FROM jobs WHERE id = ?", id)
      .toArray()[0];
  }

  async current(): Promise<CurrentJob | null> {
    await this.checkOrphaned();
    const job = this.ctx.storage.sql
      .exec<Job & { created_at: number; failure_code: string | null }>(
        `SELECT * FROM jobs WHERE ${ACTIVE_STATUS_SQL} ORDER BY created_at LIMIT 1`,
      )
      .toArray()[0];
    if (!job) return null;
    return {
      requestId: job.id,
      kind: job.kind ?? "send",
      text: job.text,
      turn: job.turn,
      status: job.status,
      attempts: job.attempts,
      startedAt: job.created_at,
    };
  }

  // 記憶の配送を止めたターンの後へ回し直す。止めた後に v2_memory_job を pending に戻した時に呼ぶ。
  async wake(): Promise<void> {
    await this.ctx.storage.setAlarm(Date.now() + 50);
  }

  async alarm(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.abandonedByFault = false;
    try {
      const job = this.ctx.storage.sql
        .exec<Job>(`SELECT * FROM jobs WHERE ${ACTIVE_STATUS_SQL} ORDER BY created_at LIMIT 1`)
        .toArray()[0];
      if (job) {
        // 生成中に部屋の実行が消えた時、残った受付を拾い直す見張り。束ねの有無に関わらず予約する。
        await this.ctx.storage.setAlarm(Date.now() + WATCHDOG_DELAY_MS);
        await this.process(job);
      }
      await this.publishMemories();
      // 要約は返事の配りと記憶の配送の後、待ちの job が 1 つも無い時だけ回す（RIT-72 FR-5）。
      // 要約（最大 60 秒×2）の間に次の発言を待たせんため、job が在る alarm では呼ばん。
      const waiting = this.ctx.storage.sql
        .exec(`SELECT id FROM jobs WHERE ${ACTIVE_STATUS_SQL} LIMIT 1`)
        .toArray()[0];
      if (!waiting) await this.summarizeRoom();
    } finally {
      this.running = false;
      this.runningJobId = null;
    }
    // alarm は 1 回で 1 件だけ処理する。残りがあれば次を予約せんと、そのまま止まる。
    // abandon-once はこの予約を残さんのが故障の再現なので、立てた時だけ消極的に見張りだけ残す。
    if (this.abandonedByFault) return;
    const remaining = this.ctx.storage.sql
      .exec(`SELECT id FROM jobs WHERE ${ACTIVE_STATUS_SQL} LIMIT 1`)
      .toArray()[0];
    if (remaining) {
      await this.ctx.storage.setAlarm(Date.now() + 50);
    } else if (!this.env.MEMORY_QUEUE) {
      // 残りの受付も記憶の配送も無い時は、見張りの予約を残さず畳む。
      await this.ctx.storage.deleteAlarm();
    }
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
      this.env,
    );
    if (pending) await reserve();
  }

  // 要約の係（RIT-72）。会話の選び方は publishMemories と同じ（一番新しい job の会話）。
  // 失敗・中断はここで記録するだけで、job の成否には一切触れん（UR-4）。
  private async summarizeRoom(): Promise<void> {
    const room = this.ctx.storage.sql
      .exec<Job>("SELECT * FROM jobs ORDER BY created_at DESC LIMIT 1")
      .toArray()[0];
    if (!room) return;
    const controller = new AbortController();
    this.summaryAbort = controller;
    try {
      await summarizeConversation(this.env, {
        userId: LOCAL_USER_ID,
        characterId: room.character_id,
        conversationId: room.conversation_id,
        signal: controller.signal,
        storage: this.ctx.storage,
      });
    } catch (error) {
      logEvent({
        event: controller.signal.aborted ? "summary_aborted" : "summary_failed",
        level: controller.signal.aborted ? "info" : "error",
        conversationId: room.conversation_id,
        reason: describeError(error),
      });
    } finally {
      this.summaryAbort = null;
    }
  }

  private bumpVersion(): void {
    this.ctx.storage.sql.exec("UPDATE room_state SET version = version + 1 WHERE id = 1");
  }

  private writeEventRow(jobId: string, event: ChatSseEvent): void {
    this.ctx.storage.sql.exec(
      "INSERT INTO events (job_id,event) VALUES (?,?)",
      jobId,
      JSON.stringify(event),
    );
  }

  // 生成中に 1 件ずつ書く口。試験故障 slow-events は 1 件ごとに待ちを入れて、
  // 塊が画面へ着く間の途中接続・途中停止を再現する。
  private async writeEvent(jobId: string, event: ChatSseEvent): Promise<void> {
    if (this.testFault() === "slow-events") await sleep(this.faultEventDelayMs());
    this.writeEventRow(jobId, event);
    this.notifyEventWrite();
  }

  private finishSuccess(job: Job): void {
    this.ctx.storage.transactionSync(() => {
      // 止めた終わりが先に走っとったら、成功で status を上書きせん。
      const current = this.job(job.id);
      if (!current || current.status === "stopped") return;
      this.ctx.storage.sql.exec(
        "UPDATE jobs SET status = 'succeeded', finished_at = ?, failure_code = NULL, stop_requested = 0 WHERE id = ?",
        Date.now(),
        job.id,
      );
      this.bumpVersion();
    });
    this.notifyEventWrite();
  }

  // 止めた終わり: 出来事を全部消して stopped の 1 行だけ残す。D1 へは止める合図以後何も書かれん
  // （保存の口は signal で閉じてある）。
  private stopFinish(job: Job): void {
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec("DELETE FROM events WHERE job_id = ?", job.id);
      this.writeEventRow(job.id, { type: "stopped" });
      this.ctx.storage.sql.exec(
        "UPDATE jobs SET status = 'stopped', attempts = ?, finished_at = ?, stop_requested = 0 WHERE id = ?",
        MAX_ATTEMPTS,
        Date.now(),
        job.id,
      );
      this.bumpVersion();
    });
    this.notifyEventWrite();
  }

  private async recover(job: Job): Promise<boolean> {
    const history = await loadHistory({
      characterId: job.character_id,
      conversationId: job.conversation_id,
    });
    if (history.turn < job.turn) throw new TurnFailure("conversation_rewound");
    return job.kind === "regenerate" ? this.recoverRegenerate(job) : this.recoverSend(job, history);
  }

  // 再生成はターンが進まんので履歴では分からん。そのターンに保存済みの assistant が
  // 在るなら生成を回さん（branch_base は受付時点の枝数を覚える控え）。
  private async recoverRegenerate(job: Job): Promise<boolean> {
    const messages = await loadStoredTurn(job.character_id, job.conversation_id, job.turn);
    const assistant = messages.find((message) => message.role === "assistant");
    if (!assistant?.content.trim()) return false;
    this.finishRecovered(job);
    return true;
  }

  private async recoverSend(job: Job, history: { turn: number }): Promise<boolean> {
    if (history.turn === job.turn) return false;
    const messages = await loadStoredTurn(job.character_id, job.conversation_id, job.turn);
    const user = messages.find((message) => message.role === "user");
    const assistant = messages.find((message) => message.role === "assistant");
    if (user?.content !== job.text || history.turn !== job.turn + 1)
      throw new TurnFailure("conversation_advanced");
    if (!assistant?.content.trim()) return false;
    this.finishRecovered(job);
    return true;
  }

  // 保存済みターンの回復は予定時刻を持たん。空 = 全部経過済みとして即出す。
  private finishRecovered(job: Job): void {
    this.writeEventRow(job.id, {
      type: "done",
      conversationId: job.conversation_id,
      turn: job.turn,
      generationId: null,
      sendAt: [],
    });
    this.finishSuccess(job);
  }

  private stopRequested(jobId: string): boolean {
    return (
      (this.ctx.storage.sql
        .exec<{ stop_requested: number }>("SELECT stop_requested FROM jobs WHERE id = ?", jobId)
        .toArray()[0]?.stop_requested ?? 0) === 1
    );
  }

  // 止めの合図が立っとるか。中断シグナルと、印の行の両方を見る。
  private halted(jobId: string, signal: AbortSignal): boolean {
    return signal.aborted || this.stopRequested(jobId);
  }

  // 部屋の外へ出す出来事だけ選ぶ。内部の出来事（エラー等）は外へ配らん。
  private publicEventOf(event: unknown): ChatSseEvent | null {
    const parsed = parseChatSseEvent(event);
    return parsed && ["chunk", "turn-meta", "done"].includes(parsed.type) ? parsed : null;
  }

  // 試験故障 fail-after-chunk-once: 最初の試行で、塊が 1 個届いた直後に生成が止まる再現。
  // 返事が途中で止まった状態（cut_off）を実 workerd で確かめる口。
  private failAfterChunkFault(job: Job, event: ChatSseEvent): void {
    if (
      event.type === "chunk" &&
      job.attempts === 0 &&
      this.testFault() === "fail-after-chunk-once"
    ) {
      throw new TurnFailure("generation_failed");
    }
  }

  private async generate(job: Job, signal: AbortSignal): Promise<void> {
    const turn = await startTurn({
      characterId: job.character_id,
      conversationId: job.conversation_id,
      text: job.text,
      expectedTurn: job.turn,
      branch: job.kind === "regenerate",
      signal,
      waitUntil: (promise) => this.ctx.waitUntil(promise),
    });
    let failed = false;
    let done = false;
    try {
      for await (const event of turn.events) {
        // 止めの印が立った後は、塊も保存も進めず畳む。保存の口は signal が閉じとるので
        // ここを抜けた後に D1 のそのターンへ行は増えん。
        if (this.halted(job.id, signal)) return;
        if (event.type === "error") failed = true;
        const publicEvent = this.publicEventOf(event);
        if (publicEvent === null) continue;
        if (publicEvent.type === "done") done = true;
        await this.writeEvent(job.id, publicEvent);
        this.failAfterChunkFault(job, publicEvent);
      }
    } catch (error) {
      throw this.turnErrorOf(job.id, error);
    }
    if (this.halted(job.id, signal)) return;
    if (failed || !done) throw new TurnFailure("generation_failed");
  }

  // 層の予算超過は再生成しても同じなので決定的な失敗へ写す。記録は層ごとの字数だけ
  // （本文は出さん・RIT-71 の失敗時の振る舞い）。
  private turnErrorOf(jobId: string, error: unknown): unknown {
    if (error instanceof PromptBudgetExceededError) {
      reportFailure(this.env, {
        event: "prompt_budget_exceeded",
        level: "error",
        jobId,
        usage: error.usage,
      });
      return new TurnFailure("prompt_budget_exceeded");
    }
    return error;
  }

  // 各試行の最初に attempt を書き、それより前の試行の出来事は同じ束で消す。
  private beginAttempt(job: Job): void {
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec("DELETE FROM events WHERE job_id = ?", job.id);
      this.writeEventRow(job.id, { type: "attempt", attempt: job.attempts + 1 });
      this.ctx.storage.sql.exec(
        "UPDATE jobs SET status = 'running', attempts = attempts + 1 WHERE id = ?",
        job.id,
      );
    });
    this.notifyEventWrite();
  }

  // 試験故障を今の試行へ写す。"abandon" は実行が消えた再現、"fail" は生成失敗の再現。
  private faultActionFor(fault: string | null, job: Job): "abandon" | "fail" | null {
    if (fault === "abandon-once" && job.attempts === 0) return "abandon";
    if (fault === "fail-generation") return "fail";
    if (fault === "fail-generation-once" && job.attempts === 0) return "fail";
    return null;
  }

  // 保存直後に基盤が止まった再現（最初の試行だけ）。
  private afterPersistFault(job: Job): boolean {
    return (
      this.env.APP_ENV === "test" &&
      this.env.V2_TEST_FAULT === "after-persist-once" &&
      job.attempts === 0
    );
  }

  // 試行へ試験故障を写す。abandon は実行が消えた再現でここで処理が終わる（true）。
  // 例外は投げん（投げると基盤のやり直しが拾う）。見張りだけ残す。fail は生成失敗の再現。
  private applyFault(faultAction: "abandon" | "fail" | null): boolean {
    if (faultAction === "abandon") {
      this.abandonedByFault = true;
      return true;
    }
    if (faultAction === "fail") throw new TurnFailure("generation_failed");
    return false;
  }

  // 生成が畳まれた後の仕上げ。止めの印が立っとれば stopped、試験故障なら例外、それ以外は保存済み。
  private finishGenerate(job: Job, signal: AbortSignal): void {
    if (signal.aborted || this.stopRequested(job.id)) {
      this.stopFinish(job);
      return;
    }
    if (this.afterPersistFault(job)) throw new TurnFailure("test_interruption");
    this.finishSuccess(job);
  }

  private async process(job: Job): Promise<void> {
    this.runningJobId = job.id;
    const controller = new AbortController();
    this.abortControllers.set(job.id, controller);
    try {
      // 最後の試行が D1 へ保存した直後に止まった job もここへ来る。保存済みなら生成し直さず完了にする。
      if (await this.recover(job)) return;
      // 履歴を待っとる間に「止める」が queued の job を畳んだかもしれん。手元の行は読んだ時点の
      // ままなので、今の行で状態を確かめ直す（畳まれた job を beginAttempt で起こし直さんため）。
      const current = this.job(job.id);
      if (!current || !isActive(current.status)) return;
      if (current.attempts >= MAX_ATTEMPTS) {
        this.fail(current, current.attempts, new TurnFailure("attempt_limit"));
        return;
      }
      const faultAction = this.faultActionFor(this.testFault(), current);
      this.beginAttempt(current);
      if (this.applyFault(faultAction)) return;
      await this.generate(job, controller.signal);
      this.finishGenerate(job, controller.signal);
    } catch (error) {
      // 止めの合図と失敗が重なった時は止めた終わりを優先する。失敗の表示より、
      // 「止めた後に保存されん」約束の方が大事。
      if (this.stopRequested(job.id)) {
        this.stopFinish(job);
        return;
      }
      this.fail(job, job.attempts + 1, error);
    } finally {
      this.abortControllers.delete(job.id);
    }
  }

  private fail(job: Job, attempt: number, error: unknown): void {
    const deterministic = isDeterministic(error);
    const terminal = deterministic || attempt >= MAX_ATTEMPTS;
    // 試行を使い切って畳んだ失敗は「試行の上限」として届ける。原因の失敗をそのまま出すと、
    // 「もう一度」を押しても再受付は作られず同じ失敗が返るだけの行き止まりになる（FR-5）。
    const code =
      !deterministic && attempt >= MAX_ATTEMPTS
        ? ("attempt_limit" as const)
        : error instanceof TurnFailure
          ? error.reason
          : describeFailure(error).reason;
    this.ctx.storage.transactionSync(() => {
      // 再試行を受け付けんよう、試行回数を上限まで進めておく。
      if (deterministic) {
        this.ctx.storage.sql.exec(
          "UPDATE jobs SET attempts = ? WHERE id = ?",
          MAX_ATTEMPTS,
          job.id,
        );
      }
      this.ctx.storage.sql.exec(
        "UPDATE jobs SET status = 'failed', finished_at = ?, failure_code = ? WHERE id = ?",
        Date.now(),
        code,
        job.id,
      );
      // 途中まで届いた塊は残し、末尾に失敗の出来事を足す（画面は届いた分を見せたまま終われる）。
      this.writeEventRow(job.id, {
        type: "error",
        code,
        message: terminal ? WITHDRAWN_MESSAGE : "返信を完了できませんでした。再試行してください。",
        terminal,
      });
      this.bumpVersion();
    });
    this.notifyEventWrite();
    reportFailure(this.env, {
      event: CHAT_TURN_FAILURE_EVENT,
      level: "error",
      jobId: job.id,
      attempt,
      terminal,
      ...describeFailure(error),
    });
  }

  // 終わった状態の job を stop の結果へ写す。まだ走っとる時は null。
  private settledOutcome(status: JobStatus, turn: number): StopResult | null {
    if (status === "succeeded") return { outcome: "already_saved", turn };
    if (status === "failed") return { outcome: "already_failed", turn };
    if (status === "stopped") return { outcome: "stopped", turn };
    return null;
  }

  // この実行が処理中の job → 印を立てて中断し、最長 STOP_SETTLE_MS だけ終わりを待つ。
  // 待ち切れんかった・この実行の job では無い時は null（呼び元が畳む）。
  private async settleRunning(job: Job): Promise<StopResult | null> {
    if (job.status !== "running" || !this.running || this.runningJobId !== job.id) return null;
    this.ctx.storage.sql.exec("UPDATE jobs SET stop_requested = 1 WHERE id = ?", job.id);
    this.abortControllers.get(job.id)?.abort();
    const deadline = Date.now() + STOP_SETTLE_MS;
    for (;;) {
      const current = this.job(job.id);
      if (!current || !isActive(current.status) || Date.now() >= deadline) break;
      await sleep(50);
    }
    const settled = this.job(job.id);
    return settled ? this.settledOutcome(settled.status, job.turn) : null;
  }

  async stop(requestId: string): Promise<StopResult> {
    await this.checkOrphaned();
    const job = this.job(requestId);
    if (!job) {
      this.markWithdrawn(requestId);
      return { outcome: "missing", turn: null };
    }
    const finished = this.settledOutcome(job.status, job.turn);
    if (finished) return finished;
    const settled = await this.settleRunning(job);
    if (settled) return settled;
    // queued・この実行が処理していない running・待ち切れなかった running は、ここで畳む。
    this.stopFinish(job);
    return { outcome: "stopped", turn: job.turn };
  }
}
