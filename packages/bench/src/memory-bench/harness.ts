// RIT-99: 1 腕（arm）分の 205 ターンを本番のグラフで回す共通部品。
// - 腕ごとに mkdtemp で分けた新しい D1（マイグレーション済みテンプレートを写す）
// - 1 ターンごとに createTurnGraph を組み直す（本番も毎ターン組む）
// - retrieval 腕だけ: ターンのあとに滞留ジョブを全部 runMemoryJob で処理する
// - 呼び出し・料金の上限は CallBudget に集約し、超えたら腕ごと止める
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";
import {
  BaseChatModel,
  type BaseChatModelCallOptions,
} from "@langchain/core/language_models/chat_models";
import type { BaseMessage } from "@langchain/core/messages";
import type { ChatGenerationChunk, ChatResult } from "@langchain/core/outputs";
import { createPlatform } from "@v2/cf";
import {
  characterTable,
  createDb,
  createD1SummaryStore,
  createD1TurnStore,
  listPendingMemoryJobs,
  userTable,
  v2ConversationTable,
  v2MemoryJobTable,
  type V2Db,
} from "@v2/db";
import { eq } from "drizzle-orm";
import {
  createTurnGraph,
  runMemoryJob,
  retrieveMemories,
  runTurn,
  visibleSummaries,
  SUMMARIZE_LEVEL1_INSTRUCTION,
  SUMMARIZE_LEVEL2_INSTRUCTION,
  type CharacterSheet,
  type MemoryContextEntry,
  type MemoryRetrievalResult,
  type MemoryVectorBindings,
  type ModelCandidate,
  type TurnEvent,
  type TurnModel,
  type TurnModelCallOptions,
} from "@v2/engine";
import { PROMPT_VERSION } from "@v2/prompt";

import type { ArmName, ArmReport, RecallCheck } from "./report";
import { containsAnyAnswer, type RecallScenario } from "./recall-scenario";
import type { LocalVectorIndex } from "./vector-index";

export const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");

export const gitSha = (): string =>
  execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT }).toString().trim();

export class CallLimitError extends Error {
  readonly kind: "call-limit" | "cost-limit";
  constructor(kind: "call-limit" | "cost-limit") {
    super(kind);
    this.name = "CallLimitError";
    this.kind = kind;
  }
}

export type CallBudget = {
  chat: number;
  extraction: number;
  summary: number;
  embedding: number;
  extractionFailures: number;
  embeddingFailures: number;
  usd: number;
  // 使った金額が推定できる時だけ増える。推定不能（価格表が取れん等）の時は null のまま。
  readonly usdKnown: boolean;
  readonly limit: number;
  readonly usdLimit: number;
  hit: "call-limit" | "cost-limit" | null;
};

export const createCallBudget = (opts: {
  limit: number;
  usdLimit: number;
  usdKnown?: boolean;
}): CallBudget => ({
  chat: 0,
  extraction: 0,
  summary: 0,
  embedding: 0,
  extractionFailures: 0,
  embeddingFailures: 0,
  usd: 0,
  usdKnown: opts.usdKnown ?? false,
  limit: opts.limit,
  usdLimit: opts.usdLimit,
  hit: null,
});

const CHARGEABLE = ["chat", "extraction", "summary"] as const;
type ChargeableKind = (typeof CHARGEABLE)[number];

export const chargeableCalls = (budget: CallBudget): number =>
  budget.chat + budget.extraction + budget.summary;

const charge = (budget: CallBudget, kind: ChargeableKind): void => {
  if (chargeableCalls(budget) + 1 > budget.limit) {
    budget.hit = "call-limit";
    throw new CallLimitError("call-limit");
  }
  budget[kind] += 1;
};

export type ModelPrice = { inputUsd: number; outputUsd: number };
export type PriceTable = Record<string, ModelPrice>;

// LLM 呼び出しを数えて上限を掛ける包み。要約呼び出しは最初のメッセージの指示文で
// 見分ける（extractMemories・要約は invoke、会話は stream）。
type CountedOptions = {
  // 抜き出しモデルは呼び出しを全部 extraction として数える。
  fixedKind?: ChargeableKind;
  // 呼び出しごとのタイムアウト（real モードの抜き出しは 3 秒）。
  invokeTimeoutMs?: number;
  prices?: PriceTable;
  modelName?: string;
};

export class CountedChatModel extends BaseChatModel<TurnModelCallOptions> {
  private readonly inner: TurnModel;
  private readonly budget: CallBudget;
  private readonly opts: CountedOptions;

