import { FakeListChatModel } from "@langchain/core/utils/testing";
import { createOpenRouterFallbackModel, hardRefusalDetect, streamedCharCap } from "@v2/engine";
import { targetCharsForPhase } from "@v2/prompt";

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { ModelEnv } from "@v2/engine";
import type { FallbackModelOptions } from "@v2/engine";

export type RuntimeModelEnv = ModelEnv & {
  APP_ENV?: string;
  V2_FAKE_MODEL?: string;
  V2_MODEL_ATTEMPT_TIMEOUT_MS?: string;
};

const DEFAULT_ATTEMPT_TIMEOUT_MS = 30_000;
const phases = ["conversation", "intimate", "erotic", "climax", "afterglow"] as const;
const MAX_OUTPUT_CHARS = Math.max(
  ...phases.map((phase) => streamedCharCap(targetCharsForPhase(phase))),
);

const attemptTimeout = (value: string | undefined): number => {
  if (value === undefined) return DEFAULT_ATTEMPT_TIMEOUT_MS;
  const number = /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(number) || number <= 0 || number > 2_147_483_647) {
    throw new Error("モデルの時間切れ設定は正の整数で指定してください");
  }
  return number;
};

const FAKE_RESPONSE =
  "<response><action>合成データの確認を終える。</action><dialogue>ローカル試験用の返信です。</dialogue><inner>試験の続行を確認する。</inner></response>";

export const createRuntimeModel = (
  env: RuntimeModelEnv,
  audit: Pick<FallbackModelOptions, "onAttempt"> = {},
): BaseChatModel => {
  // 開発フラグだけで本番の応答を固定値へ置き換えない。
  if (env.APP_ENV === "test" && env.V2_FAKE_MODEL === "1") {
    return new FakeListChatModel({ responses: [FAKE_RESPONSE] });
  }
  return createOpenRouterFallbackModel(
    {
      OPENROUTER_API_KEY: env.OPENROUTER_API_KEY,
      V2_MODEL: env.V2_MODEL,
      V2_MODEL_PROVIDER: env.V2_MODEL_PROVIDER,
      V2_OPENROUTER_BASE_URL: env.V2_OPENROUTER_BASE_URL,
    },
    {
      attemptTimeoutMs: attemptTimeout(env.V2_MODEL_ATTEMPT_TIMEOUT_MS),
      maxOutputChars: MAX_OUTPUT_CHARS,
      isRefusal: hardRefusalDetect,
      ...audit,
    },
  );
};
