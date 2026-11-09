// 本番用チャットモデルの生成。テストは FakeListChatModel 等を deps.model に直接注入する
// （このファイルを経由しない）。
import { ChatOpenRouter } from "@langchain/openrouter";

import type { ModelCandidate } from "./graph";
import type { TurnModel } from "./graph";

export type ModelEnv = {
  OPENROUTER_API_KEY?: string;
  V2_MODEL?: string;
  // Cloudflare AI Gateway 経由にする時の baseURL（例: https://gateway.ai.cloudflare.com/v1/<acct>/<gw>/openrouter）。
  // 未設定は OpenRouter 直。実行先をコードの外で切り替えられるよう env で受ける（RIT-100）。
  V2_OPENROUTER_BASE_URL?: string;
  // RIT-102/104: 逃げ道チェーンを JSON で上書きする。
  // [{"model":"...","providerOnly":["Venice"]}] の形。未指定なら既定の 3 本。
  V2_MODEL_CHAIN?: string;
};

// DeepSeek 本家は規約で成人向けを禁じとるので実行先から外す（局長裁定: OpenRouter 経由のみ・
// 本家を使わん）。data_collection は deny でプロバイダ側の学習利用も断る。
// このポリシーを消すと DeepSeek 本家へ流れ得るので、__tests__/model.test.ts が除去を検知する。
export const OPENROUTER_PROVIDER_POLICY: {
  ignore: string[];
  data_collection: "deny";
} = {
  ignore: ["DeepSeek"],
  data_collection: "deny",
};

// 2026-09-05 CI v2-arm: euryale は 6 回直しても視点が本人から外れて 60〜130 字のまま
// （doc/v2/arm-status.md run 4〜6）。同じコードで deepseek-v3.2 は 4 会話とも 10 ターン完走・
// 本人の一人称視点・ループ無し・1 ターン 3〜34 秒・単価は euryale の約半分。
// RIT-96 のモデル比較で 1017 が既定に確定（RIT-100）。euryale で回す時は
// V2_MODEL=sao10k/l3.3-euryale-70b（CI は件名の [v2model:...]）。
const DEFAULT_MODEL = "deepseek/deepseek-v4.1-flash-1017";

// RIT-104: 既定が使えん時に順に落ちる逃げ道。逃げ道 1 は Venice へ固定、
// 逃げ道 2 は Venice 版の dolphin。Venice との直契約・直の鍵は作らん（局長裁定）。
const ESCAPE_MODELS: { model: string; providerOnly?: string[] }[] = [
  { model: "deepseek/deepseek-v4.1-flash", providerOnly: ["Venice"] },
  { model: "cognitivecomputations/dolphin-mistral-24b-venice-edition" },
];

// 呼び出し側（apps/v2 の API ルート）が 503 へ写すため、汎用 Error と区別できる型にしとく。
export class OpenRouterKeyMissingError extends Error {
  constructor() {
    super(
      "OPENROUTER_API_KEY が未設定。apps/v2/.dev.vars に OPENROUTER_API_KEY=... を置く（CF_REMOTE=1 でも同じ）",
    );
    this.name = "OpenRouterKeyMissingError";
  }
}

const isReasoningModel = (model: string): boolean => /^openai\/(gpt-5|o[1-9])/.test(model);

type ChainSpec = { model: string; providerOnly?: string[] };

const defaultChain = (): ChainSpec[] => [{ model: DEFAULT_MODEL }, ...ESCAPE_MODELS];

// V2_MODEL_CHAIN の JSON を候補へ直す。壊れとる時は空にせず既定へ倒す（黙って止まるより
// 既定で動く方が被害が小さい。壊れは deploy 時の型チェックでは見えんので運用で見直す）。
const chainSpecFromEnv = (env: ModelEnv): ChainSpec[] => {
  if (env.V2_MODEL) return [{ model: env.V2_MODEL }];
  if (!env.V2_MODEL_CHAIN) return defaultChain();
  try {
    const parsed: unknown = JSON.parse(env.V2_MODEL_CHAIN);
    if (!Array.isArray(parsed)) return defaultChain();
    const specs = parsed.filter(
      (item): item is ChainSpec =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as { model?: unknown }).model === "string",
    );
    return specs.length > 0 ? specs : defaultChain();
  } catch {
    return defaultChain();
  }
};

// 各候補へ共通の ChatOpenRouter 設定。モデル名と provider.only だけ候補ごとに変わる。
const buildModel = (
  env: ModelEnv & { OPENROUTER_API_KEY: string },
  spec: ChainSpec,
): ChatOpenRouter =>
  new ChatOpenRouter({
    model: spec.model,
    apiKey: env.OPENROUTER_API_KEY,
    baseURL: env.V2_OPENROUTER_BASE_URL || undefined,
    provider: {
      ...OPENROUTER_PROVIDER_POLICY,
      ...(spec.providerOnly ? { only: spec.providerOnly } : {}),
    },
    // 推論モデル（gpt-5 系）は既定の推論で max_tokens を食い尽くして本文が空になる
    // （2026-09-05 CI v2-arm gpt-5-mini）。本文の分だけ残すため推論を最小にする。
    // OpenRouter の reasoning パラメータは対応せんモデルでは無視される。
    modelKwargs: isReasoningModel(spec.model) ? { reasoning: { effort: "minimal" } } : undefined,
  });

const toCandidate =
  (env: ModelEnv & { OPENROUTER_API_KEY: string }) =>
  (spec: ChainSpec): ModelCandidate => ({
    name: spec.model,
    model: buildModel(env, spec) as TurnModel,
  });

// env の鍵を必須に narrow してから呼ぶヘルパー。
const requireKey = (env: ModelEnv): ModelEnv & { OPENROUTER_API_KEY: string } => {
  if (!env.OPENROUTER_API_KEY) throw new OpenRouterKeyMissingError();
  return env as ModelEnv & { OPENROUTER_API_KEY: string };
};

// RIT-102/104: 既定 → 逃げ道 1 → 逃げ道 2 の順に試す候補列を作る。
// deps.models へ渡すと generate が拒否・時間切れ・障害で順に落ちる。
export const createModelChain = (env: ModelEnv): ModelCandidate[] => {
  const ready = requireKey(env);
  return chainSpecFromEnv(ready).map(toCandidate(ready));
};

// 単モデル経路（後方互換: deps.model だけ使う呼び出し側向け）。チェーンの先頭と同じモデル。
export const createOpenRouterModel = (env: ModelEnv): ChatOpenRouter => {
  const ready = requireKey(env);
  // ChatOpenRouter に streaming フラグは無い。.stream() を呼ぶ側が逐次取得を選ぶ
  // （engine/src/graph.ts の generate ノードが .stream() を使う）。
  // maxTokens もここでは固定せん。インスタンスはターンをまたいで共有されるので、段ごとの上限は
  // generate ノードが .stream(messages, { maxTokens, signal }) の呼び出しオプションで渡す
  // （ChatOpenRouterCallOptions.maxTokens → request の max_tokens。signal で締切・字数上限の abort）。
  return buildModel(ready, chainSpecFromEnv(ready)[0]);
};
