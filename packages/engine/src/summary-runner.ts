// 巻き取り要約の係（RIT-72）。ChatRoom の alarm が、待っている job が無い時だけ呼ぶ。
// 返事の処理とは別なので、要約の失敗・中断はその返事の成否を変えん（UR-4）。
// 手元の Node（script/summary-check.ts）からも呼ばれるので、cloudflare:workers に
// 届く import（platform.ts・log.ts・engine.ts・character-data.server.ts）を持ち込まん。
import { HumanMessage } from "@langchain/core/messages";
import { appendForgottenInstruction } from "@v2/prompt";
import {
  buildConversationContext,
  contextBudgetFromEnv,
  resolveContextBudget,
} from "./context-budget";
import { createModelChain } from "./model";
import { visibleSummaries, type ModelCandidate } from "./graph";
import {
  createDb,
  describeError,
  invalidateSummaryById,
  listActiveSummaries,
  listForgottenContents,
  loadCharacterName,
  loadRecentActiveMessages,
  loadTurnRange,
  logEvent,
  readSafeMode,
  saveSummaryRange,
  summarySourceHash,
  type StoredSummary,
  type SummarySourceRow,
  type V2Db,
} from "@v2/db";
import { fakeModelCandidates } from "./fake-model";

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

// 要約の起こる件数・字数の仮の値（未決 2 の既定案。出どころは無く、RIT-99 の結果で見直す）。
export const SUMMARY_TRIGGER_MESSAGES = 20;
export const SUMMARY_ROLLUP_LEVEL1 = 4;
// 要約 1 本に入れる元の会話の上限（FR-1）。
export const SUMMARY_SOURCE_CHARACTERS = 12_000;
// 1 ターンが単独で上限を超えた時、モデルへ渡す各メッセージの切り詰め（hash は切る前の本文）。
export const SUMMARY_TRUNCATED_MESSAGE_CHARACTERS = 6_000;
// 要約の 1 回の呼び出しの締切（NFR-2）。
export const SUMMARY_TIMEOUT_MS = 60_000;
// 連続失敗で 1 時間止める閾値と止まる長さ（NFR-2）。置き場は ChatRoom の storage。
export const SUMMARY_MAX_FAILURES = 3;
export const SUMMARY_PAUSE_MS = 3_600_000;
export const SUMMARY_FAILURES_KEY = "summary_failures";
export const SUMMARY_PAUSED_KEY = "summary_paused_until";
// 指示する字数と、超えた返事を捨てる上限（FR-4・NFR-3）。
export const SUMMARY_LEVEL1_TARGET_CHARS = 400;
export const SUMMARY_LEVEL1_MAX_CHARS = 800;
export const SUMMARY_LEVEL2_TARGET_CHARS = 1_200;
export const SUMMARY_LEVEL2_MAX_CHARS = 1_500;

// 作り話防止が本質の指示（壊しにいく確かめ: 要約に無い作り話が混ざらんか）。
// 旧 graph.ts の summarize ノードの文を流用し、字数の指示を足した（FR-4）。
const LEVEL1_INSTRUCTION = `これはキャラクターチャットの会話の一部。後のターンで参照するため、起きた出来事・約束・感情の変化・大事な設定を失わんよう簡潔に要約せよ。書かれとらん事実や推測は足すな。${SUMMARY_LEVEL1_TARGET_CHARS}字以内で書け。`;
const LEVEL2_INSTRUCTION = `これは会話の部分要約の集まり。全体の流れが分かる一段上の要約にまとめ直せ。書かれとらん事実や推測は足すな。${SUMMARY_LEVEL2_TARGET_CHARS}字以内で書け。`;

// 呼び出し側の合図（新しい発言が届いた）で止める中断。失敗には数えん（FR-5）。
export class SummaryAbortError extends Error {
  constructor() {
    super("summary aborted");
    this.name = "SummaryAbortError";
  }
}

export type SummaryFailureReason = "model_error" | "timeout" | "too_long" | "empty";

