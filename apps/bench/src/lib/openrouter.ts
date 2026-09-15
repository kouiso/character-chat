import { requireOpenRouterKey } from "./env.ts";

// ストリーミングは意図的にやらん。既存の buffer-then-replay が遅延を生んどるので、
// まず「正しく返る」ことを取る。first-token 到達時間は P4 で別途測る。

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type CompletionResult = {
  ok: boolean;
  text: string;
  model: string;
  /** 実際に応答を返したプロバイダ側のモデル。OpenRouter が別モデルへ回すことがある */
  servedModel: string | null;
  finishReason: string | null;
  /** 推論チャネルに流れた文字数。本文が空でここだけ埋まっとる事故を見分けるため */
  reasoningChars: number;
  promptTokens: number | null;
  completionTokens: number | null;
  /** ヘッダーが返るまで。本文の生成待ちは含まん */
  headerMs: number;
  /** 本文を読み切るまで。体感のレイテンシはこっち */
  latencyMs: number;
  httpStatus: number;
  /** 失敗理由。空返信の原因切り分けに使うので握り潰さん */
  error: string | null;
};

export type CompletionOptions = {
  model: string;
  messages: ChatMessage[];
  maxTokens: number;
  temperature?: number;
  /** 同じ語の再出現を抑える。既存 functions/api/[[route]].ts の penaltyByPhase 相当 */
  frequencyPenalty?: number;
  /** 既に出た語を避けさせる */
  presencePenalty?: number;
  /** リクエスト全体のタイムアウト。既存の 8 秒 first-token 打ち切りは持ち込まん */
  timeoutMs?: number;
};

type OpenRouterBody = {
  model?: string;
  choices?: Array<{
    message?: { content?: string; reasoning?: string };
    finish_reason?: string;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
};

function buildRequestBody(options: CompletionOptions, stream: boolean): string {
  return JSON.stringify({
    model: options.model,
    messages: options.messages,
    max_tokens: options.maxTokens,
    temperature: options.temperature ?? 0.9,
    frequency_penalty: options.frequencyPenalty ?? 0,
    presence_penalty: options.presencePenalty ?? 0,
    stream,
  });
}

function emptyResult(model: string): CompletionResult {
  return {
    ok: false,
    text: "",
    model,
    servedModel: null,
    finishReason: null,
    reasoningChars: 0,
    promptTokens: null,
    completionTokens: null,
    headerMs: 0,
    latencyMs: 0,
    httpStatus: 0,
    error: null,
  };
}

type Timing = { headerMs: number; latencyMs: number; httpStatus: number };

function pickChoice(json: OpenRouterBody): {
  text: string;
  finishReason: string | null;
  reasoningChars: number;
} {
  const choice = json.choices?.[0];
  return {
    text: choice?.message?.content ?? "",
    finishReason: choice?.finish_reason ?? null,
    // 推論モデルは本文0のまま max_tokens を推論で使い切ることがある。HTTP は 200 で返る
    reasoningChars: (choice?.message?.reasoning ?? "").length,
  };
}

function pickUsage(json: OpenRouterBody): {
  promptTokens: number | null;
  completionTokens: number | null;
} {
  return {
    promptTokens: json.usage?.prompt_tokens ?? null,
    completionTokens: json.usage?.completion_tokens ?? null,
  };
}

function interpretBody(
  json: OpenRouterBody,
  base: CompletionResult,
  timing: Timing,
): CompletionResult {
  if (json.error)
    return {
      ...base,
      ...timing,
      error: json.error.message ?? "unknown upstream error",
    };
  return {
    ...base,
    ...timing,
    ...pickChoice(json),
    ...pickUsage(json),
    ok: true,
    servedModel: json.model ?? null,
  };
}

export async function complete(options: CompletionOptions): Promise<CompletionResult> {
  const key = requireOpenRouterKey();
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 120_000);
  const base = emptyResult(options.model);
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: buildRequestBody(options, false),
    });
    // fetch が解決するのはヘッダー到達時点。本文の生成待ちはこの後に来るので、
    // ここで測って終わりにすると「300ms で返っとる」と嘘をつくことになる
    const headerMs = performance.now() - started;
    const bodyText = await res.text();
    const latencyMs = performance.now() - started;
    if (!res.ok) {
      return {
        ...base,
        headerMs,
        latencyMs,
        httpStatus: res.status,
        error: bodyText.slice(0, 500),
      };
    }
    return interpretBody(JSON.parse(bodyText) as OpenRouterBody, base, {
      headerMs,
      latencyMs,
      httpStatus: res.status,
    });
  } catch (e) {
    const failedAt = performance.now() - started;
    return {
      ...base,
      headerMs: failedAt,
      latencyMs: failedAt,
      error: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
    };
  } finally {
    clearTimeout(timer);
  }
}

export type FirstTokenProbe = {
  model: string;
  ok: boolean;
  httpStatus: number;
  /** HTTP ヘッダーが返るまで */
  headerMs: number | null;
  /** 最初の本文トークンが届くまで。既存の FIRST_TOKEN_TIMEOUT_MS = 8_000 と比べる値 */
  firstTokenMs: number | null;
  error: string | null;
};

/**
 * 既存 `functions/api/[[route]].ts:460` の 8 秒 first-token 打ち切りが
 * 空返信の原因になり得るかを測るためだけの経路。本番の生成には使わん。
 */
export async function probeFirstToken(
  options: Omit<CompletionOptions, "timeoutMs"> & { timeoutMs?: number },
): Promise<FirstTokenProbe> {
  const key = requireOpenRouterKey();
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 60_000);
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: buildRequestBody(options, true),
    });
    const headerMs = performance.now() - started;
    if (!res.ok || !res.body)
      return {
        model: options.model,
        ok: false,
        httpStatus: res.status,
        headerMs,
        firstTokenMs: null,
        error: (await res.text()).slice(0, 300),
      };
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // OpenRouter は接続維持のコメント行を先に流すので、本文が乗るまで待つ
      const hasContent = /"content"\s*:\s*"(?!")/.test(buffer);
      if (hasContent) {
        const firstTokenMs = performance.now() - started;
        await reader.cancel("probe done").catch(() => {});
        return {
          model: options.model,
          ok: true,
          httpStatus: res.status,
          headerMs,
          firstTokenMs,
          error: null,
        };
      }
    }
    return {
      model: options.model,
      ok: false,
      httpStatus: res.status,
      headerMs,
      firstTokenMs: null,
      error: "本文トークンが1つも来んままストリームが閉じた",
    };
  } catch (e) {
    return {
      model: options.model,
      ok: false,
      httpStatus: 0,
      headerMs: null,
      firstTokenMs: null,
      error: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
    };
  } finally {
    clearTimeout(timer);
  }
}
