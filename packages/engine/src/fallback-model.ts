import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessageChunk } from "@langchain/core/messages";
import { ChatGenerationChunk } from "@langchain/core/outputs";
import { IterableReadableStream } from "@langchain/core/utils/stream";

import { createOpenRouterModel } from "./model";

import type { TurnModel, TurnModelCallOptions } from "./graph";
import type { ModelEnv } from "./model";
import type { OpenRouterRoute } from "./provider-policy";
import type { BaseLanguageModelInput } from "@langchain/core/language_models/base";
import type { BaseMessage } from "@langchain/core/messages";
import type { ChatResult } from "@langchain/core/outputs";

export type FallbackReason =
  | "refusal"
  | "timeout"
  | "rate-limit"
  | "server-error"
  | "connection"
  | "protocol"
  | "empty"
  | "output-limit"
  | "cancelled"
  | "unsafe-provider"
  | "non-retryable";

export type FallbackAttempt = Readonly<{
  route: OpenRouterRoute;
  requestedModel: string;
  model: string | null;
  provider: string | null;
  status: "ok" | "failed";
  reason: FallbackReason | null;
  latencyMs: number;
  timeoutMs: number;
}>;

export type FallbackModelOptions = {
  attemptTimeoutMs: number;
  maxOutputChars: number;
  isRefusal: (text: string) => boolean;
  onAttempt?: (attempt: FallbackAttempt) => void | Promise<void>;
  now?: () => number;
};

export class FallbackModelError extends Error {
  readonly code: "exhausted" | "cancelled" | "output-limit" | "non-retryable" | "audit-failed";
  readonly attempts: readonly FallbackAttempt[];

  constructor(code: FallbackModelError["code"], attempts: readonly FallbackAttempt[]) {
    super(code === "cancelled" ? "生成を中止しました" : "モデルから返事を取得できませんでした");
    this.name = code === "cancelled" ? "AbortError" : "FallbackModelError";
    this.code = code;
    this.attempts = Object.freeze([...attempts]);
  }
}

class AttemptFailure extends Error {
  readonly reason: FallbackReason;
  constructor(reason: FallbackReason) {
    super(reason);
    this.reason = reason;
  }
}

const textOf = (message: BaseMessage): string =>
  typeof message.content === "string"
    ? message.content
    : message.content
        .map((block) =>
          typeof block === "string"
            ? block
            : block.type === "text" && typeof block.text === "string"
              ? block.text
              : "",
        )
        .join("");

const labelOf = (value: unknown): string | null =>
  typeof value === "string" && /^[\p{L}\p{N}][\p{L}\p{N} _+./:()-]{0,199}$/u.test(value.trim())
    ? value.trim()
    : null;

const metadataOf = (message: AIMessageChunk): Pick<FallbackAttempt, "model" | "provider"> => ({
  model: labelOf(message.response_metadata.model_name ?? message.response_metadata.model),
  provider: labelOf(
    message.response_metadata.provider ??
      message.response_metadata.provider_name ??
      message.response_metadata.upstream_provider,
  ),
});

const propertyOf = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;

const httpReason = (status: unknown): FallbackReason | null => {
  if (status === 429) return "rate-limit";
  if (typeof status === "number" && status >= 500 && status <= 599) return "server-error";
  return status === 408 ? "timeout" : null;
};

const isConnectionError = (error: unknown): boolean => {
  const message = propertyOf(error, "message");
  if (
    propertyOf(error, "name") === "TypeError" &&
    typeof message === "string" &&
    /fetch failed|failed to fetch|network request failed|load failed/i.test(message)
  )
    return true;
  const codes = [propertyOf(error, "code"), propertyOf(propertyOf(error, "cause"), "code")];
  return codes.some((code) =>
    ["ECONNRESET", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT"].includes(String(code)),
  );
};

const NAMED_REASONS = new Map<unknown, FallbackReason>([
  ["TimeoutError", "timeout"],
  ["APITimeoutError", "timeout"],
  ["AbortError", "cancelled"],
  ["APIConnectionError", "connection"],
  ["OpenRouterProtocolError", "protocol"],
  ["OpenRouterNetworkError", "connection"],
]);

const reasonOf = (error: unknown): FallbackReason => {
  if (error instanceof AttemptFailure) return error.reason;
  return (
    httpReason(propertyOf(error, "statusCode") ?? propertyOf(error, "status")) ??
    NAMED_REASONS.get(propertyOf(error, "name")) ??
    (isConnectionError(error) ? "connection" : "non-retryable")
  );
};

const abortReason = (signal: AbortSignal): AttemptFailure =>
  signal.reason instanceof AttemptFailure ? signal.reason : new AttemptFailure("cancelled");

const awaitAbortable = async <T>(work: () => Promise<T>, signal: AbortSignal): Promise<T> => {
  if (signal.aborted) throw abortReason(signal);
  let abort: (() => void) | undefined;
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(abortReason(signal));
    signal.addEventListener("abort", abort, { once: true });
  });
  try {
    return await Promise.race([work(), cancelled]);
  } finally {
    if (abort) signal.removeEventListener("abort", abort);
  }
};

