// 本番用チャットモデルの生成。テストは FakeListChatModel 等を deps.model に直接注入する
// （このファイルを経由しない）。
import { ChatOpenRouter } from "@langchain/openrouter";

export type ModelEnv = { OPENROUTER_API_KEY?: string; V2_MODEL?: string };

// 2026-09-05 CI v2-arm: euryale は 6 回直しても視点が本人から外れて 60〜130 字のまま
// （doc/v2/arm-status.md run 4〜6）。同じコードで deepseek-v3.2 は 4 会話とも 10 ターン完走・
// 本人の一人称視点・ループ無し・1 ターン 3〜34 秒・単価は euryale の約半分。既定をこちらにする。
// euryale で回す時は V2_MODEL=sao10k/l3.3-euryale-70b（CI は件名の [v2model:...]）。
const DEFAULT_MODEL = "deepseek/deepseek-v3.2";

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

export const createOpenRouterModel = (env: ModelEnv): ChatOpenRouter => {
  if (!env.OPENROUTER_API_KEY) throw new OpenRouterKeyMissingError();
  // ChatOpenRouter に streaming フラグは無い。.stream() を呼ぶ側が逐次取得を選ぶ
  // （engine/src/graph.ts の generate ノードが .stream() を使う）。
  // maxTokens もここでは固定せん。インスタンスはターンをまたいで共有されるので、段ごとの上限は
  // generate ノードが .stream(messages, { maxTokens, signal }) の呼び出しオプションで渡す
  // （ChatOpenRouterCallOptions.maxTokens → request の max_tokens。signal で締切・字数上限の abort）。
  const model = env.V2_MODEL ?? DEFAULT_MODEL;
  return new ChatOpenRouter({
    model,
    apiKey: env.OPENROUTER_API_KEY,
    // 推論モデル（gpt-5 系）は既定の推論で max_tokens を食い尽くして本文が空になる
    // （2026-09-05 CI v2-arm gpt-5-mini: 20 ターン全部 visible=0、1 ターン 7 秒）。本文の分だけ残すため
    // 推論を最小にする。OpenRouter の reasoning パラメータは対応せんモデルでは無視される。
    modelKwargs: isReasoningModel(model) ? { reasoning: { effort: "minimal" } } : undefined,
  });
};
