import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessageChunk } from "@langchain/core/messages";
import { ChatGenerationChunk } from "@langchain/core/outputs";
import { ChatOpenRouter } from "@langchain/openrouter";
import { z } from "zod";

import type { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";
import type { ChatModelStreamEvent } from "@langchain/core/language_models/event";
import type { BaseMessage, UsageMetadata } from "@langchain/core/messages";
import type { ChatResult } from "@langchain/core/outputs";

const MAX_EVENT_CHARS = 131_072;
const MAX_JSON_CHARS = 2_097_152;

export class OpenRouterTransportError extends Error {
  readonly statusCode?: number;

  constructor(statusCode?: number) {
    super("モデルの応答を取得できませんでした");
    this.name = statusCode === undefined ? "OpenRouterProtocolError" : "OpenRouterTransportError";
    this.statusCode = statusCode;
  }
}

const transportFailure = (error: unknown, signal?: AbortSignal): Error => {
  if (error instanceof OpenRouterTransportError) return error;
  const failure = new Error("モデルの応答を取得できませんでした");
  failure.name = signal?.aborted ? "AbortError" : "OpenRouterNetworkError";
  return failure;
};

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const identity = (value: unknown): string | null =>
  typeof value === "string" && /^[\p{L}\p{N}][\p{L}\p{N} _+./:()-]{0,199}$/u.test(value.trim())
    ? value.trim()
    : null;

const metadata = (value: Record<string, unknown>): Record<string, unknown> => ({
  model: identity(value.model),
  provider: identity(value.provider),
});

const usageSchema = z.object({
  prompt_tokens: z.number().int().nonnegative(),
  completion_tokens: z.number().int().nonnegative(),
  total_tokens: z.number().int().nonnegative(),
});

const usageOf = (value: unknown): UsageMetadata | undefined => {
  if (value === undefined || value === null) return undefined;
  const usage = usageSchema.safeParse(value);
  if (!usage.success) throw new OpenRouterTransportError();
  return {
    input_tokens: usage.data.prompt_tokens,
    output_tokens: usage.data.completion_tokens,
    total_tokens: usage.data.total_tokens,
  };
};

const parseJson = (text: string): Record<string, unknown> => {
  try {
    const value = record(JSON.parse(text) as unknown);
    if (value) return value;
  } catch {
    throw new OpenRouterTransportError();
  }
  throw new OpenRouterTransportError();
};

const throwApiError = (value: Record<string, unknown>): void => {
  if (value.error === undefined || value.error === null) return;
  const code = record(value.error)?.code;
  const status = typeof code === "number" ? code : typeof code === "string" ? Number(code) : 502;
  throw new OpenRouterTransportError(
    Number.isInteger(status) && status >= 400 && status <= 599 ? status : 502,
  );
};

const terminalReason = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (value === "stop" || value === "length" || value === "content_filter") return value;
  throw new OpenRouterTransportError();
};

const messageParams = (messages: BaseMessage[], model: string) =>
  messages.map((message) => {
    const type = message.getType();
    if (
      !["system", "human", "ai"].includes(type) ||
      typeof message.content !== "string" ||
      ("tool_calls" in message &&
        Array.isArray(message.tool_calls) &&
        message.tool_calls.length > 0) ||
      Object.keys(message.additional_kwargs).length > 0
    ) {
      // 現graphのtext契約外を黙って捨てると、別の質問として実行されてしまう。
      throw new OpenRouterTransportError(400);
    }
    return {
      role:
        type === "human"
          ? "user"
          : type === "ai"
            ? "assistant"
            : /^openai\/(?:gpt-5|o[1-9])/.test(model)
              ? "developer"
              : "system",
      content: message.content,
    };
  });