  constructor(inner: TurnModel, budget: CallBudget, opts: CountedOptions = {}) {
    super({});
    this.inner = inner;
    this.budget = budget;
    this.opts = opts;
  }

  _llmType(): string {
    // LangChain のコンストラクタは代入前に _llmType を呼ぶので inner が無い時がある。
    return this.inner?._llmType() ?? "counted";
  }

  get model(): string | undefined {
    return Reflect.get(this.inner, "model") as string | undefined;
  }

  private classify(messages: BaseMessage[]): ChargeableKind {
    if (this.opts.fixedKind) return this.opts.fixedKind;
    const first = String(messages[0]?.content ?? "");
    if (
      first.startsWith(SUMMARIZE_LEVEL1_INSTRUCTION) ||
      first.startsWith(SUMMARIZE_LEVEL2_INSTRUCTION)
    )
      return "summary";
    return "chat";
  }

  private addUsage(raw: { input?: number; output?: number } | undefined): void {
    if (!raw || !this.budget.usdKnown) return;
    const price = this.opts.prices?.[this.opts.modelName ?? this._llmType()];
    if (!price) return;
    this.budget.usd += (raw.input ?? 0) * price.inputUsd + (raw.output ?? 0) * price.outputUsd;
    if (this.budget.usd > this.budget.usdLimit) {
      this.budget.hit = "cost-limit";
      throw new CallLimitError("cost-limit");
    }
  }

  override async _generate(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun,
  ): Promise<ChatResult> {
    charge(this.budget, this.classify(messages));
    const result = await this.inner._generate(messages, options, runManager);
    const usage = result.llmOutput?.tokenUsage as
      | { promptTokens?: number; completionTokens?: number }
      | undefined;
    this.addUsage(
      usage ? { input: usage.promptTokens, output: usage.completionTokens } : undefined,
    );
    return result;
  }

  override async *_streamResponseChunks(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun,
  ): AsyncGenerator<ChatGenerationChunk> {
    charge(this.budget, this.classify(messages));
    for await (const chunk of this.inner._streamResponseChunks(messages, options, runManager)) {
      const usage = Reflect.get(chunk.message, "usage_metadata") as
        | { input_tokens?: number; output_tokens?: number }
        | undefined;
      if (usage) this.addUsage({ input: usage.input_tokens, output: usage.output_tokens });
      yield chunk;
    }
  }

  override invoke(
    input: Parameters<BaseChatModel["invoke"]>[0],
    options?: Partial<BaseChatModelCallOptions>,
  ) {
    const patched =
      this.opts.invokeTimeoutMs === undefined
        ? options
        : { ...options, signal: AbortSignal.timeout(this.opts.invokeTimeoutMs) };
    return super.invoke(input, patched);
  }
}

// AI.run（埋め込み）の呼び出しを数える包み。失敗は上位で job 状態を見て振り分ける。
export const countEmbeddingAi = (ai: Pick<Ai, "run">, budget: CallBudget): Pick<Ai, "run"> => {
  const runAny = ai.run as unknown as (model: string, inputs: unknown) => Promise<unknown>;
  return {
    run: (async (model: string, inputs: Record<string, unknown>) => {
      budget.embedding += 1;
      return runAny(model, inputs);
    }) as Pick<Ai, "run">["run"],
  };
};

const BASE_CHARACTER: CharacterSheet = {
  id: "bench-character",
  name: "想起役",
  systemPrompt: "あなたは温厚で素直なカフェの店員です。",
  greeting: "こんにちは。",
};

