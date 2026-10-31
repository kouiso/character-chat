import { afterEach, describe, expect, it } from "vitest";

import {
  readChatEvents,
  readChatSession,
  writeActiveConversation,
  writeChatSession,
  writePendingTurn,
} from "./chat-session";

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

  it("保留を会話ごとに保持し、別会話の保存や完了で消さない", () => {
    const turn = (conversationId: string) => ({
      characterId: "a",
      conversationId,
      requestId: `request-${conversationId}`,
      text: `${conversationId}の質問`,
      baseTurn: 1,
    });
    writeChatSession("a", { version: 1, conversationId: "c1", pending: turn("c1") });
    writeChatSession("a", { version: 1, conversationId: "c2", pending: turn("c2") });
    expect(readChatSession("a")).toEqual({ version: 1, conversationId: "c2", pending: turn("c2") });
    expect(readChatSession("a", "c1").pending).toEqual(turn("c1"));

    writePendingTurn("a", "c1", null);
    expect(readChatSession("a", "c1")).toEqual({ version: 1, conversationId: "c1", pending: null });
    expect(readChatSession("a").conversationId).toBe("c2");
    expect(readChatSession("a", "c2").pending).toEqual(turn("c2"));
    expect(readChatSession("a", "c3").pending).toBeNull();
  });

  it("旧形式の保留を読み、会話を切り替えても失わず、完了後は蘇らせない", () => {
    const legacy = {
      characterId: "a",
      conversationId: "c1",
      requestId: "request-c1",
      text: "旧形式の保留",
      baseTurn: 3,
    };
    localStorage.setItem(
      "v2-chat-session:a",
      JSON.stringify({ version: 1, conversationId: "c1", pending: legacy }),
    );
    expect(readChatSession("a")).toEqual({ version: 1, conversationId: "c1", pending: legacy });
    expect(readChatSession("a", "c1").pending).toEqual(legacy);
    expect(readChatSession("a", "c2").pending).toBeNull();

    writeActiveConversation("a", "c2");
    expect(readChatSession("a").conversationId).toBe("c2");
    expect(readChatSession("a", "c1").pending).toEqual(legacy);

    writePendingTurn("a", "c1", null);
    expect(readChatSession("a", "c1").pending).toBeNull();
  });

  it("旧形式の保留を同じ会話で完了したら旧保存からも消す", () => {
    const legacy = {
      characterId: "a",
      conversationId: "c1",
      requestId: "request-c1",
      text: "旧形式の保留",
      baseTurn: 1,
    };
    localStorage.setItem(
      "v2-chat-session:a",
      JSON.stringify({ version: 1, conversationId: "c1", pending: legacy }),
    );
    writePendingTurn("a", "c1", null);
    expect(readChatSession("a")).toEqual({ version: 1, conversationId: "c1", pending: null });
  });

  it("会話の保存枠に別会話・別キャラの保留が入っていても使わない", () => {
    const foreign = {
      characterId: "b",
      conversationId: "c1",
      requestId: "request",
      text: "他キャラ",
      baseTurn: 1,
    };
    localStorage.setItem("v2-chat-pending:a:c1", JSON.stringify(foreign));
    localStorage.setItem(
      "v2-chat-pending:a:c2",
      JSON.stringify({ ...foreign, characterId: "a", conversationId: "c1" }),
    );
    localStorage.setItem("v2-chat-pending:a:c3", "{broken");
    expect(readChatSession("a", "c1").pending).toBeNull();
    expect(readChatSession("a", "c2").pending).toBeNull();
    expect(readChatSession("a", "c3").pending).toBeNull();
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
