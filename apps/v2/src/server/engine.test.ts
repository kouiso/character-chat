// @vitest-environment node
import { buildConversationContext, DEFAULT_CONTEXT_BUDGET, type ContextBudget } from "@v2/engine";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as V2Db from "@v2/db";
import type * as V2Engine from "@v2/engine";

const platform = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
const captured = vi.hoisted(() => ({ budget: undefined as Partial<ContextBudget> | undefined }));
const versionState = vi.hoisted(() => ({ available: true, calls: [] as string[] }));

vi.mock("./platform", () => ({ getPlatform: async () => platform }));
vi.mock("./character-data.server", () => ({
  readCharacter: async () => ({
    ok: { id: "c", name: "案内役", systemPrompt: "丁寧に話す。", greeting: "こんにちは。" },
    failures: [],
  }),
}));
vi.mock("@v2/db", async (importOriginal) => ({
  ...(await importOriginal<typeof V2Db>()),
  createDb: () => ({}),
  createD1TurnStore: () => ({}),
  ensureCurrentVersion: async () => {
    versionState.calls.push("ensure-current");
    return { versionId: "version-1", revision: 1 };
  },
  ensureConversationVersion: async () => {
    versionState.calls.push("pin-conversation");
    return "version-1";
  },
  loadVersionedCharacter: async () => {
    versionState.calls.push("load-pinned");
    return versionState.available
      ? {
          characterId: "c",
          content: {
            name: "案内役",
            bio: "",
            personality: "丁寧に話す。",
            speechStyle: "穏やか。",
            appearance: "",
            background: "",
            worldSetting: "",
            prologue: "",
            greeting: "こんにちは。",
            privateNotes: "",
            tags: [],
            voiceRef: null,
            avatarRef: null,
            visibility: "private",
          },
        }
      : null;
  },
}));
vi.mock("@v2/engine", async (importOriginal) => ({
  ...(await importOriginal<typeof V2Engine>()),
  createTurnGraph: (deps: { contextBudget?: Partial<ContextBudget> }) => {
    versionState.calls.push("create-graph");
    captured.budget = deps.contextBudget;
    return {};
  },
  runTurn: async function* () {},
}));

const { CharacterNotFoundError, startTurn } = await import("./engine");

const start = () => startTurn({ characterId: "c", conversationId: "conv", text: "今" });

beforeEach(() => {
  captured.budget = undefined;
  versionState.available = true;
  versionState.calls = [];
});

describe("startTurn の履歴予算", () => {
  it.each([
    ["vars を持たない環境（env.staging など）", {}],
    ["空文字", { V2_HISTORY_CHARACTERS: "", V2_HISTORY_MESSAGES: "" }],
  ])("%s では既定値でターンを組める", async (_label, vars) => {
    platform.env = { APP_ENV: "test", V2_FAKE_MODEL: "1", ...vars };
    await start();
    expect({ ...DEFAULT_CONTEXT_BUDGET, ...captured.budget }).toEqual(DEFAULT_CONTEXT_BUDGET);
    expect(() => buildConversationContext([], "今", captured.budget)).not.toThrow();
  });

  it("wrangler.jsonc の数値をそのまま使う", async () => {
    platform.env = {
      APP_ENV: "test",
      V2_FAKE_MODEL: "1",
      V2_HISTORY_CHARACTERS: 300,
      V2_HISTORY_MESSAGES: 6,
    };
    await start();
    expect(captured.budget).toEqual({ historyCharacters: 300, historyMessages: 6 });
  });

  it("fixed conversation の版が欠落していれば最新 character へフォールバックしない", async () => {
    platform.env = { APP_ENV: "test", V2_FAKE_MODEL: "1" };
    versionState.available = false;
    await expect(start()).rejects.toBeInstanceOf(CharacterNotFoundError);
    expect(versionState.calls).toEqual(["ensure-current", "pin-conversation", "load-pinned"]);
  });

  it("pins the conversation version before creating the generation graph", async () => {
    platform.env = { APP_ENV: "test", V2_FAKE_MODEL: "1" };
    await start();
    expect(versionState.calls).toEqual([
      "ensure-current",
      "pin-conversation",
      "load-pinned",
      "create-graph",
    ]);
  });
});