// 要約を次の alarm でやり直せる失敗。理由の符号だけ持つ（NFR-4: 本文は出さん）。
export class SummaryFailure extends Error {
  readonly reason: SummaryFailureReason;
  readonly summaryLevel?: number;
  readonly fromTurn?: number;
  readonly toTurn?: number;
  constructor(
    reason: SummaryFailureReason,
    range?: { summaryLevel: number; fromTurn: number; toTurn: number },
  ) {
    super(reason);
    this.name = "SummaryFailure";
    this.reason = reason;
    this.summaryLevel = range?.summaryLevel;
    this.fromTurn = range?.fromTurn;
    this.toTurn = range?.toTurn;
  }
}

// 返事と同じ選び方の鎖を順に試す（未決 1 の既定案。セーフモードが入なら SAFE 鎖）。
export type SummaryRunnerEnv = {
  DB?: D1Database;
  APP_ENV?: string;
  OPENROUTER_API_KEY?: string;
  V2_MODEL?: string;
  V2_MODEL_CHAIN?: string;
  V2_SAFE_MODEL_CHAIN?: string;
  V2_QUALITY_MODEL_CHAIN?: string;
  V2_LIGHT_MODEL_CHAIN?: string;
  V2_OPENROUTER_BASE_URL?: string;
  V2_FAKE_MODEL?: string;
  V2_FAKE_RESPONSE?: string;
  V2_HISTORY_CHARACTERS?: string | number;
  V2_HISTORY_MESSAGES?: string | number;
  V2_SUMMARY_CHARACTERS?: string | number;
};

// 止める時刻と失敗回数の置き場。本番は ChatRoom の storage、試験・台本ではメモリで足す。
export type SummaryStorage = {
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown): Promise<void>;
};

export type SummaryInput = {
  userId: string;
  characterId: string;
  conversationId: string;
  signal?: AbortSignal;
  storage?: SummaryStorage;
};

// 差し替え口。本番では全部省略し、試験は偽モデル・固定時計をここへ入れる。
export type SummaryDeps = {
  db?: V2Db;
  models?: ModelCandidate[];
  now?: () => number;
  timeoutMs?: number;
  // モデル呼び出しを始める度に呼ぶ（試験・bench 台が実呼出し回数を数える窓口）。
  onModelCall?: () => void;
};

export type SummaryOutcome = "idle" | "saved" | "aborted" | "failed" | "paused";

const throwIfAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) throw new SummaryAbortError();
};

const textContent = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) =>
      typeof part === "object" && part !== null && "text" in part ? String(part.text) : "",
    )
    .join("");
};

// モデル呼び出しへ、呼び出し側の合図と要約自身の締切を一束で届ける。
const invokeSummary = async (
  model: BaseChatModel,
  instruction: string,
  body: string,
  opts: { signal?: AbortSignal; timeoutMs: number },
): Promise<string> => {
  const controller = new AbortController();
  if (opts.signal) {
    if (opts.signal.aborted) throw new SummaryAbortError();
    opts.signal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  const deadline = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    const result = await model.invoke([new HumanMessage(`${instruction}\n\n${body}`)], {
      signal: controller.signal,
    });
    throwIfAborted(opts.signal);
    return textContent(result.content).trim();
  } catch (error) {
    if (opts.signal?.aborted || error instanceof SummaryAbortError) throw new SummaryAbortError();
    // 自分の締切だけ timeout へ写す。それ以外（鍵・ネットワーク・5xx）はそのまま上へ。
    if (controller.signal.aborted) throw new SummaryFailure("timeout");
    throw error;
  } finally {
    clearTimeout(deadline);
  }
};