export type RunArmDeps = {
  scenario: RecallScenario;
  arm: ArmName;
  // マイグレーション適用済みの persist ルート（テンプレート）。腕ごとにここを写す。
  persistTemplate: string;
  model: TurnModel;
  candidates?: ModelCandidate[];
  extractionModel: BaseChatModel;
  bindings: MemoryVectorBindings;
  vectorIndex?: LocalVectorIndex;
  budget: CallBudget;
  sabotage?: "retrieval-off" | null;
  character?: CharacterSheet;
  collectTranscript?: (record: { turn: number; user: string; assistant: string }) => void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

export type ArmRunResult = {
  arm: ArmReport;
  aborted: "call-limit" | "cost-limit" | null;
  // 3 回送ってもだめだった聞くターンの数（3 個以上で invalidReason: "transport"）。
  transportFailedAsks: number;
  conversationId: string;
  db: V2Db;
  vectorIndex: LocalVectorIndex | undefined;
  cleanup: () => Promise<void>;
};

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

type ArmScope = { userId: string; characterId: string; conversationId: string };

const seedScope = async (db: V2Db, scope: ArmScope): Promise<void> => {
  const createdAt = 1_700_000_000_000;
  await db.insert(userTable).values({
    id: scope.userId,
    email: `${scope.userId}@example.invalid`,
    createdAt,
  });
  await db.insert(characterTable).values({
    id: scope.characterId,
    userId: scope.userId,
    name: BASE_CHARACTER.name,
    systemPrompt: BASE_CHARACTER.systemPrompt,
    greeting: BASE_CHARACTER.greeting,
    tags: [],
    createdAt,
  });
  await db.insert(v2ConversationTable).values({
    id: scope.conversationId,
    userId: scope.userId,
    characterId: scope.characterId,
    threadId: scope.conversationId,
    promptVersion: PROMPT_VERSION,
    createdAt,
    updatedAt: createdAt,
  });
};

type TurnPlanItem = RecallScenario["plans"][number];

type StreamOutcome = {
  raw: string;
  sawError: boolean;
  firstTokenAt: number | null;
  finishedAt: number;
};

const streamOnce = async (
  graph: ReturnType<typeof createTurnGraph>,
  conversationId: string,
  plan: TurnPlanItem,
  character: CharacterSheet,
  now: () => number,
): Promise<StreamOutcome> => {
  const outcome: StreamOutcome = {
    raw: "",
    sawError: false,
    firstTokenAt: null,
    finishedAt: now(),
  };
  for await (const event of runTurn(
    graph,
    {
      conversationId,
      userText: plan.userText,
      character,
      timeoutMs: 10_000,
    },
    conversationId,
  ) as AsyncGenerator<TurnEvent>) {
    if (event.type === "token") {
      if (outcome.firstTokenAt === null) outcome.firstTokenAt = now();
      outcome.raw += event.text;
    } else if (event.type === "error") {
      outcome.sawError = true;
    } else if (event.type === "done") {
      outcome.finishedAt = now();
    }
  }
  return outcome;
};

// 1 回目・2 回目の失敗後に待つ ms（本番の再送間隔に合わせた段階待ち）。
const RETRY_DELAYS_MS = [5_000, 20_000] as const;

const isLimitError = (deps: RunArmDeps, error: unknown): boolean =>
  deps.budget.hit !== null || error instanceof CallLimitError;

const turnSucceeded = (outcome: StreamOutcome): boolean =>
  !outcome.sawError || outcome.raw.trim() !== "";

// 1 発言を最大 3 回送る（本番のクライアント再送と同じ形）。firstTokenAt は全試行の
// 最初の片を記録するので試行を跨いで持ち越す。
const runPlanTurn = async (
  deps: RunArmDeps,
  graph: ReturnType<typeof createTurnGraph>,
  scope: ArmScope,
  plan: TurnPlanItem,
  character: CharacterSheet,
  now: () => number,
  sleep: (ms: number) => Promise<void>,
): Promise<{ outcome: StreamOutcome; transportFailed: boolean }> => {
  let outcome: StreamOutcome = {
    raw: "",
    sawError: false,
    firstTokenAt: null,
    finishedAt: now(),
  };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const next = await streamOnce(graph, scope.conversationId, plan, character, now);
      outcome = { ...next, firstTokenAt: outcome.firstTokenAt ?? next.firstTokenAt };
      if (turnSucceeded(next)) break;
    } catch (error) {
      if (isLimitError(deps, error)) break;
    }
    if (deps.budget.hit) break;
    if (attempt >= 2) return { outcome, transportFailed: true };
    await sleep(RETRY_DELAYS_MS[attempt]);
  }
  return { outcome, transportFailed: false };
};

const buildCheck = (
  deps: RunArmDeps,
  plan: Extract<TurnPlanItem, { kind: "ask" }>,
  raw: string,
  visibleSummaryText: string,
  retrievalOn: boolean,
  lastRetrieved: MemoryContextEntry[],
  startedAt: number,
  timing: { firstTokenAt: number | null; finishedAt: number },
): RecallCheck => {
  const fact = deps.scenario.facts[plan.factIndex];
  const correct = containsAnyAnswer(raw, fact.answers);
  return {
    factId: fact.factId,
    turn: plan.turn,
    distance: plan.distance,
    correct,
    competitorAnswered: !correct && containsAnyAnswer(raw, fact.competitorAnswers),
    retrievedRank: retrievalOn
      ? lastRetrieved.findIndex((entry) => entry.content === fact.plantText) + 1 || null
      : null,
    inSummary: containsAnyAnswer(visibleSummaryText, fact.answers),
    firstChunkMs: timing.firstTokenAt === null ? null : timing.firstTokenAt - startedAt,
    totalMs: Math.max(0, timing.finishedAt - startedAt),
  };
};

