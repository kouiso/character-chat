// 1ターン分の LangGraph StateGraph。
// intake → ledger_update → retrieve → compose → generate(stream) → chunk → judge_chunk
//   →(ng かつ この chunk 自身が未再生成 かつ ターンの再生成予算あり) regenerate_chunk → judge_chunk
//   →(ok または この chunk の再生成予算を使い切った または ターンの再生成予算を使い切った)
//     emit →(次chunkあり) judge_chunk /（なし）persist → END
// 再生成の可否は chunk ごとの attempts で判定する（ターングローバルな真偽値やと、
// ターン内で最初に落ちた chunk 以外は再生成されんまま通ってまう）。
import { AIMessage, HumanMessage, SystemMessage, type BaseMessage } from "@langchain/core/messages";
import {
  END,
  MemorySaver,
  START,
  StateGraph,
  type BaseCheckpointSaver,
} from "@langchain/langgraph";
import { extractVoice, judgeChunk, splitChunks } from "@v2/judge";
import {
  collectUsedPhrases,
  composeSystemPrompt,
  exemplarForPhase,
  targetCharsForPhase,
} from "@v2/prompt";

import { buildConversationContext, type ContextBudget } from "./context-budget";
import {
  packMemoryContext,
  MEMORY_CONTEXT_HEADER,
  packDocumentContext,
  DOCUMENT_CONTEXT_HEADER,
  type MemoryContextEntry,
} from "./memory-context";
import { hardRefusalDetect } from "./refusal-detect";
import { TurnState, type JudgedChunk } from "./state";

import type {
  CharacterSheet,
  ComposedPrompt,
  GenerationRecord,
  HistoryMessage,
  ModelAttempt,
  TurnEvent,
  TurnStore,
} from "./types";
import type {
  BaseChatModel,
  BaseChatModelCallOptions,
} from "@langchain/core/language_models/chat_models";
import type { AIMessageChunk } from "@langchain/core/messages";
import type { StoredSummary, SummaryStore } from "@v2/db";
import type { ScenePhase } from "@v2/prompt";

// chunk あたりの最大試行回数（初回1回 + 再生成1回）。
const MAX_ATTEMPTS_PER_CHUNK = 2;
// 1ターンで許す再生成の合計回数。病的な入力（chunk数が多く全部失敗する等）で
// 再生成が無限に積み重ならんための安全弁。
const MAX_REGENERATIONS_PER_TURN = 3;

// 1 ターンの締切。2026-09-04 v2 arm（CI 89426095）で Sakura t6 が 1 ターン 63 分
// （latencyMs 3,807,055・43,204 字）書き続け、CI の 90 分がそこで尽きた。呼ぶ側は TurnInput.timeoutMs で
// 上書きできる（bench/script-run はキャラ残り予算との小さい方を渡す）。
export const DEFAULT_TURN_TIMEOUT_MS = 120_000;

// max_tokens の下限・上限。段の目安字数 × 2.5 をこの帯に丸める。
const MIN_MAX_TOKENS = 400;
const MAX_MAX_TOKENS = 1400;
// 目安字数 → max_tokens の倍率。日本語はこの系のモデルで 1〜2 字 ≒ 1 トークンと見とる（実測やのうて
// 前提。タグと <inner> の分を含めて目安の 2.5 倍あれば目安どおりの本文が切れずに収まる想定）。
const TOKENS_PER_TARGET_CHAR = 2.5;

export const maxTokensForTarget = (targetChars: number): number =>
  Math.min(
    MAX_MAX_TOKENS,
    Math.max(MIN_MAX_TOKENS, Math.ceil(targetChars * TOKENS_PER_TARGET_CHAR)),
  );

// 受け取った生の字数（タグ込み）の上限。max_tokens をモデル側が無視した時の 2 段目の網。
export const streamedCharCap = (targetChars: number): number => 2 * targetChars + 400;

// 呼び出しごとに maxTokens を渡すため、BaseChatModel の CallOptions を ChatOpenRouter と同じ
// フィールド名で広げとく（model インスタンスはターンをまたいで共有されるので、コンストラクタで
// 固定せず .stream() / .invoke() のオプションで段ごとに変える）。
export type TurnModelCallOptions = BaseChatModelCallOptions & {
  maxTokens?: number;
  stop?: string[];
  temperature?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
};
export type TurnModel = BaseChatModel<TurnModelCallOptions>;

export type SamplingOptions = Pick<
  TurnModelCallOptions,
  "temperature" | "topP" | "frequencyPenalty" | "presencePenalty"
>;

// 段ごとの sampling。2026-09-04 v2 arm（CI 33882378303）は何も渡さず OpenRouter 既定
// （temperature 1.0・penalty 0）で回り、同じ commit の 2 run で 11 字の応答と「彼女の胸は、少し……
// 動いている」を 10 回並べる応答が同居した。旧経路（functions/api/lib/route-context.ts の
// penaltyByPhase）は 0.7 / 0.9 と段ごとの penalty で回っとって、この壊れ方は出とらん。同じ値に揃える。
const PENALTY_BY_PHASE: Record<ScenePhase, { frequency: number; presence: number }> = {
  conversation: { frequency: 0.45, presence: 0.35 },
  intimate: { frequency: 0.35, presence: 0.4 },
  erotic: { frequency: 0.25, presence: 0.58 },
  climax: { frequency: 0.25, presence: 0.62 },
  afterglow: { frequency: 0.25, presence: 0.45 },
};

// 出力契約は <response> 1 個。deepseek-v3.2（CI 33940603591）は閉じた後に 2 個目の <response> を
// 続けて書き、盲検読解で「入れ子の <response> 内にほぼ同文」（表2#4・#2）として全ターン落ちた。
// 閉じタグで生成を止める（stop は request の stop に載る。閉じタグ自体は届かんので splitChunks が
// 剥がす）。
export const RESPONSE_STOP: string[] = ["</response>"];

