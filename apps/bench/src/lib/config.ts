import type { BenchConfig } from "./bench.ts";

// モデルは消耗品、台が資産。差し替えは環境変数1個で済ませる。
export const DEFAULT_MODEL = process.env.BENCH_MODEL ?? "deepseek/deepseek-chat";
export const DEFAULT_RESPONSE_LENGTH = Number(process.env.BENCH_RESPONSE_LENGTH ?? 400);
export const DEFAULT_MAX_TOKENS = Number(process.env.BENCH_MAX_TOKENS ?? 3072);

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export function defaultConfig(
  characterPrompt: string,
  overrides: Partial<BenchConfig> = {},
): BenchConfig {
  return {
    characterPrompt,
    responseLength: DEFAULT_RESPONSE_LENGTH,
    useXmlEnvelope: false,
    requireClimaxFollowThrough: false,
    stripTags: false,
    model: DEFAULT_MODEL,
    maxTokens: DEFAULT_MAX_TOKENS,
    temperature: 0.9,
    frequencyPenalty: 0,
    presencePenalty: 0,
    timeoutMs: 120_000,
    // undefined を混ぜると既定値を潰してしまう（P1 で model 未指定が HTTP 400 になった）
    ...stripUndefined(overrides),
  };
}

export function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of argv) {
    const m = /^--([^=]+)=(.*)$/.exec(a);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

export function runId(prefix: string): string {
  return `${prefix}-${new Date()
    .toISOString()
    .replace(/[.:TZ-]/g, "")
    .slice(0, 14)}-${Math.random().toString(36).slice(2, 6)}`;
}