// 滞留ジョブを本番のキュー処理と同じ関数で全部流す（ベンチは同期的に回す）。
// 抜き出し完了後（completed）の失敗は索引側、その前は抜き出し側として数える。
const drainMemoryJobs = async (db: V2Db, deps: RunArmDeps, scope: ArmScope): Promise<void> => {
  for (const job of await listPendingMemoryJobs(db, scope)) {
    try {
      await runMemoryJob(db, deps.bindings, job.id, async () => [deps.extractionModel]);
    } catch (error) {
      if (deps.budget.hit || error instanceof CallLimitError) return;
      const rows = await db
        .select({ state: v2MemoryJobTable.state })
        .from(v2MemoryJobTable)
        .where(eq(v2MemoryJobTable.id, job.id));
      if (rows[0]?.state === "completed") deps.budget.embeddingFailures += 1;
      else deps.budget.extractionFailures += 1;
    }
  }
};

const summarizeChecks = (checks: RecallCheck[]): ArmReport => {
  const byDistance = { "50": { asked: 0, correct: 0 }, "200": { asked: 0, correct: 0 } };
  for (const check of checks) {
    const bucket = byDistance[String(check.distance) as "50" | "200"];
    bucket.asked += 1;
    if (check.correct) bucket.correct += 1;
  }
  const asked = checks.length;
  const correct = checks.filter((check) => check.correct).length;
  return {
    asked,
    correct,
    ratio: asked === 0 ? 0 : correct / asked,
    byDistance,
    checks,
  };
};

// 聞くターンが見るあらすじは送信前の一覧（要約はターン内の persist のあとに作られる）。
// visibleSummaries と同じ選び方（redact_pending を出さん・最新 level2 + 未収載 level1）。
const visibleSummaryText = async (
  plan: TurnPlanItem,
  summaryStore: ReturnType<typeof createD1SummaryStore> | undefined,
  conversationId: string,
): Promise<string> =>
  plan.kind === "ask" && summaryStore
    ? visibleSummaries(await summaryStore.list(conversationId))
        .map((summary) => summary.text)
        .join("\n")
    : "";

// 腕ごとに一度だけ組む配線。グラフ自体は毎ターン組み直す（本番も同じ）。
type ArmRuntime = {
  store: ReturnType<typeof createD1TurnStore>;
  summaryStore: ReturnType<typeof createD1SummaryStore> | undefined;
  character: CharacterSheet;
  retrievalOn: boolean;
  // 最後の retrieveMemories の結果を採点へ渡す受け皿（ask の retrievedRank 用）。
  retrieved: { entries: MemoryContextEntry[] };
  retrieveDep?: (conversationId: string, query: string) => Promise<MemoryRetrievalResult>;
};

const characterFor = (deps: RunArmDeps): CharacterSheet => {
  if (deps.character) return deps.character;
  if (deps.arm !== "cheat") return BASE_CHARACTER;
  const facts = deps.scenario.facts.map((fact) => fact.plantText).join("\n");
  return { ...BASE_CHARACTER, systemPrompt: `${BASE_CHARACTER.systemPrompt}\n${facts}` };
};

const armRuntime = (deps: RunArmDeps, db: V2Db, scope: ArmScope): ArmRuntime => {
  const retrievalOn = deps.arm === "retrieval" && deps.sabotage !== "retrieval-off";
  const retrieved: { entries: MemoryContextEntry[] } = { entries: [] };
  return {
    store: createD1TurnStore(db, {
      userId: scope.userId,
      characterId: scope.characterId,
      promptVersion: PROMPT_VERSION,
      extractMemory: deps.arm === "retrieval",
    }),
    summaryStore: deps.arm === "retrieval" && !deps.sabotage ? createD1SummaryStore(db) : undefined,
    character: characterFor(deps),
    retrievalOn,
    retrieved,
    retrieveDep: retrievalOn
      ? async (conversationId: string, query: string): Promise<MemoryRetrievalResult> => {
          const result = await retrieveMemories(
            db,
            deps.bindings,
            { ...scope, conversationId },
            query,
          );
          retrieved.entries = result.entries;
          return result;
        }
      : undefined,
  };
};

