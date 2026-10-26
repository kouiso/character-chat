import { afterEach, describe, expect, it } from "vitest";

import { readChatEvents, readChatSession, writeChatSession } from "./chat-session";

describe("再開する会話の端末保存", () => {
  afterEach(() => localStorage.clear());

  it("受付番号と入力を保持し別キャラに渡さない", () => {
    const session = {
      version: 1 as const,
      conversationId: "conversation-a",
      pending: {
        characterId: "a",
        conversationId: "conversation-a",
        requestId: "request-a",
        text: "こんにちは",
        baseTurn: 1,
      },
    };
    writeChatSession("a", session);
    expect(readChatSession("a")).toEqual(session);
    expect(readChatSession("b").pending).toBeNull();
    localStorage.setItem("v2-chat-session:b", JSON.stringify(session));
    expect(readChatSession("b").pending).toBeNull();
  });

  it("壊れた保存データは送信しない", () => {
    localStorage.setItem("v2-chat-session:a", "{broken");
    expect(readChatSession("a")).toEqual({ version: 1, conversationId: null, pending: null });
  });

  it("UTF-8とSSE区切りをまたぐ通信を復元する", async () => {
    const bytes = new TextEncoder().encode(
      'id: 1\nevent: token\ndata: {"text":"こんにちは"}\n\nid: 2\nevent: done\ndata: {"conversationId":"a","turn":1,"generationId":null}\n\n',
    );
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
        controller.close();
      },
    });
    const events = [];
    for await (const event of readChatEvents(stream)) events.push(event);
    expect(events).toEqual([
      { type: "token", text: "こんにちは" },
      { type: "done", conversationId: "a", turn: 1, generationId: null },
    ]);
  });
});
