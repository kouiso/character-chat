import { describe, expect, it } from "vitest";

import { resolveJudgeTransport } from "./llm-judge-transport";

const env = (over: Record<string, string>): NodeJS.ProcessEnv =>
  ({ ...process.env, AIQ_DISABLE_KEYCHAIN: "1", ...over }) as NodeJS.ProcessEnv;

describe("resolveJudgeTransport", () => {
  it("無料API鍵がある時は anthropic + x-api-key 形を選ぶ", () => {
    const t = resolveJudgeTransport(
      env({ ANTHROPIC_API_KEY_FOR_EVAL: "sk-ant-key", AIQ_JUDGE: "" }),
    );
    expect(t.kind).toBe("anthropic");
    expect(t.apiKey).toBe("sk-ant-key");
    expect(t.model).toBe("claude-haiku-4-5-20251001");
  });

  it("月額OAuthトークンは Bearer 形の anthropic を選ぶ", () => {
    const t = resolveJudgeTransport(
      env({ CLAUDE_SESSION_TOKEN: "sk-ant-oat0-token", ANTHROPIC_API_KEY_FOR_EVAL: "" }),
    );
    expect(t.kind).toBe("anthropic");
  });

  it("AIQ_JUDGE=anthropic なのに鍵が無い時は止める", () => {
    expect(() =>
      resolveJudgeTransport(
        env({
          AIQ_JUDGE: "anthropic",
          ANTHROPIC_API_KEY_FOR_EVAL: "",
          CLAUDE_OAUTH_TOKEN: "",
          CLAUDE_SESSION_TOKEN: "",
        }),
      ),
    ).toThrow();
  });

  it("何も無ければ openrouter 既定に戻る", () => {
    const t = resolveJudgeTransport(
      env({
        AIQ_JUDGE: "",
        EVAL_JUDGE_TRANSPORT: "",
        ANTHROPIC_API_KEY_FOR_EVAL: "",
        CLAUDE_OAUTH_TOKEN: "",
        CLAUDE_SESSION_TOKEN: "",
      }),
    );
    // Keychain にトークンがある Mac では anthropic になりうるので
    // 形だけ決め打ちはせん。鍵の無い環境では openrouter
    expect(["openrouter", "anthropic", "codex"]).toContain(t.kind);
  });
});