// 返事と同じく、鎖の先頭から順に試す（1 本が落ちても次のモデルへ逃げる）。
const invokeSummaryChain = async (
  models: ModelCandidate[],
  instruction: string,
  body: string,
  opts: { signal?: AbortSignal; timeoutMs: number; onModelCall?: () => void },
  range: { summaryLevel: number; fromTurn: number; toTurn: number },
): Promise<string> => {
  let lastError: unknown;
  for (const candidate of models) {
    try {
      opts.onModelCall?.();
      return await invokeSummary(candidate.model, instruction, body, opts);
    } catch (error) {
      if (error instanceof SummaryAbortError) throw error;
      lastError = error;
    }
  }
  // 全滅は 1 件の失敗として数える（NFR-2 の連続失敗は「要約 1 回」単位）。
  throw new SummaryFailure(
    lastError instanceof SummaryFailure ? lastError.reason : "model_error",
    range,
  );
};

// モデルの選び方は返事と同じ（セーフモードが入なら V2_SAFE_MODEL_CHAIN、切なら
// V2_MODEL_CHAIN。キャンバスの注記 12 を要約では繰り返さん・未決 1 の既定案）。
const resolveModels = async (env: SummaryRunnerEnv, userId: string): Promise<ModelCandidate[]> => {
  if (env.APP_ENV === "test" && env.V2_FAKE_MODEL === "1") return fakeModelCandidates(env);
  const safeMode = env.DB ? await readSafeMode(env.DB, userId) : false;
  return createModelChain(
    {
      OPENROUTER_API_KEY: env.OPENROUTER_API_KEY,
      V2_MODEL: env.V2_MODEL,
      V2_OPENROUTER_BASE_URL: env.V2_OPENROUTER_BASE_URL,
      V2_MODEL_CHAIN: env.V2_MODEL_CHAIN,
      V2_SAFE_MODEL_CHAIN: env.V2_SAFE_MODEL_CHAIN,
      V2_QUALITY_MODEL_CHAIN: env.V2_QUALITY_MODEL_CHAIN,
      V2_LIGHT_MODEL_CHAIN: env.V2_LIGHT_MODEL_CHAIN,
    },
    { safeMode },
  );
};

// 要約 1 行の hash を作り直し、違えば無効にして記録する。合っとれば true。
const verifySummaryHash = async (
  db: V2Db,
  conversationId: string,
  summary: StoredSummary,
): Promise<boolean> => {
  if (summary.sourceHash === null) return true;
  const rows = await loadTurnRange(db, {
    conversationId,
    fromTurn: summary.fromTurn,
    toTurn: summary.toTurn,
  });
  const actual = await summarySourceHash(rows);
  if (actual === summary.sourceHash) return true;
  await invalidateSummaryById(db, summary.id);
  logEvent({
    event: "summary_source_mismatch",
    level: "warn",
    conversationId,
    summaryLevel: summary.level,
    fromTurn: summary.fromTurn,
    toTurn: summary.toTurn,
  });
  return false;
};

// FR-8: 指示文に入りうる要約（最新の有効な level 2 とそれより後の level 1）について、
// その範囲の有効メッセージから hash を作り直し、違う行を無効にする。
// 戻る・作り直しの無効化は saveTurn の batch がその場で行うので、これは取りこぼしを拾う網。
const verifySummaryHashes = async (
  db: V2Db,
  conversationId: string,
  signal: AbortSignal | undefined,
): Promise<boolean> => {
  const active = await listActiveSummaries(db, conversationId);
  let changed = false;
  for (const summary of visibleSummaries(active)) {
    throwIfAborted(signal);
    if (!(await verifySummaryHash(db, conversationId, summary))) changed = true;
  }
  return changed;
};

type SummaryChunk = {
  rows: SummarySourceRow[];
  fromTurn: number;
  toTurn: number;
  // 先頭の 1 ターンだけで 12,000 字を超えた時だけ立つ。モデル入力は各メッセージを
  // 6,000 字に切る（hash は切る前の本文で作る・FR-1）。
  truncate: boolean;
};

const groupRowsByTurn = (rows: SummarySourceRow[]): SummarySourceRow[][] => {
  const rowsByTurn = new Map<number, SummarySourceRow[]>();
  for (const row of rows) {
    rowsByTurn.set(row.turn, [...(rowsByTurn.get(row.turn) ?? []), row]);
  }
  return [...rowsByTurn.values()];
};