// 本文（<action> と <dialogue> の中身）がこの割合に届かんターンは、続きを 1 回だけ書かせて足す。
// 2026-09-05 CI 33942086314: 下限を出力契約に書いても deepseek-v3.2 は 87〜370 字で止まる（目安 220〜550）。
// 旧経路の too_short continuation と同じ役。回数は 1 回。足した分も同じ判定器を通る。
// ベンチが summary-*.json に実効値を記録するので export する（記録が無いと
// トランスクリプトがどの閾値で撃たれたか後から辿れん）。
export const EXTEND_BELOW_RATIO = 0.8;
const MAX_EXTENSIONS_PER_TURN = 1;

const VISIBLE_TAG_PATTERN = /<(action|dialogue)>([\S\s]*?)<\/\1>/g;

export const visibleCharsOf = (raw: string): number => {
  let total = 0;
  for (const match of raw.matchAll(VISIBLE_TAG_PATTERN))
    total += match[2].replace(/\s+/g, "").length;
  return total;
};

export const needsExtension = (
  state: {
    raw: string;
    extended: number;
    generation: GenerationRecord | null;
    ledger: { phase: ScenePhase };
  },
  belowRatio: number = EXTEND_BELOW_RATIO,
  mechanicsPhase: ScenePhase = state.ledger.phase,
  // RIT-205: チャットモードの長さ倍率。needsExtension だけは createTurnGraph の外からも
  // 呼べるよう、deps 経由ではなく引数で受ける。
  charScale: number = 1,
): boolean =>
  state.raw.length > 0 &&
  !state.generation?.truncated &&
  state.extended < MAX_EXTENSIONS_PER_TURN &&
  visibleCharsOf(state.raw) < targetCharsForPhase(mechanicsPhase) * charScale * belowRatio;

export const samplingForPhase = (phase: ScenePhase): SamplingOptions => ({
  temperature: 0.7,
  topP: 0.9,
  frequencyPenalty: PENALTY_BY_PHASE[phase].frequency,
  presencePenalty: PENALTY_BY_PHASE[phase].presence,
});

// 直前 6 ターン分の自分の本文を反復判定の比較対象に入れる。2026-09-04 v2 arm run 2 の Downer t9 は
// t5 の <action> を一字一句写して配られた。判定器はターン内の塊しか見とらんかった（chunk ノードが
// chunks を毎ターン空に戻す）。
const HISTORY_TURNS_FOR_REPETITION = 6;

const previousTurnChunks = (history: HistoryMessage[]): string[] =>
  history
    .filter((message) => message.role === "assistant")
    .slice(-HISTORY_TURNS_FOR_REPETITION)
    .flatMap((message) => splitChunks(message.content));

type TruncatedBy = NonNullable<GenerationRecord["truncated"]>;

// 出力契約と同じ形（<response> で包む）でキャラの声を 1 例示す。action/inner は形を示すだけの
// 定型に留め、気分や態度を書かん（prompt/instructions/no-injected-ai-filter.md: 消したら
// 振る舞いが変わる一文は入れん）。
const toLangchainMessages = (prompt: ComposedPrompt): BaseMessage[] => [
  new SystemMessage(prompt.system),
  ...prompt.messages.map((message) =>
    message.role === "user" ? new HumanMessage(message.content) : new AIMessage(message.content),
  ),
];

// OpenAI 系のモデルは content を文字列やのうて {type:"text", text} のブロック配列で返すことがある
// （2026-09-05 CI v2-arm gpt-5-mini: 20 ターン全部 visible=0 で、error も無し）。文字列のブロックだけ拾う。
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

// v2_generation.model に入れる名前。ChatOpenRouter は `model` フィールドにモデル ID を持つが
// BaseChatModel の型には無いので Reflect で読む。無いモデル（FakeListChatModel 等）は _llmType()。
const modelNameOf = (model: TurnModel): string => {
  const name = Reflect.get(model, "model");
  return typeof name === "string" && name.length > 0 ? name : model._llmType();
};

// RIT-102: 逃げ道チェーンの 1 候補。name は記録用（deps.models 未指定の単モデル経路は
// modelNameOf で埋める）。
export type ModelCandidate = { name: string; model: TurnModel };

// 拒否・AI 宣言などの断り文は冒頭に出るので、この字数まで溜めてから配信を始める。
// 先に流すと逃げ道へ切り替えた時に拒否文が本文へ残る。
const REFUSAL_SAFE_CHARS = 300;

// buffered writer が拒否を見つけた時に stream を中断して次候補へ進ませるための内部シグナル。
class RefusalSignal extends Error {
  constructor() {
    super("生成文の冒頭が拒否パターンに一致した");
    this.name = "RefusalSignal";
  }
}

// 締切で配信を始める前（溜め込みのまま）なら次の候補へ。配信済みの分は取り消せんので
// 従来どおり部分生成として採用する。
const classifyAttempt = (
  result: CappedStreamResult,
  caught: unknown,
  emitted: boolean,
): { kind: ModelAttempt["outcome"]; detail?: string } => {
  // 配信を始めた後は何が起きても取り消せんので、その試行を部分生成として採用する。
  // 逃げ道へ切り替えると配信済みの断片の後に別モデルの全文が続いて本文が壊れる。
  if (emitted)
    return {
      kind: "ok",
      detail: caught
        ? "配信後に例外が起きた"
        : result.truncated === "deadline"
          ? "配信後に締切を迎えた"
          : undefined,
    };
  if (caught instanceof RefusalSignal)
    return { kind: "refused", detail: "冒頭が拒否パターンに一致" };
  if (caught)
    return { kind: "error", detail: caught instanceof Error ? caught.message : String(caught) };
  if (result.truncated === "deadline")
    return { kind: "timeout", detail: "締切までに本文が揃わんかった" };
  if (result.error) return { kind: "error", detail: result.error };
  if (hardRefusalDetect(result.raw)) return { kind: "refused", detail: result.raw.slice(0, 80) };
  return { kind: "ok" };
};

// 逃げ道チェーンで採用されたモデル。ターン内の続き・書き直し・要約はこれへ投げる。
const modelForTurn = (
  deps: Pick<TurnGraphDeps, "model" | "models">,
  state: { activeModelIndex: number },
): TurnModel => deps.models?.[state.activeModelIndex]?.model ?? deps.model;

