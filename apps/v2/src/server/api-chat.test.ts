// @vitest-environment node
import { DEFAULT_CONTEXT_BUDGET } from "@v2/engine";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MAX_MESSAGE_LENGTH } from "../lib/chat-limits";

import type * as V2Db from "@v2/db";

import type * as Engine from "./engine";
import type { JobPeek } from "./chat-room";

const submit = vi.hoisted(() => vi.fn());
const usageLimit = vi.hoisted(() => vi.fn(async () => ({ allowed: true, limit: 300, used: 0 })));
const platform = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
const roomStop = vi.hoisted(() => vi.fn());
const roomPeek = vi.hoisted(() => vi.fn(async (): Promise<JobPeek | null> => null));
const roomWake = vi.hoisted(() => vi.fn(async () => undefined));
const truncate = vi.hoisted(() => vi.fn());
const deleteVectors = vi.hoisted(() => vi.fn(async () => undefined));
const loadHistory = vi.hoisted(() =>
  vi.fn(async () => ({ conversationId: "conv", turn: 1, history: [] })),
);

vi.mock("./platform", () => ({ getPlatform: async () => platform }));
vi.mock("./usage-limit", () => ({ checkDailyTurnLimit: usageLimit }));
vi.mock("./memory-reset", () => ({ deleteMemoryVectors: deleteVectors }));
vi.mock("@v2/db", async (importOriginal) => ({
  ...(await importOriginal<typeof V2Db>()),
  createDb: () => ({}),
  truncateAssistantReply: truncate,
}));
vi.mock("./engine", async (importOriginal) => ({
  ...(await importOriginal<typeof Engine>()),
  loadHistory,
}));

const { handleChatRequest, handleStopRequest } = await import("./api-chat");

const post = () =>
  handleChatRequest(
    "c",
    new Request("https://example.com/api/chat/c", {
      method: "POST",
      body: JSON.stringify({ conversationId: "conv", requestId: "r1", text: "今" }),
    }),
  );

const stop = (shownSeq: number | null = null) =>
  handleStopRequest(
    "c",
    new Request("https://example.com/api/chat/c/stop", {
      method: "POST",
      body: JSON.stringify({ conversationId: "conv", requestId: "r1", shownSeq }),
    }),
  );

beforeEach(() => {
  submit.mockReset();
  submit.mockResolvedValue({ status: "busy", requestId: "r1" });
  usageLimit.mockClear();
  usageLimit.mockResolvedValue({ allowed: true, limit: 300, used: 0 });
  roomStop.mockReset();
  roomPeek.mockReset();
  roomPeek.mockResolvedValue(null);
  roomWake.mockClear();
  truncate.mockReset();
  deleteVectors.mockClear();
  loadHistory.mockClear();
  loadHistory.mockResolvedValue({ conversationId: "conv", turn: 1, history: [] });
});

const envWith = (vars: Record<string, unknown>) => ({
  CHAT_ROOMS: {
    getByName: () => ({
      submit,
      // 使いすぎ止めの前に「部屋に同じ受付が在るか」、busy の返事に「走っとる受付」を聞く口。
      peek: roomPeek,
      current: vi.fn(async () => null),
      stop: roomStop,
      wake: roomWake,
    }),
  },
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
      // 記録は出来事と例外クラス名だけ。設定の誤りを説明する例外の message は出さん。
      const logged = error.mock.calls.flat().join(" ");
      expect(JSON.parse(String(error.mock.calls[0]?.[0]))).toMatchObject({
        event: "context_budget_config_invalid",
        reason: "unexpected:ContextBudgetConfigError",
      });
      expect(logged).not.toContain("V2_HISTORY_MESSAGES");
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

// T-1: 部屋の返事をそのまま画面へ写す。missing は 404、already_failed は failed。
describe("POST /api/chat/:id/stop の部屋の返事の写し方（T-1）", () => {
  it.each([
    ["stopped", "stopped"],
    ["already_failed", "failed"],
  ])("部屋が %s と答えたら outcome %s を返す", async (roomOutcome, outcome) => {
    platform.env = envWith({});
    // peek null の道は「印を書く stop」と「結果を聞く stop」の 2 回呼ばれる。
    roomStop.mockResolvedValue({ outcome: roomOutcome, turn: 2 });
    const response = await stop();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ outcome, turn: 2 });
    expect(roomStop).toHaveBeenCalledWith("r1");
    expect(truncate).not.toHaveBeenCalled();
  });

  it("部屋に受付が無い（missing）なら 404 で、後処理は呼ばん", async () => {
    platform.env = envWith({});
    roomStop.mockResolvedValue({ outcome: "missing", turn: null });
    const response = await stop();
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "missing" });
    expect(truncate).not.toHaveBeenCalled();
    expect(roomWake).not.toHaveBeenCalled();
  });
});