const turnCharacters = (rows: SummarySourceRow[]): number =>
  rows.reduce((total, row) => total + row.content.length, 0);

// 先頭から 12,000 字に収まるターンまでを取る。1 ターンは利用者の発言と返事のまとまり。
const takeSummaryChunk = (rows: SummarySourceRow[]): SummaryChunk => {
  const picked: SummarySourceRow[] = [];
  let truncate = false;
  for (const turnRows of groupRowsByTurn(rows)) {
    const characters = turnCharacters(turnRows);
    if (picked.length > 0 && turnCharacters(picked) + characters > SUMMARY_SOURCE_CHARACTERS) break;
    picked.push(...turnRows);
    if (picked.length === turnRows.length && characters > SUMMARY_SOURCE_CHARACTERS) {
      // 先頭の 1 ターンだけで上限超え: そのターンだけで level 1 を作る。
      truncate = true;
      break;
    }
  }
  return {
    rows: picked,
    fromTurn: picked[0]?.turn ?? 0,
    toTurn: picked.at(-1)?.turn ?? 0,
    truncate,
  };
};

// 指示へ渡す会話の形: `相手: …` と `{キャラ名}: …` の行（旧 summarize ノードと同じ並び）。
const formatSummaryBody = (chunk: SummaryChunk, characterName: string): string =>
  chunk.rows
    .map((row) => {
      const content = chunk.truncate
        ? row.content.slice(0, SUMMARY_TRUNCATED_MESSAGE_CHARACTERS)
        : row.content;
      return `${row.role === "user" ? "相手" : characterName}: ${content}`;
    })
    .join("\n");

// 返事が空・上限超えなら保存せず失敗として数える（FR-4・NFR-3）。
const guardSummaryText = (
  text: string,
  range: { summaryLevel: number; fromTurn: number; toTurn: number },
): void => {
  if (text.length === 0) throw new SummaryFailure("empty", range);
  const limit = range.summaryLevel === 1 ? SUMMARY_LEVEL1_MAX_CHARS : SUMMARY_LEVEL2_MAX_CHARS;
  if (text.length > limit) throw new SummaryFailure("too_long", range);
};

const saveLevelSummary = async (
  db: V2Db,
  input: SummaryInput,
  saved: { level: number; fromTurn: number; toTurn: number; sourceHash: string; text: string },
): Promise<void> => {
  await saveSummaryRange(db, { conversationId: input.conversationId, ...saved });
  logEvent({
    event: "summary_saved",
    level: "info",
    conversationId: input.conversationId,
    summaryLevel: saved.level,
    fromTurn: saved.fromTurn,
    toTurn: saved.toTurn,
    chars: saved.text.length,
  });
};

// level 2 の入力に使う行は、指示文に出る行（visible）と限らんので、畳む直前に
// 元本文の hash を確かめる。違う行は無効にして、次の alarm で作り直させる
//（同じ実行では古い本文を畳まん）。
const verifyRollupInputs = async (
  db: V2Db,
  input: SummaryInput,
  inputs: StoredSummary[],
): Promise<boolean> => {
  for (const inputSummary of inputs) {
    throwIfAborted(input.signal);
    if (!(await verifySummaryHash(db, input.conversationId, inputSummary))) return false;
  }
  return true;
};

// 畳む入力行の並びに穴がある時、その区間に有効なメッセージが残るか確かめる。
// 実メッセージのある区間を跨いで畳むと、その範囲が「集約済み」になって表示も
// 修復もされんまま落ちる。メッセージが無い欠番の区間（眠らせた枝）は跨いでよい。
const rollupGapHasMessages = async (
  db: V2Db,
  conversationId: string,
  anchors: StoredSummary[],
): Promise<boolean> => {
  let coveredEnd = 0;
  for (const entry of [...anchors].sort((a, b) => a.fromTurn - b.fromTurn)) {
    if (entry.fromTurn <= coveredEnd + 1) {
      coveredEnd = Math.max(coveredEnd, entry.toTurn);
      continue;
    }
    const gap = await loadTurnRange(db, {
      conversationId,
      fromTurn: coveredEnd + 1,
      toTurn: entry.fromTurn - 1,
    });
    if (gap.length > 0) return true;
    coveredEnd = entry.toTurn;
  }
  return false;
};

