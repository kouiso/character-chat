import { REPO_ROOT } from "./env.ts";
import { complete, type ChatMessage, type CompletionResult } from "./openrouter.ts";
import { buildMessages, stripEnvelope, type PromptConfig } from "./prompt.ts";
import { appendJsonl } from "./store.ts";
import { measureUtterance, type UtteranceMetric } from "./text-metric.ts";

export const DEFAULT_LOG = `${REPO_ROOT}apps/bench/.data/turns.jsonl`;

export type BenchConfig = PromptConfig & {
  model: string;
  maxTokens: number;
  temperature?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  timeoutMs?: number;
  /** 生タグを剥がすか。剥がし損ねの再現条件を作るため既定は剥がさん */
  stripTags: boolean;
};

export type TurnRecord = {
  ts: string;
  runId: string;
  scenarioId: string;
  turnIndex: number;
  model: string;
  servedModel: string | null;
  maxTokens: number;
  responseLength: number;
  frequencyPenalty: number;
  presencePenalty: number;
  useXmlEnvelope: boolean;
  stripTags: boolean;
  userText: string;
  replyRaw: string;
  reply: string;
  ok: boolean;
  httpStatus: number;
  finishReason: string | null;
  reasoningChars: number;
  error: string | null;
  headerMs: number;
  latencyMs: number;
  promptTokens: number | null;
  completionTokens: number | null;
  metric: UtteranceMetric;
};

export type RunTurnInput = {
  config: BenchConfig;
  history: ChatMessage[];
  userText: string;
  runId: string;
  scenarioId: string;
  turnIndex: number;
  logPath?: string;
};

export async function runTurn(input: RunTurnInput): Promise<TurnRecord> {
  const { config } = input;
  const history: ChatMessage[] = [...input.history, { role: "user", content: input.userText }];
  const completion: CompletionResult = await complete({
    model: config.model,
    messages: buildMessages(config, history),
    maxTokens: config.maxTokens,
    temperature: config.temperature,
    frequencyPenalty: config.frequencyPenalty,
    presencePenalty: config.presencePenalty,
    timeoutMs: config.timeoutMs,
  });
  const raw = completion.text;
  const reply = config.stripTags ? stripEnvelope(raw) : raw;
  const previousAssistant = [...input.history]
    .reverse()
    .find((m) => m.role === "assistant")?.content;
  const record: TurnRecord = {
    ts: new Date().toISOString(),
    runId: input.runId,
    scenarioId: input.scenarioId,
    turnIndex: input.turnIndex,
    model: config.model,
    servedModel: completion.servedModel,
    maxTokens: config.maxTokens,
    responseLength: config.responseLength,
    frequencyPenalty: config.frequencyPenalty ?? 0,
    presencePenalty: config.presencePenalty ?? 0,
    useXmlEnvelope: config.useXmlEnvelope,
    stripTags: config.stripTags,
    userText: input.userText,
    replyRaw: raw,
    reply,
    ok: completion.ok,
    httpStatus: completion.httpStatus,
    finishReason: completion.finishReason,
    reasoningChars: completion.reasoningChars,
    error: completion.error,
    headerMs: Math.round(completion.headerMs),
    latencyMs: Math.round(completion.latencyMs),
    promptTokens: completion.promptTokens,
    completionTokens: completion.completionTokens,
    metric: measureUtterance(reply, {
      userText: input.userText,
      previousAssistant,
      expectedLength: config.responseLength,
    }),
  };
  appendJsonl(input.logPath ?? DEFAULT_LOG, record);
  return record;
}

export type RunScenarioInput = {
  config: BenchConfig;
  scenarioId: string;
  greeting?: string;
  userTurns: string[];
  turns: number;
  runId: string;
  logPath?: string;
  onTurn?: (record: TurnRecord) => void;
};

export async function runScenario(input: RunScenarioInput): Promise<TurnRecord[]> {
  const history: ChatMessage[] = [];
  if (input.greeting?.trim()) history.push({ role: "assistant", content: input.greeting });
  const records: TurnRecord[] = [];
  const limit = Math.min(input.turns, input.userTurns.length);
  for (let i = 0; i < limit; i += 1) {
    const userText = input.userTurns[i];
    const record = await runTurn({
      config: input.config,
      history,
      userText,
      runId: input.runId,
      scenarioId: input.scenarioId,
      turnIndex: i,
      logPath: input.logPath,
    });
    records.push(record);
    input.onTurn?.(record);
    history.push({ role: "user", content: userText });
    // 空返信でも履歴には残す。実運用と同じ状態を積まんと尻すぼみが再現せん
    history.push({ role: "assistant", content: record.reply });
  }
  return records;
}
