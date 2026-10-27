import { afterEach, describe, expect, it, vi } from "vitest";

import {
  connectChatTurn,
  loadChatHistory,
  readChatSession,
  writeChatSession,
} from "./chat-session";

import type { PendingTurn } from "./chat-session";

const pending: PendingTurn = {
  characterId: "synthetic",
  conversationId: "synthetic-room",
  requestId: "synthetic-request",
  text: "合成の入力",
  baseTurn: 2,
};

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("chat session restoration", () => {
  it("会話とキャラクターが一致する送信だけを復元する", () => {
    writeChatSession("synthetic", { version: 1, conversationId: pending.conversationId, pending });
    expect(readChatSession("synthetic").pending).toEqual(pending);
    expect(readChatSession("other").pending).toBeNull();
    writeChatSession("synthetic", { version: 1, conversationId: "other-room", pending });
    expect(readChatSession("synthetic").pending).toBeNull();
  });

  it("再試行不可の保存済み送信では通信を始めない", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      connectChatTurn(
        { ...pending, terminalError: "合成の処理終了" },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ retryable: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("挨拶と連続assistantを配送のturnで対応付け、本文を二重表示しない", async () => {
    const delivery = (turn: number) => ({
      conversationId: pending.conversationId,
      turn,
      generationId: `synthetic-${turn}`,
      serverNow: 1000,
      chunks: [{ seq: 0, text: `配送${turn}`, scheduledAt: 2000 }],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          conversationId: pending.conversationId,
          turn: 4,
          history: [
            { role: "assistant", content: "挨拶の集約本文", turn: 1 },
            { role: "user", content: "合成の質問", turn: 2 },
            { role: "assistant", content: "返信の集約本文", turn: 2 },
            { role: "assistant", content: "追加の集約本文", turn: 3 },
          ],
          deliveries: [delivery(3), delivery(1), delivery(2)],
        }),
      ),
    );
    const result = await loadChatHistory(
      "synthetic",
      pending.conversationId,
      new AbortController().signal,
    );
    expect(result.nextTurn).toBe(4);
    expect(result.bubbles.map((bubble) => bubble.delivery?.turn)).toEqual([1, undefined, 2, 3]);
    expect(result.bubbles.map((bubble) => bubble.text)).toEqual(["", "合成の質問", "", ""]);
  });

  it("配送のturnを推測して本文を先出ししない", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          turn: 3,
          history: [{ role: "assistant", content: "予定前の本文" }],
          deliveries: [
            {
              conversationId: pending.conversationId,
              turn: 2,
              generationId: null,
              serverNow: 1000,
              chunks: [{ seq: 0, text: "予定前の本文", scheduledAt: 2000 }],
            },
          ],
        }),
      ),
    );
    await expect(
      loadChatHistory("synthetic", pending.conversationId, new AbortController().signal),
    ).rejects.toThrow("配送情報が一致しませんでした");
  });

  it("新APIの配送0件でもassistant本文へ代替しない", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          turn: 3,
          history: [{ role: "assistant", content: "配送欠落中の合成本文", turn: 2 }],
          deliveries: [],
        }),
      ),
    );
    await expect(
      loadChatHistory("synthetic", pending.conversationId, new AbortController().signal),
    ).rejects.toThrow("配送情報が一致しませんでした");
  });

  it("配送フィールドがない旧APIだけ本文をそのまま復元する", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          turn: 3,
          history: [{ role: "assistant", content: "合成の旧履歴" }],
        }),
      ),
    );
    expect(
      (await loadChatHistory("synthetic", pending.conversationId, new AbortController().signal))
        .bubbles[0].text,
    ).toBe("合成の旧履歴");
  });
});