type RollupPlan = {
  latest2: StoredSummary | undefined;
  group: StoredSummary[];
  inputs: StoredSummary[];
  range: { summaryLevel: number; fromTurn: number; toTurn: number };
};

// 畳みの材料を選ぶ: 伏せ直し待ちは外し、最新の level 2 ＋その後の連続した
// level 1 から 4 本。入力行が覆わん区間に実メッセージが残る時は null を返して
// 集約を見送る（その範囲の要約が先。伏せ直し待ちの本文は入力に戻さん）。
const pickRollupPlan = async (
  db: V2Db,
  conversationId: string,
  active: StoredSummary[],
): Promise<RollupPlan | null> => {
  const usable = active.filter((entry) => !entry.redactPending);
  const latest2 = usable
    .filter((entry) => entry.level === 2)
    .sort((a, b) => a.toTurn - b.toTurn)
    .at(-1);
  const pending = usable
    .filter((entry) => entry.level === 1 && entry.toTurn > (latest2?.toTurn ?? 0))
    .sort((a, b) => a.fromTurn - b.fromTurn);
  if (pending.length < SUMMARY_ROLLUP_LEVEL1) return null;
  const group = pending.slice(0, SUMMARY_ROLLUP_LEVEL1);
  const inputs = [...(latest2 ? [latest2] : []), ...group];
  if (await rollupGapHasMessages(db, conversationId, inputs)) return null;
  return {
    latest2,
    group,
    inputs,
    range: {
      summaryLevel: 2,
      fromTurn: Math.min(latest2?.fromTurn ?? Number.MAX_SAFE_INTEGER, group[0].fromTurn),
      toTurn: group.at(-1)?.toTurn ?? group[0].toTurn,
    },
  };
};

// FR-2: 最新の level 2 より後の有効な level 1 が 4 本たまったら、「前の level 2 ＋
// その 4 本」でまとめ直す。新しい分だけを畳むと古い出来事が level 2 から落ちる。
const maybeRollUpLevel2 = async (
  db: V2Db,
  env: SummaryRunnerEnv,
  input: SummaryInput,
  deps: SummaryDeps,
  active: StoredSummary[],
): Promise<boolean> => {
  const plan = await pickRollupPlan(db, input.conversationId, active);
  if (!plan) return false;
  const { latest2, group, inputs, range } = plan;
  throwIfAborted(input.signal);
  const sourceRows = await loadTurnRange(db, {
    conversationId: input.conversationId,
    fromTurn: range.fromTurn,
    toTurn: range.toTurn,
  });
  // 入力の検証は範囲の読込みのあと。読んだ行と畳む要約が同じ履歴の版を見る形に
  // そろえ、間に枝の切替えが入った時は不一致で畳みを見送る。
  if (!(await verifyRollupInputs(db, input, inputs))) return true;
  const sourceHash = await summarySourceHash(sourceRows);
  const forgotten = await listForgottenContents(db, input.conversationId);
  const models = deps.models ?? (await resolveModels(env, input.userId));
  const body = [...(latest2 ? [latest2.text] : []), ...group.map((entry) => entry.text)].join("\n");
  const text = await invokeSummaryChain(
    models,
    appendForgottenInstruction(LEVEL2_INSTRUCTION, forgotten),
    body,
    {
      signal: input.signal,
      timeoutMs: deps.timeoutMs ?? SUMMARY_TIMEOUT_MS,
      onModelCall: deps.onModelCall,
    },
    range,
  );
  guardSummaryText(text, range);
  throwIfAborted(input.signal);
  await saveLevelSummary(db, input, { ...range, level: 2, sourceHash, text });
  return true;
};