// usage は最後の chunk にだけ載ることが多いので、出てきた最後の値を採る。
const usageOf = (piece: AIMessageChunk): GenerationRecord["usage"] => {
  const usage = piece.usage_metadata;
  if (!usage) return null;
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    totalTokens: usage.total_tokens,
  };
};

export type TurnGraphDeps = {
  contextBudget?: Partial<ContextBudget>;
  retrieveMemories?: (conversationId: string, query: string) => Promise<MemoryContextEntry[]>;
  // RIT-115: キャラの設定資料の検索。記憶とは別口（キャラごと・会話を跨ぐ）。
  retrieveDocuments?: (query: string) => Promise<MemoryContextEntry[]>;
  model: TurnModel;
  // RIT-102: 拒否・時間切れ・5xx で順に試す逃げ道チェーン。未指定時は model 1 本だけ。
  models?: ModelCandidate[];
  store: TurnStore;
  // 本文がこの割合に届かんターンだけ続きを書かせる。0 で無効（短い fixture で判定器だけを試すテスト用）。
  extendBelowRatio?: number;
  // 段分離アーム（2026-09-05 敵対レビュー R2-1）用。指定すると目安字数・penalty・extend の発火・max_tokens
  // だけをこの段の値にして、お手本と段名（内容側）は台帳の段のまま残す。本番では未指定。
  mechanicsPhase?: ScenePhase;
  // A3 再仕様腕用。プロンプトの字数下限（N字以上）だけを外す。本番では未指定。
  dropMinChars?: boolean;
  // 相手の動作を書かない反応専用契約（bench 検証用）
  soloReaction?: boolean;
  // RIT-205: チャットモードの長さ倍率。目安字数・extend 発火・max_tokens・受信キャップに
  // 同じ倍率を掛ける。1 が既定（quality=1.5 / light=0.6 など）。
  charScale?: number;
  // RIT-203: 文体スタイル（balanced は未指定）。出力形式の地の文/台詞の配分だけ変える。
  style?: "prose" | "dialogue";
  // 巻き取り要約（RIT-72）。未注入では要約も注入も走らん。
  summaryStore?: SummaryStore;
  // thresholdMessages: 窓から押し出された未要約メッセージがこの件数で level 1 を起こす。
  // maxLevel1: 未集約の level 1 がこの件数で level 2 にまとめ直す。
  summary?: { thresholdMessages?: number; maxLevel1?: number };
  // 返事を実際に返した実行先（OpenRouter の provider）を生成 id から引く。
  // 実行先の記録は完了条件（RIT-100）なので本番では必ず注入する。失敗してもターンは潰さん
  // （その場合 provider は NULL で残り、照合クエリが未記録として拾える）。
  providerLookup?: (upstreamId: string) => Promise<string | null>;
  // /generation の索引は ~10s 遅れるので即時 lookup が外れた時に呼ぶ。呼び出し側は
  // waitUntil 等で数秒後に引き直し、行を UPDATE する。注入が無ければ未解決のまま残る。
  onProviderUnresolved?: (generationId: string, upstreamId: string) => void;
  checkpointer?: BaseCheckpointSaver;
  now?: () => number;
  id?: () => string;
};

type CappedStreamResult = {
  raw: string;
  usage: GenerationRecord["usage"];
  truncated?: TruncatedBy;
  error?: string;
  // OpenRouter 側の生成 id（gen-…）。実行先の照合に使う（RIT-100）。
  upstreamId?: string;
};

const upstreamIdOf = (piece: { id?: unknown }): string | undefined =>
  typeof piece.id === "string" && piece.id.startsWith("gen-") ? piece.id : undefined;

// 締切と字数上限は同じ controller で request を止める（実モデルでは fetch が閉じる）。
// どちらで止めたかは abort の前に truncated へ書いてから abort する。generate ノードから
// 切り出したのは、ノード本体の分岐を減らして読めるようにするため。
const collectCappedStream = async (
  model: TurnModel,
  lcMessages: BaseMessage[],
  opts: {
    maxTokens: number;
    charCap: number;
    timeoutMs: number;
    sampling: SamplingOptions;
    writer: (event: TurnEvent) => void;
  },
): Promise<CappedStreamResult> => {
  let raw = "";
  let usage: GenerationRecord["usage"] = null;
  let truncated: TruncatedBy | undefined;
  let error: string | undefined;
  let upstreamId: string | undefined;
  const controller = new AbortController();
  const deadline = setTimeout(() => {
    truncated = "deadline";
    controller.abort(new Error(`1 ターンの締切 ${opts.timeoutMs}ms を超えた`));
  }, opts.timeoutMs);
  try {
    const stream = await model.stream(lcMessages, {
      ...opts.sampling,
      maxTokens: opts.maxTokens,
      stop: RESPONSE_STOP,
      signal: controller.signal,
    });
    for await (const piece of stream) {
      usage = usageOf(piece) ?? usage;
      // OpenRouter の chunk.id は生成 id（gen-…）。後で実行先を引く鍵になる。
      upstreamId = upstreamIdOf(piece) ?? upstreamId;
      const text = contentToText(piece.content);
      if (text.length === 0) continue;
      raw += text;
      opts.writer({ type: "token", text });
      if (raw.length > opts.charCap) {
        truncated = "chars";
        controller.abort(new Error(`受け取った字数が上限 ${opts.charCap} を超えた`));
        break;
      }
    }
  } catch (caught) {
    // 自分で abort した以外の例外はそのまま上へ（ネットワーク・鍵の失敗など）。
    if (!controller.signal.aborted) throw caught;
    if (raw.length === 0) {
      error = caught instanceof Error ? caught.message : String(caught);
      opts.writer({ type: "error", message: error });
    }
  } finally {
    clearTimeout(deadline);
  }
  return { raw, usage, truncated, error, upstreamId };
};