async function* readText(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
  try {
    for (;;) {
      const next = await reader.read();
      try {
        yield decoder.decode(next.value, { stream: !next.done });
      } catch {
        throw new OpenRouterTransportError();
      }
      if (next.done) return;
    }
  } finally {
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

class SseDataParser {
  private buffer = "";
  private data: string[] = [];
  private eventChars = 0;
  private previousCr = false;
  private eventType = "";

  push(character: string): string | undefined {
    if (this.previousCr && character === "\n") {
      this.previousCr = false;
      return;
    }
    this.previousCr = character === "\r";
    if (character !== "\r" && character !== "\n") {
      this.buffer += character;
      if (this.buffer.length + this.eventChars > MAX_EVENT_CHARS)
        throw new OpenRouterTransportError();
      return;
    }
    const line = this.buffer;
    this.buffer = "";
    return this.consumeLine(line);
  }

  private consumeLine(line: string): string | undefined {
    if (line === "") {
      if (this.eventType === "error") throw new OpenRouterTransportError(502);
      const event = this.data.length > 0 ? this.data.join("\n") : undefined;
      this.data = [];
      this.eventChars = 0;
      this.eventType = "";
      return event;
    }
    if (line.startsWith("data:")) {
      const value = line.slice(5).replace(/^ /, "");
      this.data.push(value);
      this.eventChars += value.length + 1;
    }
    if (line.startsWith("event:")) this.eventType = line.slice(6).trim();
  }
}

// SDK 0.4.11はSSE errorと不正JSONを無視するため、成功判定より手前で検査する。
async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const parser = new SseDataParser();
  for await (const text of readText(body)) {
    for (const character of text) {
      const data = parser.push(character);
      if (data !== undefined) yield data;
    }
  }
}

const readJson = async (body: ReadableStream<Uint8Array>): Promise<Record<string, unknown>> => {
  let text = "";
  for await (const piece of readText(body)) {
    text += piece;
    if (text.length > MAX_JSON_CHARS) throw new OpenRouterTransportError();
  }
  return parseJson(text);
};

const firstChoice = (data: Record<string, unknown>): Record<string, unknown> | undefined => {
  throwApiError(data);
  if (!Array.isArray(data.choices) || data.choices.length > 1) throw new OpenRouterTransportError();
  const choice = record(data.choices[0]);
  if (data.choices.length > 0 && !choice) throw new OpenRouterTransportError();
  return choice;
};

const makeMessage = (
  data: Record<string, unknown>,
  content: string,
  refusal: unknown,
  finish: string | null,
  withUsage = true,
): AIMessageChunk =>
  new AIMessageChunk({
    content,
    additional_kwargs: typeof refusal === "string" ? { refusal } : {},
    response_metadata: { ...metadata(data), ...(finish ? { finish_reason: finish } : {}) },
    usage_metadata: withUsage ? usageOf(data.usage) : undefined,
  });

const deltaContent = (delta: Record<string, unknown>): string => {
  if (delta.tool_calls) throw new OpenRouterTransportError();
  const content = delta.content;
  if (content === undefined || content === null) return "";
  if (typeof content !== "string") throw new OpenRouterTransportError();
  return content;
};

const completedMessage = (data: Record<string, unknown>): AIMessageChunk => {
  const choice = firstChoice(data);
  const output = record(choice?.message);
  const finish = terminalReason(choice?.finish_reason);
  if (!output || !finish || output.tool_calls) {
    throw new OpenRouterTransportError();
  }
  return makeMessage(data, deltaContent(output), output.refusal, finish);
};

const streamMessage = (
  data: Record<string, unknown>,
  withUsage: boolean,
): { message: AIMessageChunk; finish: string | null } => {
  const choice = firstChoice(data);
  if (!choice) return { message: makeMessage(data, "", null, null, withUsage), finish: null };
  const delta = record(choice.delta);
  if (!delta) throw new OpenRouterTransportError();
  const finish = terminalReason(choice.finish_reason);
  return {
    message: makeMessage(data, deltaContent(delta), delta.refusal, finish, withUsage),
    finish,
  };
};

const requestHeaders = (model: ChatOpenRouter): Record<string, string> => {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${model.apiKey}`,
    "Content-Type": "application/json",
  };
  if (model.siteUrl) headers["HTTP-Referer"] = model.siteUrl;
  if (model.siteName) headers["X-Title"] = model.siteName;
  if (model.appCategories?.length)
    headers["X-OpenRouter-Categories"] = model.appCategories.join(",");
  return headers;
};

async function* responseChunks(
  body: ReadableStream<Uint8Array>,
  withUsage: boolean,
  runManager?: CallbackManagerForLLMRun,
): AsyncGenerator<ChatGenerationChunk> {
  let finished = false;
  for await (const event of readSse(body)) {
    if (event === "[DONE]") {
      if (!finished) throw new OpenRouterTransportError();
      return;
    }
    const { message, finish } = streamMessage(parseJson(event), withUsage);
    const text = typeof message.content === "string" ? message.content : "";
    if (finished && (finish || text)) throw new OpenRouterTransportError();
    finished ||= finish !== null;
    yield new ChatGenerationChunk({ message, text });
    await runManager?.handleLLMNewToken(text);
  }
  // TCPの切断を完了に写すと、途中までの本文が成功として保存される。
  throw new OpenRouterTransportError();
}

export class StrictOpenRouterChat extends ChatOpenRouter {
  private async request(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    streaming: boolean,
  ): Promise<Response> {
    if (options.tools?.length || options.tool_choice) throw new OpenRouterTransportError(400);
    const params = messageParams(messages, this.model);
    let response: Response;
    try {
      response = await this.caller.callWithOptions({ signal: options.signal }, () =>
        fetch(`${this.baseURL}/chat/completions`, {
          method: "POST",
          headers: requestHeaders(this),
          body: JSON.stringify({
            ...this.invocationParams(options),
            messages: params,
            stream: streaming,
          }),
          signal: options.signal,
        }),
      );
    } catch (error) {
      throw transportFailure(error, options.signal);
    }
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined);
      throw new OpenRouterTransportError(response.status);
    }
    return response;
  }

  async _generate(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun,
  ): Promise<ChatResult> {
    const response = await this.request(messages, options, false);
    if (!response.body) throw new OpenRouterTransportError();
    let message: AIMessageChunk;
    try {
      message = completedMessage(await readJson(response.body));
    } catch (error) {
      throw transportFailure(error, options.signal);
    }
    const text = typeof message.content === "string" ? message.content : "";
    await runManager?.handleLLMNewToken(text);
    return { generations: [{ text, message }] };
  }

  async *_streamResponseChunks(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun,
  ): AsyncGenerator<ChatGenerationChunk> {
    const response = await this.request(messages, options, true);
    if (!response.body) throw new OpenRouterTransportError();
    try {
      yield* responseChunks(response.body, this.streamUsage, runManager);
    } catch (error) {
      throw transportFailure(error, options.signal);
    }
  }

  async *_streamChatModelEvents(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun,
  ): AsyncGenerator<ChatModelStreamEvent> {
    yield* BaseChatModel.prototype._streamChatModelEvents.call(this, messages, options, runManager);
  }
}
