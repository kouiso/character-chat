import { DEFAULT_CHAT_MODEL, EROTIC_CHAT_MODEL, LLM_ROUTER_MODEL } from "../../../src/lib/model";

const PROVIDERS_WITHOUT_QWEN_CHAT_COMPLETIONS = ["novita"] as const;
// very_long では 1300 字到達までの生成時間が Cloudflare Worker 制限に抵触しやすい。
// #1370: streamlake 単独では遅延/障害時に 503 に至るケースがあったため、
// 第一優先は streamlake、フォールバックは DeepInfra とし、availability を確保する。
// allow_fallbacks は true にして、streamlake 失敗時のみ他プロバイダへ遷移させる。
// #1415: per-phase max_tokens は conversation/afterglow=2048, intimate=2560, erotic=3072, climax=3584 まで
// 引き上げた。これらすべての very_long deepseek ルートで同じ provider order を使えるよう
// 最大値 3584 を閾値にする。
const VERY_LONG_DEEPSEEK_PROVIDER_ORDER = ["streamlake", "DeepInfra"] as const;
const VERY_LONG_MAX_TOKENS = 3584;

export type OpenRouterProviderRouting = {
  allow_fallbacks: boolean;
  ignore?: readonly string[];
  order?: readonly string[];
};

export const buildOpenRouterProviderRouting = (
  model: string,
  maxTokens?: number,
): OpenRouterProviderRouting => ({
  allow_fallbacks: true,
  // very_long 本流（1408）と too_short continuation（768/1408 token）も
  // streamlake 優先・DeepInfra フォールバックにする。streamlake 障害/遅延時に
  // 他プロバイダへ移行し、1300 字 visible フロアを損なわない（#1370）。
  ...(model === EROTIC_CHAT_MODEL && maxTokens !== undefined && maxTokens <= VERY_LONG_MAX_TOKENS
    ? { order: VERY_LONG_DEEPSEEK_PROVIDER_ORDER }
    : {}),
  ...(model === DEFAULT_CHAT_MODEL || model === LLM_ROUTER_MODEL
    ? { ignore: PROVIDERS_WITHOUT_QWEN_CHAT_COMPLETIONS }
    : {}),
});