// token だけを溜めて、拒否パターンなら RefusalSignal、安全域を越えたら配信を始める writer。
// flush は採用が決まった試行の残りを流す。
const refusalGuardedWriter = (
  writer: (event: TurnEvent) => void,
): {
  writer: (event: TurnEvent) => void;
  emitted: () => boolean;
  flush: () => void;
} => {
  let held = "";
  let emitted = false;
  return {
    emitted: () => emitted,
    flush: () => {
      if (held.length > 0) writer({ type: "token", text: held });
      held = "";
    },
    writer: (event) => {
      if (event.type !== "token") return;
      if (emitted) {
        writer(event);
        return;
      }
      held += event.text;
      // 20 字未満は文が揃う前の部分文字列なのでパターンを当てん
      // （短すぎる失速の判定は試行の最終結果にだけ効かせる）。
      if (held.length >= 20 && hardRefusalDetect(held)) throw new RefusalSignal();
      if (held.length >= REFUSAL_SAFE_CHARS) {
        writer({ type: "token", text: held });
        held = "";
        emitted = true;
      }
    },
  };
};

type CandidateOutcome = {
  raw: string;
  usage: GenerationRecord["usage"];
  truncated?: TruncatedBy;
  error?: string;
  winnerIndex: number;
  winnerUpstreamId?: string;
  attempts: ModelAttempt[];
};

// 拒否・時間切れ・障害で順に試す。採用できた時点で打ち切り、切り替え理由は attempts へ残る。
const runModelCandidates = async (
  candidates: ModelCandidate[],
  lcMessages: BaseMessage[],
  opts: {
    maxTokens: number;
    charCap: number;
    timeoutMs: number;
    sampling: SamplingOptions;
    writer: (event: TurnEvent) => void;
  },
): Promise<CandidateOutcome> => {
  const attempts: ModelAttempt[] = [];
  const failed: CandidateOutcome = {
    raw: "",
    usage: null,
    winnerIndex: -1,
    attempts,
  };
  for (const [index, candidate] of candidates.entries()) {
    const guard = refusalGuardedWriter(opts.writer);
    let result: CappedStreamResult;
    let caught: unknown;
    try {
      result = await collectCappedStream(candidate.model, lcMessages, {
        maxTokens: opts.maxTokens,
        charCap: opts.charCap,
        timeoutMs: opts.timeoutMs,
        sampling: opts.sampling,
        writer: guard.writer,
      });
    } catch (thrown) {
      caught = thrown;
      result = { raw: "", usage: null };
    }
    const outcome = classifyAttempt(result, caught, guard.emitted());
    attempts.push({
      model: candidate.name,
      outcome: outcome.kind,
      ...(outcome.detail ? { detail: outcome.detail } : {}),
    });
    // 時間切れが最後の候補で起きた時は、従来どおり部分生成をそのまま採用する
    // （拒否・例外は最後でも本文へ載せんので全滅扱い）。
    if (outcome.kind !== "ok" && !(outcome.kind === "timeout" && index === candidates.length - 1))
      continue;
    // 採用。溜まっとる分があれば流してから本文を確定する。
    guard.flush();
    // collectCappedStream の error イベントは guard に吸われとるので、
    // 採用した試行の分だけここで流し直す（締切0出力など失敗の案内が欠けんよう）。
    if (result.error) opts.writer({ type: "error", message: result.error });
    return {
      raw: result.raw,
      usage: result.usage,
      truncated: result.truncated,
      error: result.error,
      winnerIndex: index,
      winnerUpstreamId: result.upstreamId,
      attempts,
    };
  }
  return failed;
};

// 試行の結果から保存用の生成レコードを組み立てる。全滅時は error イベントをここで流す。
const settleGeneration = async (
  deps: Pick<TurnGraphDeps, "providerLookup" | "onProviderUnresolved">,
  args: {
    generationId: string;
    prompt: ComposedPrompt;
    candidates: ModelCandidate[];
    outcome: CandidateOutcome;
    timeoutMs: number;
    latencyMs: number;
    emitError: (message: string) => void;
  },
): Promise<GenerationRecord> => {
  const { outcome } = args;
  let error = outcome.error;
  if (outcome.winnerIndex < 0) {
    error = `全モデルで生成に失敗した: ${outcome.attempts.map((a) => `${a.model}=${a.outcome}`).join(" → ")}`;
    args.emitError(error);
  }
  // 実行先の引き取りに失敗しても返事は残す。"unknown" で残った行は照合クエリで洗える。
  // 未解決の時だけ onProviderUnresolved へ渡して遅延の引き直しに繋ぐ（RIT-100 の振る舞いを
  // 複数候補の採用試行へも引き継ぐ）。
  let provider: string | null = null;
  if (outcome.winnerUpstreamId) {
    const resolved =
      (await deps.providerLookup?.(outcome.winnerUpstreamId).catch(() => null)) ?? null;
    if (!resolved) deps.onProviderUnresolved?.(args.generationId, outcome.winnerUpstreamId);
    provider = resolved ?? "unknown";
  }
  return {
    generationId: args.generationId,
    model: args.candidates[Math.max(0, outcome.winnerIndex)].name,
    provider,
    upstreamId: outcome.winnerUpstreamId ?? null,
    promptVersion: args.prompt.version,
    systemPrompt: args.prompt.system,
    request: args.prompt.messages,
    rawOutput: outcome.raw,
    usage: outcome.usage,
    latencyMs: args.latencyMs,
    status: outcome.winnerIndex < 0 ? "error" : outcome.truncated ? "aborted" : "ok",
    ...(error ? { error } : {}),
    ...(outcome.truncated ? { truncated: outcome.truncated } : {}),
    attempts: outcome.attempts,
    timeoutMs: args.timeoutMs,
  };
};

const SUMMARY_DEFAULTS = { thresholdMessages: 20, maxLevel1: 4 } as const;

// 作り話防止が本質の指示（壊しにいく確かめ: 要約に無い作り話が混ざらんか）。
const SUMMARIZE_LEVEL1_INSTRUCTION =
  "これはキャラクターチャットの会話の一部。後のターンで参照するため、起きた出来事・約束・感情の変化・大事な設定を失わんよう簡潔に要約せよ。書かれとらん事実や推測は足すな。";
const SUMMARIZE_LEVEL2_INSTRUCTION =
  "これは会話の部分要約の集まり。全体の流れが分かる一段上の要約にまとめ直せ。書かれとらん事実や推測は足すな。";

