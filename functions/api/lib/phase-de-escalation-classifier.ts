import { DEFAULT_CHAT_MODEL_FALLBACKS } from "../../../src/lib/model";

import {
  runClassifierWithFallbacks,
  stripCodeFence,
  truncate,
  type SubtextClassifierMessage,
} from "./subtext-escalation-classifier";

export type PhaseDeEscalationResult = {
  deEscalate: boolean;
  source: "llm" | "fallback";
  reason: string;
  latencyMs: number;
};

// escalation 側（subtext-escalation-classifier.ts）とは向きが逆で、独立した経路。
// あちらは conversation を昇格させるかを問い、失敗したら昇格させない側へ倒れる。
// こちらは erotic/climax を降格させるかを問い、失敗したらキーワード判定を「そのまま残す」側へ倒れる。
// 実エロターンを誤って降格させる方が、日常語を1ターン絶頂扱いするより実害が大きいため、
// タイムアウト・パース失敗・全モデル失敗は全部 deEscalate:false にする。
const FAIL_CLOSED: Omit<PhaseDeEscalationResult, "reason" | "latencyMs"> = {
  deEscalate: false,
  source: "fallback",
};

// 予備モデルは持たん。escalation 側は「見逃したら誘いに応えられん」ので粘る価値があるが、
// こちらは失敗＝キーワード判定のまま＝現状維持なので、粘っても得るものが無い。
const DE_ESCALATION_FALLBACK_MODEL_COUNT = 0;

// この問い直しは1文字目より前に挟まる。#946 の上限は「1文字目まで10秒」で、
// 1文字目そのものの上限が #951 のヘッジ経路で約6.9秒。残り予算は約3.1秒しかない。
//
// 既定の LLM_ROUTER_MODEL(qwen-2.5-72b) を実測すると、この問い直しは
// p50=2.3秒 / 30回中7回が4秒のタイムアウト到達で、残り予算に収まらん。
// 同じプロンプトで測り直した結果、gpt-4.1-nano が p50=0.8秒 / max=3.2秒、
// かつ判定精度も 48/48 正解(qwen は 9/12)で上回ったので、この経路だけ差し替える。
// 判定セットは日常語7件(降格が正解)+実絶頂表現5件(降格させんのが正解)で、
// 4周48件すべて正解・実エロターンの誤降格0件。
export const PHASE_DE_ESCALATION_ROUTER_MODEL = "openai/gpt-4.1-nano" as const;

// 上の実測 p90 が約1.5秒なので、2秒あれば通常は答えが返る。ここで打ち切られた分は
// FAIL_CLOSED でキーワード判定が残るだけなので、伸ばすより上限を確定させる方を取る。
export const PHASE_DE_ESCALATION_TIMEOUT_MS = 2000;

// 「問い直すべきターンか」の判定。曖昧語がフェーズを押し上げていないターン
// （ambiguousFallbackPhase が null）では問い直さん——LLM 呼び出しを1本増やすだけで
// 判定は変わらんため。
export const shouldAskPhaseDeEscalation = (input: {
  keywordPhase: string;
  ambiguousFallbackPhase: string | null;
}): boolean =>
  input.ambiguousFallbackPhase !== null &&
  (input.keywordPhase === "erotic" || input.keywordPhase === "climax");

// 通常のUIは毎ターン、クライアント側の detectScenePhase の結果をそのまま scenePhase として
// 送る（src/lib/api.ts）。その値がサーバの判定と一致し、かつ曖昧語1個で立っとるなら、
// それは「意図した固定」やのうて同じキーワード一致の写しでしかない。写しを固定として扱うと、
// 本番のリクエストが全部この問い直しを素通りする（2026-07-26 敵対レビュー）。
export const resolveClientScenePhaseOverride = <T extends string>(input: {
  clientScenePhase: T | undefined;
  keywordPhase: T;
  ambiguousFallbackPhase: T | null;
}): T | undefined => {
  // 「conversation」はクライアント側も detectScenePhase の写しとして送るだけで、
  // 意図的な現状維持指定とは区別できない。未指定と同じく無視し、
  // サーバ側のキーワード判定＋昇格チェックをそのまま適用する。
  if (input.clientScenePhase === "conversation") return undefined;
  // 曖昧語1個だけで keywordPhase と一致するクライアント値は、問い直しを素通りさせる
  // 固定値ではない。無視して昇格／降格判定を走らせる。
  if (input.clientScenePhase === input.keywordPhase && input.ambiguousFallbackPhase !== null)
    return undefined;
  return input.clientScenePhase;
};

// 降格が明示的に認められた時だけ落とす。decision が null（問い直してない）でも、
// deEscalate:false（実エロターンと判定された／呼び出しが失敗した）でも、
// キーワード判定をそのまま返す。
export const resolvePhaseAfterDeEscalation = <T extends string>(input: {
  keywordPhase: T;
  ambiguousFallbackPhase: T | null;
  decision: Pick<PhaseDeEscalationResult, "deEscalate"> | null;
}): T =>
  input.decision?.deEscalate && input.ambiguousFallbackPhase !== null
    ? input.ambiguousFallbackPhase
    : input.keywordPhase;

// 判定対象の曖昧語は文末に来ることが多いのに、頭から500字で切ると
// 長いロールプレイ描写の末尾にある「いっぱい出して」がモデルに届かず、
// 無関係な前半だけで降格を許してしまう（2026-07-26 敵対レビュー）。頭と末尾の両方を残す。
const HEAD_CHARS = 200;
const TAIL_CHARS = 400;

