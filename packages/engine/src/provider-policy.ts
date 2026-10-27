import { z } from "zod";

import type { ChatOpenRouterInput } from "@langchain/openrouter";

export type OpenRouterRoute = "primary" | "fallback-1" | "fallback-2";

export type OpenRouterPolicyEnv = {
  V2_MODEL?: string;
  V2_MODEL_PROVIDER?: string;
  V2_OPENROUTER_BASE_URL?: string;
};

const providerName = z.string().trim().min(1);
const providerPolicySchema = z
  .object({
    ignore: z.array(providerName),
    data_collection: z.literal("deny"),
    only: z.array(providerName).min(1).optional(),
    order: z.array(providerName).min(1).optional(),
    allow_fallbacks: z.boolean().optional(),
    require_parameters: z.boolean().optional(),
  })
  .strict();

export class OpenRouterPolicyError extends Error {
  constructor() {
    super("OpenRouter のモデル・実行先設定が不正。DeepSeek の除外と data_collection=deny が必要");
    this.name = "OpenRouterPolicyError";
  }
}

const isDeepSeek = (provider: string): boolean => /^deepseek(?:$|[\s(/:-])/i.test(provider);

export const validateProviderPolicy = (
  value: unknown,
): NonNullable<ChatOpenRouterInput["provider"]> => {
  const parsed = providerPolicySchema.safeParse(value);
  if (!parsed.success) throw new OpenRouterPolicyError();
  const policy = parsed.data;
  // 特定endpointだけの除外では本家の別endpointへ流れるため、base名そのものを必須にする。
  if (!policy.ignore.some((provider) => provider.toLowerCase() === "deepseek")) {
    throw new OpenRouterPolicyError();
  }
  if ([...(policy.only ?? []), ...(policy.order ?? [])].some(isDeepSeek)) {
    throw new OpenRouterPolicyError();
  }
  return policy;
};

const parseProviderPolicy = (serialized: string): unknown => {
  try {
    return JSON.parse(serialized) as unknown;
  } catch {
    // 設定値を例外に含めない。運用時に誤って秘密が混入してもログへ残さないため。
    throw new OpenRouterPolicyError();
  }
};

const resolveBaseUrl = (value: string): string => {
  const parsed = z.url({ protocol: /^https?$/ }).safeParse(value);
  if (!parsed.success) throw new OpenRouterPolicyError();
  const url = new URL(parsed.data);
  // Gateway の認証情報をURLへ埋めるとトレースに残るため、認証はAPIキーへ分離する。
  if (url.username || url.password || url.search || url.hash) throw new OpenRouterPolicyError();
  return parsed.data.replace(/\/+$/, "");
};

export const resolveOpenRouterRoute = (
  env: OpenRouterPolicyEnv,
  route: OpenRouterRoute = "primary",
): { model: string; provider: NonNullable<ChatOpenRouterInput["provider"]>; baseURL?: string } => {
  const primary = route === "primary";
  const model = primary
    ? (env.V2_MODEL ?? "deepseek/deepseek-v4.1-flash-1017")
    : route === "fallback-1"
      ? "deepseek/deepseek-v4.1-flash"
      : "cognitivecomputations/dolphin-mistral-24b-venice-edition";
  if (!model.trim()) throw new OpenRouterPolicyError();

  const provider = validateProviderPolicy(
    primary && env.V2_MODEL_PROVIDER !== undefined
      ? parseProviderPolicy(env.V2_MODEL_PROVIDER)
      : {
          ignore: ["DeepSeek"],
          data_collection: "deny",
          ...(route === "fallback-1" ? { only: ["Venice"], allow_fallbacks: false } : {}),
        },
  );

  return {
    model,
    provider,
    ...(env.V2_OPENROUTER_BASE_URL !== undefined
      ? { baseURL: resolveBaseUrl(env.V2_OPENROUTER_BASE_URL) }
      : {}),
  };
};