// 画面側へ戻す要約の選び方: 最新の level 2 と、それが届いとらん範囲の level 1 を時系列で。
export const visibleSummaries = (list: StoredSummary[]): StoredSummary[] => {
  const level2Covered = Math.max(0, ...list.filter((s) => s.level === 2).map((s) => s.coveredTo));
  const latest2 = list.filter((s) => s.level === 2 && s.coveredTo === level2Covered).at(-1);
  const tail = list.filter((s) => s.level === 1 && s.coveredTo > level2Covered);
  return [...(latest2 ? [latest2] : []), ...tail];
};

const invokeForSummary = async (
  model: TurnModel,
  instruction: string,
  body: string,
  state: { timeoutMs?: number | null },
): Promise<string> => {
  const controller = new AbortController();
  const deadline = setTimeout(
    () =>
      controller.abort(
        new Error(`要約の締切 ${state.timeoutMs ?? DEFAULT_TURN_TIMEOUT_MS}ms を超えた`),
      ),
    state.timeoutMs ?? DEFAULT_TURN_TIMEOUT_MS,
  );
  try {
    const result = await model.invoke([new HumanMessage(`${instruction}\n\n${body}`)], {
      signal: controller.signal,
    });
    return contentToText(result.content).trim();
  } finally {
    clearTimeout(deadline);
  }
};

// 未集約の level 1 が閾値に届いたら「前の level 2 + 新しい level 1」でまとめ直す。
// 新しい分だけを畳むと古い出来事が最新の level 2 から落ちて、巻き取りの意味が無くなる。
const rollUpLevel2 = async (
  deps: Pick<TurnGraphDeps, "model" | "models">,
  summaries: StoredSummary[],
  maxLevel1: number,
  state: { timeoutMs?: number | null; activeModelIndex: number },
): Promise<string> => {
  const level2Covered = Math.max(
    0,
    ...summaries.filter((entry) => entry.level === 2).map((entry) => entry.coveredTo),
  );
  const uncovered = summaries.filter(
    (entry) => entry.level === 1 && entry.coveredTo > level2Covered,
  );
  if (uncovered.length < maxLevel1) return "";
  const previous2 = summaries.filter((entry) => entry.level === 2).at(-1);
  return invokeForSummary(
    modelForTurn(deps, state),
    SUMMARIZE_LEVEL2_INSTRUCTION,
    [...(previous2 ? [previous2.text] : []), ...uncovered.map((entry) => entry.text)].join("\n"),
    state,
  );
};

const regenerateWithDeadline = async (
  model: TurnModel,
  lcMessages: BaseMessage[],
  opts: { maxTokens: number; timeoutMs: number; sampling: SamplingOptions },
): Promise<string> => {
  const controller = new AbortController();
  const deadline = setTimeout(
    () => controller.abort(new Error(`書き直しの締切 ${opts.timeoutMs}ms を超えた`)),
    opts.timeoutMs,
  );
  try {
    // stop は載せん。書き直しと続きは <response> で包まん塊を返す約束なので要らんし、
    // FakeListChatModel は stop を渡すと stop 文字列そのものを返す（テストが全部それに引っかかる）。
    const result = await model.invoke(lcMessages, {
      ...opts.sampling,
      maxTokens: opts.maxTokens,
      signal: controller.signal,
    });
    return contentToText(result.content);
  } catch (caught) {
    // 自分で切った締切だけ空文に写す。それ以外（鍵・ネットワーク）はそのまま上へ。
    if (!controller.signal.aborted) throw caught;
    return "";
  } finally {
    clearTimeout(deadline);
  }
};

