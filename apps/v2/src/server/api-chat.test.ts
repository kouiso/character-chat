// @vitest-environment node
import { DEFAULT_CONTEXT_BUDGET } from "@v2/engine";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MAX_MESSAGE_LENGTH } from "../lib/chat-limits";

import type * as Engine from "./engine";

const submit = vi.hoisted(() => vi.fn());
const platform = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));

vi.mock("./platform", () => ({ getPlatform: async () => platform }));
vi.mock("./engine", async (importOriginal) => ({
  ...(await importOriginal<typeof Engine>()),
  loadHistory: async () => ({ conversationId: "conv", turn: 1, history: [] }),
}));

const { handleChatRequest, handleHistoryRequest } = await import("./api-chat");

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

it("履歴と一緒にサーバー時刻を返す", async () => {
  const before = Date.now();
  const response = await handleHistoryRequest(
    "c",
    new Request("https://example.com/api/chat/c/history?conversationId=conv"),
  );
  const body: { serverTime: number } = await response.json();
  expect(response.status).toBe(200);
  expect(body.serverTime).toBeGreaterThanOrEqual(before);
  expect(body.serverTime).toBeLessThanOrEqual(Date.now());
});