const truncateKeepingTail = (value: string): string =>
  value.length <= HEAD_CHARS + TAIL_CHARS
    ? value
    : `${value.slice(0, HEAD_CHARS)}...${value.slice(-TAIL_CHARS)}`;

export const buildPhaseDeEscalationPrompt = (input: {
  messages: SubtextClassifierMessage[];
  keywordPhase: string;
  fallbackPhase: string;
}): SubtextClassifierMessage[] => {
  const turns = input.messages.filter((message) => message.role !== "system").slice(-6);
  const latestIndex = turns.length - 1;
  const recentTurns = turns
    .map(
      (message, index) =>
        // 判定するのは最新ターン。それだけは末尾まで残し、文脈は先頭500字で足りる。
        `${message.role}: ${index === latestIndex ? truncateKeepingTail(message.content) : truncate(message.content, 500)}`,
    )
    .join("\n");

  return [
    {
      role: "system",
      content:
        "You judge turns in a Japanese roleplay chat. A keyword matcher classified the LATEST user " +
        `message as the "${input.keywordPhase}" phase, but it did so only because the message ` +
        "contains a short Japanese string that is ambiguous out of context. Ambiguous strings: " +
        "「いく」 also means 'to go' (e.g. 「コンビニいくわ」), 「出して」 also means " +
        "'take it out / put it out / cheer up' (e.g. 「元気出して」, 「思い出して」), 「果て」 also " +
        "appears in 「果てしない話」, and 「入れる／入れて／入れます」 also means " +
        "'to put in / pour in' (e.g. 「コーヒーを入れる」, 「お茶を入れます」) or 'to insert' sexually " +
        "(e.g. 「奥に入れる」). Decide whether the LATEST user message really is that phase in " +
        "this context, or whether it is ordinary everyday Japanese that merely happens to contain " +
        "those characters. Answer true ONLY when you are confident the latest message is ordinary " +
        "non-sexual speech. If the message reads as an actual erotic or climax utterance, or you are " +
        "unsure, answer false. Return compact JSON only: " +
        '{"ordinary_language":true|false,"reason":"short reason"}',
    },
    {
      role: "user",
      content: `keyword_phase: ${input.keywordPhase}\nphase_without_ambiguous_cue: ${input.fallbackPhase}\nrecent_turns:\n${recentTurns || "(none)"}`,
    },
  ];
};

// escalation 側の parse はテキストに "true" が含まれるだけで true へ倒すフォールバックを持つ。
// こちらは向きが逆なので、そのゆるさは「判定不能を降格へ倒す」ことになる。
// JSON として boolean が読めた時だけ降格を認め、それ以外は全部 false にする。
export const parsePhaseDeEscalationDecision = (
  text: string,
): { deEscalate: boolean; reason: string } => {
  try {
    const parsed = JSON.parse(stripCodeFence(text)) as {
      ordinary_language?: unknown;
      reason?: unknown;
    };
    if (typeof parsed.ordinary_language === "boolean") {
      return {
        deEscalate: parsed.ordinary_language,
        reason:
          typeof parsed.reason === "string" ? truncate(parsed.reason, 180) : "classifier_choice",
      };
    }
  } catch {
    // パースできんかったら降格させん。ここで文字列マッチへ落とすと、
    // モデルが日本語で理由だけ返した時に "true" の一致で実エロターンを降格させてしまう。
  }
  return { deEscalate: false, reason: "unparseable_decision" };
};

// キーワード一致が曖昧語1個で erotic/climax を出したターンだけを対象に、
// 本当にそのフェーズかを軽量モデルへ問い直す。escalation 経路とは排他で、
// 1ターンにどちらか一方しか走らせない（呼び出し側で分岐）。
export const classifyPhaseDeEscalation = async (input: {
  messages: SubtextClassifierMessage[];
  keywordPhase: string;
  fallbackPhase: string;
  apiKey: string;
  appOrigin: string;
  routerModel?: string;
  fallbackModels?: readonly string[];
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<PhaseDeEscalationResult> => {
  const {
    messages,
    keywordPhase,
    fallbackPhase,
    apiKey,
    appOrigin,
    routerModel = PHASE_DE_ESCALATION_ROUTER_MODEL,
    fallbackModels = DEFAULT_CHAT_MODEL_FALLBACKS.slice(0, DE_ESCALATION_FALLBACK_MODEL_COUNT),
    timeoutMs = PHASE_DE_ESCALATION_TIMEOUT_MS,
    fetchImpl = fetch,
  } = input;

  const run = await runClassifierWithFallbacks({
    promptMessages: buildPhaseDeEscalationPrompt({ messages, keywordPhase, fallbackPhase }),
    apiKey,
    appOrigin,
    routerModel,
    fallbackModels,
    timeoutMs,
    fetchImpl,
  });

  if (!run.ok) {
    return { ...FAIL_CLOSED, reason: run.reason, latencyMs: run.latencyMs };
  }

  const parsed = parsePhaseDeEscalationDecision(run.text);
  return {
    deEscalate: parsed.deEscalate,
    source: parsed.reason === "unparseable_decision" ? "fallback" : "llm",
    reason: parsed.reason,
    latencyMs: run.latencyMs,
  };
};