export const createTurnGraph = (deps: TurnGraphDeps) => {
  const id = deps.id ?? (() => crypto.randomUUID());
  const now = deps.now ?? (() => Date.now());
  const modelName = modelNameOf(deps.model);
  // RIT-205: 目安字数へモード倍率を掛ける。下限 200 字（それ未満はXML枠の下書きにすら足りん）。
  const scaledTargetChars = (phase: ScenePhase): number =>
    Math.max(200, Math.round(targetCharsForPhase(phase) * (deps.charScale ?? 1)));
  const mechanics = (state: { ledger: { phase: ScenePhase } }): ScenePhase =>
    deps.mechanicsPhase ?? state.ledger.phase;

  return (
    new StateGraph(TurnState)
      .addNode("intake", async (state) => {
        const loaded = await deps.store.load(state.conversationId);
        return { history: loaded.history, ledger: loaded.ledger, turn: loaded.turn };
      })
      .addNode("ledger_update", (state) => {
        const label = state.userText.slice(0, 60);
        const lastEvents = [...state.ledger.lastEvents, label].slice(-5);
        const phase = state.phase ?? state.ledger.phase;
        return { ledger: { ...state.ledger, lastEvents, phase } };
      })
      .addNode("retrieve", async (state) => ({
        retrieved: packMemoryContext(
          (await deps.retrieveMemories?.(state.conversationId, state.userText)) ?? [],
        ),
        retrievedDocuments: packDocumentContext(
          (await deps.retrieveDocuments?.(state.userText)) ?? [],
        ),
      }))
      .addNode("compose", async (state) => {
        const voice = extractVoice(state.character.systemPrompt);
        const system = composeSystemPrompt({
          sheet: state.character.systemPrompt,
          name: state.character.name,
          ledger: state.ledger,
          phase: state.ledger.phase,
          targetChars: scaledTargetChars(mechanics(state)),
          exemplar: exemplarForPhase(state.ledger.phase),
          // 直前 6 ターンで使った言い回しを名指しして、語の使い回しを生成の前に止める。
          usedPhrases: collectUsedPhrases(
            state.history
              .filter((message) => message.role === "assistant")
              .slice(-HISTORY_TURNS_FOR_REPETITION)
              .map((message) => message.content),
          ),
          voice: { endings: voice.endings, tics: voice.tics },
          dropMinChars: deps.dropMinChars,
          style: deps.style,
          soloReaction: deps.soloReaction,
        });
        const { messages, omittedMessages } = buildConversationContext(
          state.history,
          state.userText,
          deps.contextBudget,
        );
        // 窓の外に出た分は要約が代わりに乗る（RIT-72）。
        const summaries = deps.summaryStore
          ? visibleSummaries(await deps.summaryStore.list(state.conversationId))
          : [];
        const prompt: ComposedPrompt = {
          version: "v0002",
          system,
          messages: [
            ...(summaries.length > 0
              ? [
                  {
                    role: "user" as const,
                    content: `これまでのあらすじ:\n${summaries.map((entry) => entry.text).join("\n")}`,
                  },
                ]
              : []),
            ...(deps.retrieveMemories
              ? [
                  {
                    role: "user" as const,
                    content:
                      MEMORY_CONTEXT_HEADER +
                      (state.retrieved.join("\n") || "該当する記憶はありません。"),
                  },
                ]
              : []),
            // 設定資料は記憶の後ろ。資料が無い時はメッセージ自体を出さん（空約束を書かん）。
            ...(deps.retrieveDocuments && state.retrievedDocuments.length > 0
              ? [
                  {
                    role: "user" as const,
                    content: DOCUMENT_CONTEXT_HEADER + state.retrievedDocuments.join("\n"),
                  },
                ]
              : []),
            ...messages,
          ],
        };
        return { prompt, omittedHistoryMessages: omittedMessages };
      })
      .addNode("generate", async (state, runtime) => {
        if (!state.prompt) throw new Error("prompt が未生成のまま generate に到達した");
        const generationId = id();
        const lcMessages = toLangchainMessages(state.prompt);
        const targetChars = scaledTargetChars(mechanics(state));
        const maxTokens = maxTokensForTarget(targetChars);
        const charCap = streamedCharCap(targetChars);
        const timeoutMs = state.timeoutMs ?? DEFAULT_TURN_TIMEOUT_MS;
        const sampling = samplingForPhase(mechanics(state));
        // RIT-102: 拒否・時間切れ・障害で順に試す。切り替えた理由は attempts へ残る。
        const candidates: ModelCandidate[] = deps.models ?? [
          { name: modelName, model: deps.model },
        ];
        const startedAt = now();
        const outcome = await runModelCandidates(candidates, lcMessages, {
          maxTokens,
          charCap,
          timeoutMs,
          sampling,
          writer: (event) => runtime.writer(event),
        });
        const generation = await settleGeneration(deps, {
          generationId,
          prompt: state.prompt,
          candidates,
          outcome,
          timeoutMs,
          latencyMs: now() - startedAt,
          emitError: (message) => runtime.writer({ type: "error", message }),
        });
        // preExtendVisibleChars / preExtendRawLength は extend が raw を上書きする前の
        // 初回生成の寸法。発火の有無に関わらず毎ターンここで入れる（発火ターンだけ入れると
        // 「非発火」の対照セルが空になる = v15 の空セルバグの一層下）。
        return {
          raw: outcome.raw,
          generationId,
          generation,
          activeModelIndex: Math.max(0, outcome.winnerIndex),
          extended: 0,
          preExtendVisibleChars: visibleCharsOf(outcome.raw),
          preExtendRawLength: outcome.raw.length,
        };
      })
      .addNode("extend", async (state) => {
        if (!state.prompt) throw new Error("prompt が未生成のまま extend に到達した");
        const targetChars = scaledTargetChars(mechanics(state));
        const instruction = [
          "ここまでの本文:",
          state.raw,
          "",
          `本文が ${targetChars} 字に足りん（今 ${visibleCharsOf(state.raw)} 字）。この続きとして、同じ場面を一段先へ進める <action> と <dialogue> を書き足す。ここまでの表現・出来事・台詞を繰り返さん。<response> で包まず、タグの塊だけを書く。`,
        ].join("\n");
        const lcMessages = [...toLangchainMessages(state.prompt), new HumanMessage(instruction)];
        const startedAt = now();
        const extension = await regenerateWithDeadline(modelForTurn(deps, state), lcMessages, {
          maxTokens: maxTokensForTarget(targetChars),
          timeoutMs: state.timeoutMs ?? DEFAULT_TURN_TIMEOUT_MS,
          sampling: samplingForPhase(mechanics(state)),
        });
        const raw = extension.trim().length > 0 ? `${state.raw}\n${extension.trim()}` : state.raw;
        // 続きも同じ生成の一部として v2_generation に残す（latency は 2 回分の合計）。
        const generation = state.generation
          ? {
              ...state.generation,
              rawOutput: raw,
              latencyMs: state.generation.latencyMs + (now() - startedAt),
            }
          : state.generation;
        return { raw, generation, extended: state.extended + 1 };
      })
      .addNode("chunk", (state) => {
        const pendingChunks = splitChunks(state.raw);
        // extend は raw へ追記するだけなので、extend 前の塊は必ず seq 順の接頭辞になる。
        // 各塊の raw 内での開始位置を順に辿って preExtendRawLength と比べる。
        // splitChunks はタグブロックの切り出しと trim をするので、塊本文は raw の
        // 部分文字列として見つかる。見つからんかった場合は境目を取り違えるより
        // extend 側（false）へ倒す。
        let searchFrom = 0;
        const pendingPreExtend = pendingChunks.map((text) => {
          const at = state.raw.indexOf(text, searchFrom);
          if (at === -1) return false;
          searchFrom = at + text.length;
          return at < state.preExtendRawLength;
        });
        // 穴あき配列を避けるため全 index を 1 で初期化しとく（regenerate_chunk が該当 index だけ 2 に上書き）。
        // chunks / regenerationCount も毎ターン空に戻す。checkpointer 付きで同じ thread_id を使うと
        // 前ターンの channel 値が残るので、リセットせんと前ターンの chunk が混ざり、
        // 再生成予算（1ターン MAX_REGENERATIONS_PER_TURN 回）が 2 ターン目以降ずっと使い切りになる。
        return {
          pendingChunks,
          pendingPreExtend,
          cursor: 0,
          attempts: pendingChunks.map(() => 1),
          dropped: [],
          chunks: [],
          regenerationCount: 0,
        };
      })
      .addNode("judge_chunk", (state) => {
        const text = state.pendingChunks[state.cursor];
        const previousChunks = [
          // お手本はモデルが丸写しする（2026-09-04 v2 arm、絶頂ターンが EXEMPLAR_CLIMAX を逐語再現）。
          // 直前の塊と同じ扱いで比較対象に入れて、写したら反復として落とす。
          ...splitChunks(exemplarForPhase(state.ledger.phase)),
          ...previousTurnChunks(state.history),
          ...state.chunks.slice(-20).map((chunkItem) => chunkItem.text),
        ];
        const judge = judgeChunk(text, {
          previousChunks,
          voice: extractVoice(state.character.systemPrompt),
          selfName: state.character.name,
          userText: state.userText,
        });
        const attempt = state.attempts[state.cursor] ?? 1;
        const chunks = [...state.chunks];
        const judged: JudgedChunk = {
          seq: state.cursor,
          text,
          judge,
          attempt,
          preExtend: state.pendingPreExtend[state.cursor] ?? false,
        };
        chunks[state.cursor] = judged;
        return { chunks };
      })
      .addNode("regenerate_chunk", async (state) => {
        if (!state.prompt) throw new Error("prompt が未生成のまま regenerate_chunk に到達した");
        const before = state.pendingChunks.slice(0, state.cursor).join("\n\n");
        // 落ちた理由の句を名指しする。同じ入力で書き直させると同じ写しが出る（旧経路の実測 F11）。
        const judged = state.chunks[state.cursor]?.judge;
        const matched = [
          ...(judged?.checks.ngram.matchedPhrases ?? []),
          ...(judged?.checks.nearDuplicate.matches.map((match) => match.sentence) ?? []),
        ];
        // 「別の言い方で同じ場面を進め」は場面を進めず同じ動作を言い換える塊を産む
        // （2026-09-15 実測: regen≥1 ターンだけに intra-turn 反復ループが出た）。
        // 落ちた句を名指しした上で、言い換え自体を禁じて新しい出来事を一つ書かせる。
        const phraseLine =
          matched.length > 0
            ? `次の句は前の段落や例示と同じ言い回しになっとる: ${matched.map((phrase) => `「${phrase}」`).join("")}。この句は使わん。前の段落の動作や感覚を言い換えるのも禁止。その場面でまだ書いとらん新しい出来事か動作を一つだけ書け。`
            : "前の段落と同じ動作を言い換えん。その場面でまだ書いとらん新しい出来事か動作を一つだけ書け。";
        const instruction = [
          "ここまでの本文:",
          before,
          "",
          `次の段落だけ書き直す。${phraseLine}`,
        ].join("\n");
        const lcMessages = [...toLangchainMessages(state.prompt), new HumanMessage(instruction)];
        // 1 段落の書き直しにもターンと同じ max_tokens と締切を掛ける（invoke は stream と違って受信字数の
        // 網が無い。2026-09-04 v2 arm run 2 の Sakura t9 は締切 120 s のターンが 149 s かかった＝書き直しが
        // 締切の外で待っとった）。締切で切れた書き直しは空文として judge に渡し、empty で落として配らん。
        const text = await regenerateWithDeadline(modelForTurn(deps, state), lcMessages, {
          maxTokens: maxTokensForTarget(scaledTargetChars(mechanics(state))),
          timeoutMs: state.timeoutMs ?? DEFAULT_TURN_TIMEOUT_MS,
          sampling: samplingForPhase(mechanics(state)),
        });
        const pendingChunks = [...state.pendingChunks];
        pendingChunks[state.cursor] = text;
        const attempts = [...state.attempts];
        attempts[state.cursor] = (attempts[state.cursor] ?? 1) + 1;
        return { pendingChunks, attempts, regenerationCount: state.regenerationCount + 1 };
      })
      .addNode("emit", (state, runtime) => {
        const current = state.chunks[state.cursor];
        // 書き直しても落ちた塊は配らん。写しを配るより欠けたほうがマシ（判定器の設計要件 3）。
        if (!current.judge.ok) {
          runtime.writer({
            type: "dropped",
            seq: current.seq,
            reasons: current.judge.reasons,
            attempt: current.attempt,
          } satisfies TurnEvent);
          return { cursor: state.cursor + 1, dropped: [...state.dropped, current] };
        }
        runtime.writer({
          type: "chunk",
          seq: current.seq,
          text: current.text,
          judge: current.judge,
          attempt: current.attempt,
          preExtend: current.preExtend,
        } satisfies TurnEvent);
        return { cursor: state.cursor + 1 };
      })
      .addNode("persist", async (state, runtime) => {
        // 保存用の events は generation を先頭に置く（v2_message.generation_id が v2_generation を
        // 参照するので、store が先に generation 行を作れる順にしとく）。SSE には generation を流さん。
        const accepted = state.chunks.filter((chunkItem) => chunkItem.judge.ok);
        // 配れる本文が空のターンは、理由を問わず失敗として知らせる。store はこの形の保存を
        // 未保存扱いにして履歴から外すので、成功で終えると送信文が画面から黙って消える。
        // 締切で 1 字も来んかった時は generate が既に error を流しとるので重ねん。
        const blank = accepted.every((chunkItem) => chunkItem.text.trim() === "");
        if (blank && !state.generation?.error) {
          runtime.writer({
            type: "error",
            message:
              state.chunks.length > 0
                ? "全塊が判定で落ちた（配れる本文が無い）"
                : "モデルの返事が空のまま終わった（配れる本文が無い）",
          } satisfies TurnEvent);
        }
        const events: TurnEvent[] = [
          ...(state.generation ? [{ type: "generation" as const, ...state.generation }] : []),
          ...accepted.map((chunkItem): TurnEvent => ({
            type: "chunk",
            seq: chunkItem.seq,
            text: chunkItem.text,
            judge: chunkItem.judge,
            attempt: chunkItem.attempt,
            preExtend: chunkItem.preExtend,
          })),
          // 配らんかった塊も理由つきで D1 に残す（RIT-70）。SSE に出す dropped とは別で、
          // 保存用は本文と判定結果を持つ。
          ...state.dropped.map((chunkItem): TurnEvent => ({
            type: "dropped",
            seq: chunkItem.seq,
            reasons: chunkItem.judge.reasons,
            attempt: chunkItem.attempt,
            text: chunkItem.text,
            judge: chunkItem.judge,
          })),
        ];
        const saved = await deps.store.saveTurn({
          conversationId: state.conversationId,
          turn: state.turn,
          userText: state.userText,
          events,
          ledger: state.ledger,
        });
        if (state.generation) {
          runtime.writer({
            type: "turn-meta",
            extended: state.extended,
            truncated: state.generation.truncated ?? null,
            model: state.generation.model,
            latencyMs: state.generation.latencyMs,
            mechanicsPhase: mechanics(state),
            preExtendVisibleChars: state.preExtendVisibleChars,
            omittedHistoryMessages: state.omittedHistoryMessages,
          } satisfies TurnEvent);
        }
        runtime.writer({
          type: "done",
          conversationId: state.conversationId,
          turn: state.turn,
          generationId: state.generationId,
          sendAt: saved.chunkSendAt,
        } satisfies TurnEvent);
        return {};
      })
      .addNode("summarize", async (state) => {
        // 窓から押し出された未要約分がたまったら level 1、level 1 がたまったら level 2 へ
        // まとめ直す（RIT-72）。保存の後に走るので、失敗・再実行で二度呼ばれても
        // coveredTo が進んでおれば追加入らず（冪等）。
        if (!deps.summaryStore) return {};
        const threshold = deps.summary?.thresholdMessages ?? SUMMARY_DEFAULTS.thresholdMessages;
        const maxLevel1 = deps.summary?.maxLevel1 ?? SUMMARY_DEFAULTS.maxLevel1;
        const omittedCount = state.omittedHistoryMessages;
        const existing = await deps.summaryStore.list(state.conversationId);
        const covered = Math.max(0, ...existing.map((entry) => entry.coveredTo));
        const baseline = Math.min(covered, omittedCount);
        if (omittedCount - baseline < threshold) return {};
        const slice = state.history.slice(baseline, omittedCount);
        if (slice.length === 0) return {};
        const body = slice
          .map(
            (message) =>
              `${message.role === "user" ? "相手" : state.character.name}: ${message.content}`,
          )
          .join("\n");
        const level1 = await invokeForSummary(
          modelForTurn(deps, state),
          SUMMARIZE_LEVEL1_INSTRUCTION,
          body,
          state,
        );
        if (level1.length === 0) return {};
        await deps.summaryStore.save({
          conversationId: state.conversationId,
          level: 1,
          coveredTo: omittedCount,
          text: level1,
        });
        const after = await deps.summaryStore.list(state.conversationId);
        const level2Text = await rollUpLevel2(deps, after, maxLevel1, state);
        if (level2Text.length === 0) return {};
        const level2Covered = Math.max(
          0,
          ...after.filter((entry) => entry.level === 2).map((entry) => entry.coveredTo),
        );
        const uncovered = after.filter(
          (entry) => entry.level === 1 && entry.coveredTo > level2Covered,
        );
        await deps.summaryStore.save({
          conversationId: state.conversationId,
          level: 2,
          coveredTo: uncovered[uncovered.length - 1].coveredTo,
          text: level2Text,
        });
        return {};
      })
      .addEdge(START, "intake")
      .addEdge("intake", "ledger_update")
      .addEdge("ledger_update", "retrieve")
      .addEdge("retrieve", "compose")
      .addEdge("compose", "generate")
      .addConditionalEdges("generate", (state) =>
        needsExtension(state, deps.extendBelowRatio, mechanics(state), deps.charScale ?? 1)
          ? "extend"
          : "chunk",
      )
      .addEdge("extend", "chunk")
      // 締切までに 1 字も来んかった時は chunk が無い。judge_chunk へ行くと undefined を判定して落ちるので
      // 保存だけして終える（error イベントは generate が流しとる）。
      .addConditionalEdges("chunk", (state) =>
        state.pendingChunks.length > 0 ? "judge_chunk" : "persist",
      )
      .addConditionalEdges("judge_chunk", (state) => {
        const judge = state.chunks[state.cursor]?.judge;
        const attempt = state.attempts[state.cursor] ?? 1;
        // chunk 単位: この chunk 自身が上限まで再生成済みか。
        const chunkBudgetExhausted = attempt >= MAX_ATTEMPTS_PER_CHUNK;
        // ターン単位: 病的な入力で再生成が積み重ならんための安全弁。
        const turnBudgetExhausted = state.regenerationCount >= MAX_REGENERATIONS_PER_TURN;
        // 締切で切ったターンはもうモデルを呼ばん（途中で切れたタグは format で落ちるが、
        // 書き直しに締切の外でさらに待つと締切の意味が無い）。
        const overDeadline = state.generation?.truncated === "deadline";
        return judge?.ok || chunkBudgetExhausted || turnBudgetExhausted || overDeadline
          ? "emit"
          : "regenerate_chunk";
      })
      .addEdge("regenerate_chunk", "judge_chunk")
      .addConditionalEdges("emit", (state) =>
        state.cursor < state.pendingChunks.length ? "judge_chunk" : "persist",
      )
      .addEdge("persist", "summarize")
      .addEdge("summarize", END)
      .compile({ checkpointer: deps.checkpointer ?? new MemorySaver() })
  );
};

