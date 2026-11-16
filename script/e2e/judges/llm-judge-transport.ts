import { execFileSync, spawnSync } from "node:child_process";

// judge の送り先は業者で違う（OpenRouter は Bearer 1本・Anthropic は x-api-key か
// OAuth Bearer・codex はコマンドが認証を持つ）。選ぶ順は
// 明示(AIQ_JUDGE/EVAL_JUDGE_TRANSPORT) → 無料API鍵 → 月額OAuth → Keychain → codex CLI →
// 既定の OpenRouter。CI では月額認証の再認証がだるいので ANTHROPIC_API_KEY_FOR_EVAL
// （Claude 無料API）だけを使う。

export type JudgeTransportKind = "openrouter" | "anthropic" | "codex";

export type JudgeTransport = {
  kind: JudgeTransportKind;
  apiKey: string;
  model: string;
  fetchImpl: typeof fetch;
  note: string;
};

const DEFAULT_ANTHROPIC_BASE_URL = "https://api.anthropic.com";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_ANTHROPIC_JUDGE_MODEL = "claude-haiku-4-5-20251001";

const firstNonEmpty = (env: NodeJS.ProcessEnv, names: readonly string[]): string | null => {
  for (const name of names) {
    const value = env[name];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return null;
};

// 月額 Claude の OAuth は Mac の Keychain に Claude Code が保管する。CI では使わん
// (テストでは AIQ_DISABLE_KEYCHAIN=1 で切る)
const readClaudeTokenFromKeychain = (env: NodeJS.ProcessEnv): string | null => {
  if (env.AIQ_DISABLE_KEYCHAIN === "1") return null;
  try {
    const raw = execFileSync(
      "security",
      ["find-generic-password", "-s", "Claude Code-credentials", "-w"],
      { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const token: unknown = Reflect.get(Reflect.get(parsed, "claudeAiOauth") ?? {}, "accessToken");
    return typeof token === "string" && token.startsWith("sk-ant-oat0") ? token : null;
  } catch {
    return null;
  }
};

const commandExists = (name: string): boolean =>
  spawnSync(name, ["--version"], { stdio: "ignore" }).status === 0;

type ChatMessage = { role: string; content: string };

const readChatBody = (body: unknown): { model: string; messages: ChatMessage[] } => {
  if (typeof body !== "string") return { model: "", messages: [] };
  const parsed: unknown = JSON.parse(body);
  if (typeof parsed !== "object" || parsed === null) return { model: "", messages: [] };
  const model: unknown = Reflect.get(parsed, "model");
  const messages: unknown = Reflect.get(parsed, "messages");
  return {
    model: typeof model === "string" ? model : "",
    messages: Array.isArray(messages) ? (messages as ChatMessage[]) : [],
  };
};

const openAiShape = (text: string): string =>
  JSON.stringify({ choices: [{ message: { content: text } }] });

// OpenAI chat/completions 形で来た要求を Anthropic /v1/messages 形に訳す橋。
// classifySubtextEscalation は OpenAI 形しか話せんので ここで形を揃える（SSOT）
const anthropicFetchImpl = (
  apiKey: string,
  header: "x-api-key" | "authorization",
): typeof fetch => {
  return (_input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    void _input;
    const { model, messages } = readChatBody(init?.body);
    const system = messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n");
    const userMessages = messages.filter((m) => m.role !== "system");
    const base = firstNonEmpty(process.env, ["ANTHROPIC_BASE_URL"]) ?? DEFAULT_ANTHROPIC_BASE_URL;
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "anthropic-version": ANTHROPIC_VERSION,
    };
    if (header === "x-api-key") headers["x-api-key"] = apiKey;
    else headers.authorization = `Bearer ${apiKey}`;
    return fetch(`${base}/v1/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        system: system.length > 0 ? system : undefined,
        messages: userMessages,
        max_tokens: 60,
        temperature: 0,
      }),
      signal: init?.signal ?? null,
    }).then(async (response) => {
      if (!response.ok) {
        const bodyText = await response.text().catch(() => "");
        return new Response(bodyText, { status: response.status });
      }
      const json: unknown = await response.json();
      const parts: unknown =
        typeof json === "object" && json !== null ? Reflect.get(json, "content") : undefined;
      const text = Array.isArray(parts)
        ? parts
            .map((part: unknown) =>
              typeof part === "object" && part !== null && Reflect.get(part, "type") === "text"
                ? String(Reflect.get(part, "text"))
                : "",
            )
            .join("")
        : "";
      return new Response(openAiShape(text), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
  };
};

// codex 月額は API 鍵ではなく codex コマンドが認証を持つ。`codex exec` の標準出力を
// OpenAI 形に包んで judge 側は形を意識せんで済む
const codexFetchImpl: typeof fetch = (
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
) => {
  void input;
  const { model, messages } = readChatBody(init?.body);
  const prompt = messages.map((m) => `${m.role}: ${m.content}`).join("\n\n");
  const args = [
    "exec",
    "--skip-git-repo-check",
    "--color",
    "never",
    ...(model.startsWith("gpt") ? ["--model", model] : []),
    "-",
  ];
  const result = spawnSync("codex", args, {
    input: prompt,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    timeout: 600_000,
  });
  if (result.status !== 0) {
    return Promise.resolve(
      new Response(JSON.stringify({ error: (result.stderr ?? "").slice(0, 2000) }), {
        status: 500,
      }),
    );
  }
  return Promise.resolve(
    new Response(openAiShape((result.stdout ?? "").trim()), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
};

const pickAnthropic = (
  apiKey: string,
  header: "x-api-key" | "authorization",
  env: NodeJS.ProcessEnv,
  note: string,
): JudgeTransport => ({
  kind: "anthropic",
  apiKey,
  model: firstNonEmpty(env, ["EVAL_JUDGE_MODEL"]) ?? DEFAULT_ANTHROPIC_JUDGE_MODEL,
  fetchImpl: anthropicFetchImpl(apiKey, header),
  note,
});

export const resolveJudgeTransport = (env: NodeJS.ProcessEnv): JudgeTransport => {
  const explicit = firstNonEmpty(env, ["AIQ_JUDGE", "EVAL_JUDGE_TRANSPORT"]);
  const judgeModel = firstNonEmpty(env, ["EVAL_JUDGE_MODEL"]);

  if (explicit === "openrouter") {
    return {
      kind: "openrouter",
      apiKey: firstNonEmpty(env, ["OPENROUTER_API_KEY"]) ?? "",
      model: judgeModel ?? "",
      fetchImpl: fetch,
      note: "明示: openrouter",
    };
  }

  const freeKey = firstNonEmpty(env, ["ANTHROPIC_API_KEY_FOR_EVAL"]);
  if (explicit === "anthropic" || (explicit === null && freeKey !== null)) {
    if (freeKey !== null) {
      return pickAnthropic(
        freeKey,
        "x-api-key",
        env,
        "ANTHROPIC_API_KEY_FOR_EVAL（Claude 無料API鍵）",
      );
    }
    const oauth = firstNonEmpty(env, ["CLAUDE_OAUTH_TOKEN", "CLAUDE_SESSION_TOKEN"]);
    if (oauth !== null) {
      return pickAnthropic(
        oauth,
        "authorization",
        env,
        "CLAUDE_OAUTH_TOKEN / CLAUDE_SESSION_TOKEN（Claude 月額認証）",
      );
    }
    const keychain = readClaudeTokenFromKeychain(env);
    if (keychain !== null) {
      return pickAnthropic(
        keychain,
        "authorization",
        env,
        "macOS Keychain の Claude Code 認証（月額）",
      );
    }
    if (explicit === "anthropic") {
      throw new Error(
        "AIQ_JUDGE=anthropic だが鍵が無い。ANTHROPIC_API_KEY_FOR_EVAL・CLAUDE_OAUTH_TOKEN・Keychain のどれも見つからん",
      );
    }
  }

  // codex だけを選ぶ明示はここで即決。自動選択は Claude 系（無料鍵→OAuth→Keychain）より後
  if (explicit === "codex") {
    return {
      kind: "codex",
      apiKey: "codex-cli",
      model: judgeModel ?? "gpt-5.1-codex-mini",
      fetchImpl: codexFetchImpl,
      note: "codex CLI（Codex 月額認証）",
    };
  }

  const oauth = firstNonEmpty(env, ["CLAUDE_OAUTH_TOKEN", "CLAUDE_SESSION_TOKEN"]);
  if (explicit === null && oauth !== null) {
    return pickAnthropic(
      oauth,
      "authorization",
      env,
      "CLAUDE_OAUTH_TOKEN / CLAUDE_SESSION_TOKEN（Claude 月額認証）",
    );
  }
  if (explicit === null) {
    const keychain = readClaudeTokenFromKeychain(env);
    if (keychain !== null) {
      return pickAnthropic(
        keychain,
        "authorization",
        env,
        "macOS Keychain の Claude Code 認証（月額）",
      );
    }
    if (commandExists("codex")) {
      return {
        kind: "codex",
        apiKey: "codex-cli",
        model: judgeModel ?? "gpt-5.1-codex-mini",
        fetchImpl: codexFetchImpl,
        note: "codex CLI（Codex 月額認証）",
      };
    }
  }

  return {
    kind: "openrouter",
    apiKey: firstNonEmpty(env, ["OPENROUTER_API_KEY"]) ?? "",
    model: judgeModel ?? "",
    fetchImpl: fetch,
    note: "既定: openrouter",
  };
};