// T-2: 送信の受付が保存済みだった場合だけ切り詰める。切れた時だけ記憶を戻して部屋を起こす。
describe("POST /api/chat/:id/stop の保存済みの後片付け（T-2）", () => {
  it("send が保存済みで画面に出てない塊があるなら切り詰め、記憶を pending へ戻して部屋を起こす", async () => {
    platform.env = envWith({});
    roomPeek.mockResolvedValue({
      requestId: "r1",
      status: "succeeded",
      turn: 2,
      kind: "send",
      failureCode: null,
    });
    roomStop.mockResolvedValue({ outcome: "already_saved", turn: 2 });
    truncate.mockResolvedValue({ truncated: true, removedMemories: [{ id: "mem-1" }] });
    const response = await stop(1);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ outcome: "truncated", turn: 2 });
    expect(truncate).toHaveBeenCalledOnce();
    expect(deleteVectors).toHaveBeenCalledOnce();
    expect(roomWake).toHaveBeenCalledOnce();
  });

  it("送った塊が全部画面に出てるなら saved のまま、記憶の後処理も起こしも要らん", async () => {
    platform.env = envWith({});
    roomPeek.mockResolvedValue({
      requestId: "r1",
      status: "succeeded",
      turn: 2,
      kind: "send",
      failureCode: null,
    });
    roomStop.mockResolvedValue({ outcome: "already_saved", turn: 2 });
    truncate.mockResolvedValue({ truncated: false, removedMemories: [] });
    const response = await stop();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ outcome: "saved", turn: 2 });
    expect(deleteVectors).not.toHaveBeenCalled();
    expect(roomWake).not.toHaveBeenCalled();
  });

  it("再生成の受付が保存済みなら触らず saved を返す", async () => {
    platform.env = envWith({});
    roomPeek.mockResolvedValue({
      requestId: "r1",
      status: "succeeded",
      turn: 2,
      kind: "regenerate",
      failureCode: null,
    });
    roomStop.mockResolvedValue({ outcome: "already_saved", turn: 2 });
    const response = await stop();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ outcome: "saved", turn: 2 });
    expect(truncate).not.toHaveBeenCalled();
  });

  it("切り詰め自体に失敗したら 503 で、止めた事実は隠さん", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    platform.env = envWith({});
    roomPeek.mockResolvedValue({
      requestId: "r1",
      status: "succeeded",
      turn: 2,
      kind: "send",
      failureCode: null,
    });
    roomStop.mockResolvedValue({ outcome: "already_saved", turn: 2 });
    truncate.mockRejectedValue(new Error("d1 down"));
    const response = await stop();
    expect(response.status).toBe(503);
    expect(roomWake).not.toHaveBeenCalled();
    error.mockRestore();
  });
});

// T-3: 境界と入力の検証。他人の会話は 404、shownSeq の不正は 400。
describe("POST /api/chat/:id/stop の境界と入力（T-3）", () => {
  it("URL のキャラと会話が噛み合わんなら 404 で、部屋も D1 も呼ばん", async () => {
    const { ConversationAccessError } = await import("@v2/db");
    loadHistory.mockRejectedValue(new ConversationAccessError());
    platform.env = envWith({});
    const response = await stop();
    expect(response.status).toBe(404);
    expect(roomStop).not.toHaveBeenCalled();
    expect(truncate).not.toHaveBeenCalled();
  });

  it.each([["-1"], ["1.5"]])("shownSeq が %s なら 400 で、部屋は呼ばん", async (value) => {
    platform.env = envWith({});
    const response = await stop(Number(value));
    expect(response.status).toBe(400);
    expect(roomStop).not.toHaveBeenCalled();
  });
});