export type TurnGraph = ReturnType<typeof createTurnGraph>;

export type TurnInput = {
  conversationId: string;
  userText: string;
  character: CharacterSheet;
  phase?: ScenePhase;
  // 1 ターンの締切（ms）。省略時は DEFAULT_TURN_TIMEOUT_MS。
  timeoutMs?: number;
};

const isTurnEvent = (value: unknown): value is TurnEvent =>
  typeof value === "object" && value !== null && typeof Reflect.get(value, "type") === "string";

// 1 ターンを custom stream として流す。thread_id は conversationId と同じにして
// checkpointer 上で会話ごとに状態を分ける。
export async function* runTurn(
  graph: TurnGraph,
  input: TurnInput,
  threadId: string,
): AsyncGenerator<TurnEvent> {
  // chunk → judge → emit を塊ごとに回すので、1 ターンのステップ数は塊数に比例する。
  // 既定の 25 では 8 塊前後で「Recursion limit reached」になり、長い本文ほど落ちる
  // （2026-09-04 v2 初回実測、鈴 t3）。
  const stream = await graph.stream(input, {
    streamMode: "custom",
    recursionLimit: 400,
    configurable: { thread_id: threadId },
  });
  for await (const event of stream) {
    if (isTurnEvent(event)) yield event;
  }
}