// level 1 の未カバー範囲を選ぶ。最大の to_turn ではなく連続して覆えた末尾を
// 使い（途中の無効化で開いた穴を残さん）、穴の修復は次に有効な level 1 の
// 手前で止める（先の要約済み区間を取り込んで二重に作らん）。
const uncoveredLevel1Range = (
  active: StoredSummary[],
  boundary: number,
): { fromTurn: number; toTurn: number } | null => {
  const level1s = active.filter((s) => s.level === 1).sort((a, b) => a.fromTurn - b.fromTurn);
  const covered = level1s.reduce(
    (end, summary) => (summary.fromTurn <= end + 1 ? Math.max(end, summary.toTurn) : end),
    0,
  );
  const nextFrom = level1s.find((s) => s.fromTurn > covered)?.fromTurn;
  const toTurn = Math.min(boundary - 1, (nextFrom ?? Number.MAX_SAFE_INTEGER) - 1);
  return toTurn < covered + 1 ? null : { fromTurn: covered + 1, toTurn };
};

// FR-1: 窓の外の未要約が 20 件以上なら、先頭から 12,000 字の範囲を level 1 にする。
const rollLevel1 = async (
  db: V2Db,
  env: SummaryRunnerEnv,
  input: SummaryInput,
  deps: SummaryDeps,
  active: StoredSummary[],
): Promise<boolean> => {
  const budget = resolveContextBudget(contextBudgetFromEnv(env));
  const recent = await loadRecentActiveMessages(db, input.conversationId, budget.historyMessages);
  const boundary =
    buildConversationContext(recent, "", budget).oldestIncludedTurn ??
    (recent.at(-1)?.turn ?? 0) + 1;
  const uncovered = uncoveredLevel1Range(active, boundary);
  if (!uncovered) return false;
  // loadTurnRange は有効な行だけ返すので、眠らせた枝しか無い欠番の区間は
  // 行数が足りずここで止まる（要約済みの区間を毎回モデルへは投げん）。
  const range = await loadTurnRange(db, {
    conversationId: input.conversationId,
    fromTurn: uncovered.fromTurn,
    toTurn: uncovered.toTurn,
  });
  if (range.length < SUMMARY_TRIGGER_MESSAGES) return false;
  throwIfAborted(input.signal);
  const chunk = takeSummaryChunk(range);
  const rangeMeta = { summaryLevel: 1, fromTurn: chunk.fromTurn, toTurn: chunk.toTurn };
  // source_hash は切る前の本文で作る（FR-1: 切り詰めはモデルへの入力だけ）。
  const sourceHash = await summarySourceHash(chunk.rows);
  const characterName = (await loadCharacterName(db, input.characterId)) ?? "相手";
  const forgotten = await listForgottenContents(db, input.conversationId);
  const models = deps.models ?? (await resolveModels(env, input.userId));
  const text = await invokeSummaryChain(
    models,
    appendForgottenInstruction(LEVEL1_INSTRUCTION, forgotten),
    formatSummaryBody(chunk, characterName),
    {
      signal: input.signal,
      timeoutMs: deps.timeoutMs ?? SUMMARY_TIMEOUT_MS,
      onModelCall: deps.onModelCall,
    },
    rangeMeta,
  );
  guardSummaryText(text, rangeMeta);
  throwIfAborted(input.signal);
  await saveLevelSummary(db, input, { ...rangeMeta, level: 1, sourceHash, text });
  return true;
};

// 失敗を数え、3 回続いたら 1 時間止める（NFR-2）。要約の中断は数えん。
const recordFailure = async (storage: SummaryStorage | undefined, now: number): Promise<void> => {
  if (!storage) return;
  const failures = Number((await storage.get(SUMMARY_FAILURES_KEY)) ?? 0) + 1;
  await storage.put(SUMMARY_FAILURES_KEY, failures);
  if (failures >= SUMMARY_MAX_FAILURES) {
    await storage.put(SUMMARY_PAUSED_KEY, now + SUMMARY_PAUSE_MS);
  }
};