const makeAttemptSignal = (timeoutMs: number, external?: AbortSignal) => {
  const controller = new AbortController();
  const cancel = () => controller.abort(new AttemptFailure("cancelled"));
  external?.addEventListener("abort", cancel, { once: true });
  if (external?.aborted) cancel();
  const timer = setTimeout(() => controller.abort(new AttemptFailure("timeout")), timeoutMs);
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      external?.removeEventListener("abort", cancel);
      controller.abort(new AttemptFailure("cancelled"));
    },
  };
};

const ROUTES: readonly OpenRouterRoute[] = ["primary", "fallback-1", "fallback-2"];

type ResponseIdentity = Pick<FallbackAttempt, "model" | "provider">;

const mergeIdentity = (
  previous: ResponseIdentity,
  current: ResponseIdentity,
): ResponseIdentity => ({
  model: current.model ?? previous.model,
  provider: current.provider ?? previous.provider,
});

const assertProvider = (provider: string | null): void => {
  if (provider && /^deepseek(?:$|[\s(/:-])/i.test(provider)) {
    throw new AttemptFailure("unsafe-provider");
  }
};

const attachAudit = (
  pieces: AIMessageChunk[],
  attempts: readonly FallbackAttempt[],
): AIMessageChunk[] => {
  const first = pieces[0];
  if (first) {
    pieces[0] = new AIMessageChunk({
      ...first,
      response_metadata: {
        ...first.response_metadata,
        fallbackAttempts: Object.freeze([...attempts]),
      },
    });
  }
  return pieces;
};

export class FallbackChatModel extends BaseChatModel<TurnModelCallOptions> {
  private readonly models: readonly [TurnModel, TurnModel, TurnModel];
  private readonly policy: FallbackModelOptions;

  constructor(models: readonly [TurnModel, TurnModel, TurnModel], options: FallbackModelOptions) {
    super({ maxRetries: 0 });
    if (
      !Number.isSafeInteger(options.attemptTimeoutMs) ||
      options.attemptTimeoutMs <= 0 ||
      options.attemptTimeoutMs > 2_147_483_647 ||
      !Number.isSafeInteger(options.maxOutputChars) ||
      options.maxOutputChars <= 0
    ) {
      throw new Error("モデルの時間切れと出力上限は正の整数で指定してください");
    }
    this.models = models;
    this.policy = options;
  }

  _llmType(): string {
    return "openrouter-fallback";
  }

  async invoke(
    input: BaseLanguageModelInput,
    options?: Partial<TurnModelCallOptions>,
  ): Promise<AIMessageChunk> {
    try {
      return await super.invoke(input, options);
    } catch (error) {
      if (options?.signal?.aborted && !(error instanceof FallbackModelError)) {
        throw new FallbackModelError("cancelled", []);
      }
      throw error;
    }
  }

  async stream(
    input: BaseLanguageModelInput,
    options?: Partial<TurnModelCallOptions>,
  ): Promise<IterableReadableStream<AIMessageChunk>> {
    const external = options?.signal;
    if (!external) return super.stream(input, options);
    const controller = new AbortController();
    // LangChainのstreamも独自にabortを競合させるため、渡すreason自体を安全な型へ替える。
    const cancel = () => controller.abort(new FallbackModelError("cancelled", []));
    external.addEventListener("abort", cancel, { once: true });
    if (external.aborted) cancel();
    try {
      const source = await super.stream(input, { ...options, signal: controller.signal });
      async function* forward(): AsyncGenerator<AIMessageChunk> {
        try {
          yield* source;
        } finally {
          external?.removeEventListener("abort", cancel);
        }
      }
      return IterableReadableStream.fromAsyncGenerator(forward());
    } catch (error) {
      external.removeEventListener("abort", cancel);
      throw error;
    }
  }

  private checkOutput(pieces: readonly AIMessageChunk[]): void {
    const text = pieces.map(textOf).join("");
    if (
      text.length > this.policy.maxOutputChars ||
      pieces.length > this.policy.maxOutputChars + 1
    ) {
      throw new AttemptFailure("output-limit");
    }
    if (
      ["[INFRA_ERROR:", "[API_ERROR:", "[FETCH_ERROR:"].some((prefix) => text.startsWith(prefix))
    ) {
      throw new AttemptFailure("connection");
    }
    if (
      this.policy.isRefusal(text) ||
      pieces.some(
        (piece) =>
          piece.response_metadata.finish_reason === "content_filter" ||
          (typeof piece.additional_kwargs.refusal === "string" &&
            piece.additional_kwargs.refusal.length > 0),
      )
    ) {
      throw new AttemptFailure("refusal");
    }
    if (!text.trim()) throw new AttemptFailure("empty");
  }

  private async collect(
    model: TurnModel,
    messages: BaseMessage[],
    options: TurnModelCallOptions,
    streaming: boolean,
    observe: (piece: AIMessageChunk) => void,
  ): Promise<AIMessageChunk[]> {
    const signal = options.signal;
    if (!signal) throw new Error("attempt signal が必要です");
    if (!streaming) {
      const response = await awaitAbortable(() => model.invoke(messages, options), signal);
      const piece = new AIMessageChunk(response);
      observe(piece);
      return [piece];
    }
    const source = await awaitAbortable(() => model.stream(messages, options), signal);
    const iterator = source[Symbol.asyncIterator]();
    const pieces: AIMessageChunk[] = [];
    let chars = 0;
    let completed = false;
    try {
      for (;;) {
        const next = await awaitAbortable(() => iterator.next(), signal);
        if (next.done) {
          completed = true;
          return pieces;
        }
        observe(next.value);
        chars += textOf(next.value).length;
        if (chars > this.policy.maxOutputChars || pieces.length > this.policy.maxOutputChars) {
          throw new AttemptFailure("output-limit");
        }
        pieces.push(next.value);
      }
    } finally {
      // signalを無視するstreamのreturn待ちで次段も止まらないよう、終了処理の拒否だけ回収する。
      if (!completed && iterator.return) void iterator.return().catch(() => undefined);
    }
  }

  private validateResponse(
    pieces: AIMessageChunk[],
    metadata: ResponseIdentity,
    signal: AbortSignal,
  ): void {
    assertProvider(metadata.provider);
    if (signal.aborted) throw abortReason(signal);
    this.checkOutput(pieces);
  }

  private async attempt(
    model: TurnModel,
    route: OpenRouterRoute,
    messages: BaseMessage[],
    options: TurnModelCallOptions,
    streaming: boolean,
  ): Promise<{ pieces: AIMessageChunk[]; attempt: FallbackAttempt }> {
    const now = this.policy.now ?? Date.now;
    const started = now();
    const deadline = makeAttemptSignal(this.policy.attemptTimeoutMs, options.signal);
    let pieces: AIMessageChunk[] = [];
    let metadata: ResponseIdentity = { model: null, provider: null };
    let reason: FallbackReason | null = null;
    try {
      pieces = await this.collect(
        model,
        messages,
        { ...options, signal: deadline.signal },
        streaming,
        (piece) => {
          metadata = mergeIdentity(metadata, metadataOf(piece));
          assertProvider(metadata.provider);
        },
      );
      this.validateResponse(pieces, metadata, deadline.signal);
    } catch (error) {
      reason = options.signal?.aborted ? "cancelled" : reasonOf(error);
    } finally {
      deadline.dispose();
    }
    const requestedModel: unknown = Reflect.get(model, "model");
    return {
      pieces,
      attempt: Object.freeze({
        route,
        requestedModel: labelOf(requestedModel) ?? model._llmType(),
        ...metadata,
        status: reason ? "failed" : "ok",
        reason,
        latencyMs: Math.max(0, now() - started),
        timeoutMs: this.policy.attemptTimeoutMs,
      }),
    };
  }

  private async publishAttempt(
    attempt: FallbackAttempt,
    attempts: readonly FallbackAttempt[],
  ): Promise<void> {
    try {
      await this.policy.onAttempt?.(attempt);
    } catch {
      throw new FallbackModelError("audit-failed", attempts);
    }
  }

  private async execute(
    messages: BaseMessage[],
    options: TurnModelCallOptions,
    streaming: boolean,
  ): Promise<AIMessageChunk[]> {
    const attempts: FallbackAttempt[] = [];
    for (const [index, model] of this.models.entries()) {
      if (options.signal?.aborted) throw new FallbackModelError("cancelled", attempts);
      const { pieces, attempt } = await this.attempt(
        model,
        ROUTES[index],
        messages,
        options,
        streaming,
      );
      attempts.push(attempt);
      await this.publishAttempt(attempt, attempts);
      const reason = attempt.reason;
      if (reason === null) return attachAudit(pieces, attempts);
      if (reason === "cancelled" || reason === "output-limit" || reason === "non-retryable") {
        throw new FallbackModelError(reason, attempts);
      }
    }
    throw new FallbackModelError("exhausted", attempts);
  }

  async _generate(messages: BaseMessage[], options: TurnModelCallOptions): Promise<ChatResult> {
    const pieces = await this.execute(messages, options, false);
    const message = pieces[0];
    return { generations: [{ message, text: textOf(message) }] };
  }

  async *_streamResponseChunks(
    messages: BaseMessage[],
    options: TurnModelCallOptions,
  ): AsyncGenerator<ChatGenerationChunk> {
    // 成功確定前にtokenを渡すと、失敗した段の本文と次段の本文が同時に確定してしまう。
    const pieces = await this.execute(messages, options, true);
    for (const message of pieces) {
      if (options.signal?.aborted) throw new FallbackModelError("cancelled", []);
      yield new ChatGenerationChunk({ message, text: textOf(message) });
    }
  }
}

export const createOpenRouterFallbackModel = (
  env: ModelEnv,
  options: FallbackModelOptions,
): FallbackChatModel =>
  new FallbackChatModel(
    [
      createOpenRouterModel(env, "primary"),
      createOpenRouterModel(env, "fallback-1"),
      createOpenRouterModel(env, "fallback-2"),
    ],
    options,
  );