type ExecutedTurn = {
  outcome: StreamOutcome;
  transportFailed: boolean;
  summaryText: string;
  startedAt: number;
};

const executeTurn = async (
  deps: RunArmDeps,
  plan: TurnPlanItem,
  rt: ArmRuntime,
  scope: ArmScope,
  now: () => number,
  sleep: (ms: number) => Promise<void>,
): Promise<ExecutedTurn> => {
  const summaryText = await visibleSummaryText(plan, rt.summaryStore, scope.conversationId);
  rt.retrieved.entries = [];
  const graph = createTurnGraph({
    model: deps.model,
    models: deps.candidates,
    store: rt.store,
    summaryStore: rt.summaryStore,
    retrieveMemories: rt.retrieveDep,
  });
  const startedAt = now();
  const { outcome, transportFailed } = await runPlanTurn(
    deps,
    graph,
    scope,
    plan,
    rt.character,
    now,
    sleep,
  );
  return { outcome, transportFailed, summaryText, startedAt };
};

// 採点・記録。戻り値は 3 回送ってもだめだった聞くターンの数（0 or 1）。
const recordTurn = (
  deps: RunArmDeps,
  plan: TurnPlanItem,
  turn: ExecutedTurn,
  rt: ArmRuntime,
  checks: RecallCheck[],
): number => {
  if (plan.kind === "ask") {
    checks.push(
      buildCheck(
        deps,
        plan,
        turn.outcome.raw,
        turn.summaryText,
        rt.retrievalOn,
        rt.retrieved.entries,
        turn.startedAt,
        turn.outcome,
      ),
    );
  }
  deps.collectTranscript?.({
    turn: plan.turn,
    user: plan.userText,
    assistant: turn.outcome.raw,
  });
  return turn.transportFailed && plan.kind === "ask" ? 1 : 0;
};

// 腕の打ち切り理由。上限到達も打ち切り（hit が立ってなくても次は必ず投げるため）。
const abortReason = (deps: RunArmDeps): CallBudget["hit"] =>
  deps.budget.hit ?? (chargeableCalls(deps.budget) >= deps.budget.limit ? "call-limit" : null);

export const runArm = async (deps: RunArmDeps): Promise<ArmRunResult> => {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? defaultSleep;
  const dir = mkdtempSync(path.join(tmpdir(), `memory-bench-${deps.arm}-`));
  let platform: Awaited<ReturnType<typeof createPlatform>> | undefined;
  const cleanup = async (): Promise<void> => {
    await platform?.dispose();
    rmSync(dir, { recursive: true, force: true });
  };

  // セットアップ（雛形写し・platform 起動・seed 投入）も例外経路になりうるので
  // 全部 try に入れる。呼び出し元の cleanup は正常終了した結果だけに届くので、
  // ここで掃除せんと persist ディレクトリと workerd が残ってプロセスが落ちん。
  try {
    cpSync(deps.persistTemplate, dir, { recursive: true });
    platform = await createPlatform({ persistRoot: dir });
    const db = createDb(platform.env.DB);
    // 実行ごとに別の id（腕どうし・2 度目の実行と行が衝突せんため）。数字には
    // 効かんので乱入しても NFR-2 の決定論は崩れん（報告に id は出さん）。
    const scope: ArmScope = {
      userId: `bench-${crypto.randomUUID()}`,
      characterId: `bench-${crypto.randomUUID()}`,
      conversationId: `bench-${crypto.randomUUID()}`,
    };
    await seedScope(db, scope);
    const rt = armRuntime(deps, db, scope);

    const checks: RecallCheck[] = [];
    let aborted: "call-limit" | "cost-limit" | null = null;
    let transportFailedAsks = 0;

    for (const plan of deps.scenario.plans) {
      aborted = abortReason(deps);
      if (aborted) break;
      const turn = await executeTurn(deps, plan, rt, scope, now, sleep);
      aborted = deps.budget.hit;
      if (aborted) break;
      transportFailedAsks += recordTurn(deps, plan, turn, rt, checks);
      if (deps.arm === "retrieval") await drainMemoryJobs(db, deps, scope);
      aborted = deps.budget.hit;
      if (aborted) break;
    }

    return {
      arm: summarizeChecks(checks),
      aborted,
      transportFailedAsks,
      conversationId: scope.conversationId,
      db,
      vectorIndex: deps.vectorIndex,
      cleanup,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
};