const isPaused = async (storage: SummaryStorage | undefined, now: number): Promise<boolean> =>
  storage !== undefined && Number((await storage.get(SUMMARY_PAUSED_KEY)) ?? 0) > now;

const abortedOutcome = (conversationId: string): SummaryOutcome => {
  logEvent({ event: "summary_aborted", level: "info", conversationId });
  return "aborted";
};

// 要約の失敗を数えて記録する。中断は失敗に数えず、ログの理由だけを外へ出す（NFR-4）。
const failedOutcome = async (
  error: unknown,
  input: SummaryInput,
  now: number,
): Promise<SummaryOutcome> => {
  if (error instanceof SummaryAbortError || input.signal?.aborted) {
    return abortedOutcome(input.conversationId);
  }
  // 失敗回数の記録自体が落ちても、失敗した事実のログは残す。ストレージ不調で
  // 係の失敗が闇に消えると追えん（例外本文は出さん・NFR-4）。
  try {
    await recordFailure(input.storage, now);
  } catch {
    logEvent({
      event: "summary_failure_count_failed",
      level: "warn",
      conversationId: input.conversationId,
    });
  }
  logEvent({
    event: "summary_failed",
    level: "error",
    conversationId: input.conversationId,
    reason: error instanceof SummaryFailure ? error.reason : describeError(error),
    ...(error instanceof SummaryFailure
      ? {
          summaryLevel: error.summaryLevel,
          fromTurn: error.fromTurn,
          toTurn: error.toTurn,
        }
      : {}),
  });
  return "failed";
};

// 走る前の番所: 休止中・既に止めの合図が立っとる時は本処理へ進まん。
const gateOutcome = async (input: SummaryInput, now: number): Promise<SummaryOutcome | null> => {
  if (await isPaused(input.storage, now)) return "paused";
  if (input.signal?.aborted) return abortedOutcome(input.conversationId);
  return null;
};

// 要約の本処理: まず hash の網を掛けてから level 1 → level 2 の順に試す。
const runSummaryOnce = async (
  db: V2Db,
  env: SummaryRunnerEnv,
  input: SummaryInput,
  deps: SummaryDeps,
): Promise<boolean> => {
  // 先に FR-8 の hash 確かめ（無効になった行はこの後の読込で外れる）。
  await verifySummaryHashes(db, input.conversationId, input.signal);
  let active = await listActiveSummaries(db, input.conversationId);
  const rolled = await rollLevel1(db, env, input, deps, active);
  if (rolled) active = await listActiveSummaries(db, input.conversationId);
  const merged = await maybeRollUpLevel2(db, env, input, deps, active);
  return rolled || merged;
};

// 成功したら失敗回数を 0 に戻す。
const savedOutcome = async (input: SummaryInput, saved: boolean): Promise<SummaryOutcome> => {
  if (input.storage) await input.storage.put(SUMMARY_FAILURES_KEY, 0);
  return saved ? "saved" : "idle";
};

// alarm から呼ばれる本処理。例外は外へ投げん
// （要約の失敗・中断はその返事の成否を変えん・UR-4）。
export const summarizeConversation = async (
  env: SummaryRunnerEnv,
  input: SummaryInput,
  deps: SummaryDeps = {},
): Promise<SummaryOutcome> => {
  const db = deps.db ?? (env.DB ? createDb(env.DB) : undefined);
  if (!db) return "idle";
  const now = (deps.now ?? (() => Date.now()))();
  try {
    const gate = await gateOutcome(input, now);
    if (gate !== null) return gate;
    const saved = await runSummaryOnce(db, env, input, deps);
    return await savedOutcome(input, saved);
  } catch (error) {
    try {
      return await failedOutcome(error, input, now);
    } catch {
      // 失敗の記録自体が落ちても、要約の失敗で返事の成否は変えん（UR-4）
      return "failed";
    }
  }
};
