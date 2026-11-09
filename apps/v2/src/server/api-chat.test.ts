// @vitest-environment node
import { DEFAULT_CONTEXT_BUDGET } from "@v2/engine";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MAX_MESSAGE_LENGTH } from "../lib/chat-limits";

import type * as Engine from "./engine";

const submit = vi.hoisted(() => vi.fn());
const usageLimit = vi.hoisted(() => vi.fn(async () => ({ allowed: true, limit: 300, used: 0 })));
const platform = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));

vi.mock("./platform", () => ({ getPlatform: async () => platform }));
vi.mock("./usage-limit", () => ({ checkDailyTurnLimit: usageLimit }));
vi.mock("./engine", async (importOriginal) => ({
  ...(await importOriginal<typeof Engine>()),
  loadHistory: async () => ({ conversationId: "conv", turn: 1, history: [] }),
}));

const { handleChatRequest } = await import("./api-chat");

const post = () =>
  handleChatRequest(
    "c",
    new Request("https://example.com/api/chat/c", {
      method: "POST",
      body: JSON.stringify({ conversationId: "conv", requestId: "r1", text: "今" }),
    }),
  );

beforeEach(() => {
  submit.mockReset();
  submit.mockResolvedValue({ status: "busy", requestId: "r1" });
  usageLimit.mockClear();
  usageLimit.mockResolvedValue({ allowed: true, limit: 300, used: 0 });
});

const envWith = (vars: Record<string, unknown>) => ({
  CHAT_ROOMS: { getByName: () => ({ submit }) },
  ...vars,
});

describe("POST /api/chat の履歴予算設定", () => {
  it.each([["-1"], ["abc"], ["1.5"]])(
    "不正な値 %s では受け付けず、ジョブを積まずに設定エラーを返す",
    async (value) => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      platform.env = envWith({ V2_HISTORY_MESSAGES: value });
      const response = await post();
      expect(response.status).toBe(500);
      expect(submit).not.toHaveBeenCalled();
      expect(error.mock.calls.flat().join(" ")).toContain("V2_HISTORY_MESSAGES");
      error.mockRestore();
    },
  );

  it("未設定なら既定値のままジョブを受け付ける", async () => {
    platform.env = envWith({});
    await post();
    expect(submit).toHaveBeenCalledOnce();
  });
});

describe("送信文の上限", () => {
  // 画面・API・model へ渡す文脈の 3 か所で上限がずれると、どこかで受けた文が後ろで弾かれる。
  it("画面と API の上限は、model へ渡す現在の発言の予算と同じ", () => {
    expect(MAX_MESSAGE_LENGTH).toBe(DEFAULT_CONTEXT_BUDGET.currentMessageCharacters);
  });
});

describe("使いすぎ止め", () => {
  it("上限に達したら 429 で理由を返し、ジョブは積まれん", async () => {
    usageLimit.mockResolvedValue({ allowed: false, limit: 300, used: 300 });
    platform.env = envWith({});
    const response = await post();
    expect(response.status).toBe(429);
    expect(submit).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({
      code: "daily_limit",
      message: expect.stringContaining("300"),
    });
  });

  it("上限未満なら受け付ける", async () => {
    usageLimit.mockResolvedValue({ allowed: true, limit: 300, used: 299 });
    platform.env = envWith({});
    await post();
    expect(submit).toHaveBeenCalledOnce();
  });
});
