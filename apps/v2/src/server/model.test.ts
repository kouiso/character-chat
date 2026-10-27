// @vitest-environment node
import { FakeListChatModel } from "@langchain/core/utils/testing";
import { describe, expect, it, vi } from "vitest";

import { createRuntimeModel } from "./model";

import type * as EngineModule from "@v2/engine";

const builder = vi.hoisted(() => vi.fn());
vi.mock("@v2/engine", async (importOriginal) => ({
  ...(await importOriginal<typeof EngineModule>()),
  createOpenRouterFallbackModel: builder,
}));

describe("Worker model configuration boundary", () => {
  it("forwards the Worker Gateway and provider settings into the existing builder", () => {
    builder.mockClear();
    const env = {
      OPENROUTER_API_KEY: "synthetic-local-only",
      V2_MODEL: "synthetic/model",
      V2_MODEL_PROVIDER: '{"ignore":["DeepSeek"],"data_collection":"deny"}',
      V2_OPENROUTER_BASE_URL: "https://gateway.invalid/v1/synthetic",
    };
    createRuntimeModel(env);
    expect(builder).toHaveBeenCalledExactlyOnceWith(
      env,
      expect.objectContaining({ attemptTimeoutMs: 30_000 }),
    );
  });

  it("enables the fake model only in an explicit test environment", () => {
    builder.mockClear();
    expect(createRuntimeModel({ APP_ENV: "test", V2_FAKE_MODEL: "1" })).toBeInstanceOf(
      FakeListChatModel,
    );
    expect(builder).not.toHaveBeenCalled();
  });

  it.each([undefined, "development", "production"])(
    "does not enable the fake model in %s",
    (APP_ENV) => {
      builder.mockClear();
      createRuntimeModel({ APP_ENV, V2_FAKE_MODEL: "1", OPENROUTER_API_KEY: "synthetic" });
      expect(builder).toHaveBeenCalledOnce();
    },
  );

  it("records the configured per-attempt timeout in the wrapper policy", () => {
    builder.mockClear();
    createRuntimeModel({ OPENROUTER_API_KEY: "synthetic", V2_MODEL_ATTEMPT_TIMEOUT_MS: "1200" });
    expect(builder.mock.calls[0][1].attemptTimeoutMs).toBe(1200);
  });

  it.each(["", "0", "-1", "1.5", "2147483648", "invalid"])(
    "rejects invalid timeout %s before constructing a provider",
    (value) => {
      builder.mockClear();
      expect(() => createRuntimeModel({ V2_MODEL_ATTEMPT_TIMEOUT_MS: value })).toThrow(
        "時間切れ設定",
      );
      expect(builder).not.toHaveBeenCalled();
    },
  );
});
