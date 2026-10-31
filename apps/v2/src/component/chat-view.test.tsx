import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { readChatSession, writeChatSession } from "../lib/chat-session";

import { ChatView } from "./chat-view";

describe("ChatView", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  it("キャラ名と入力フォームを描画する", () => {
    render(<ChatView characterId="char-koharu-ex" characterName="小春" />);

    expect(screen.getByText("小春")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("メッセージを入力")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "送信" })).toBeDisabled();
  });

  it("送信失敗後に再起動しても同じ受付番号で再開する", async () => {
    const requests: Record<string, unknown>[] = [];
    let succeeded = false;
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        requests.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        if (requests.length === 1) return new Response("", { status: 503 });
        succeeded = true;
        return new Response(
          'id: 1\nevent: done\ndata: {"conversationId":"conversation-a","turn":1,"generationId":null}\n\n',
        );
      }
      return Response.json({
        turn: succeeded ? 2 : 1,
        history: succeeded
          ? [
              { role: "user", content: "こんにちは" },
              { role: "assistant", content: "こんにちは、お元気ですか。" },
            ]
          : [],
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const first = render(<ChatView characterId="a" characterName="案内役" />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "こんにちは" } });
    fireEvent.click(screen.getByRole("button", { name: "送信" }));
    await screen.findByRole("alert");
    const saved = readChatSession("a");
    expect(saved.pending?.text).toBe("こんにちは");
    expect(screen.queryByRole("button", { name: "入力に戻す" })).not.toBeInTheDocument();
    first.unmount();
    render(<ChatView characterId="a" characterName="案内役" />);
    await screen.findByText("こんにちは、お元気ですか。");
    await waitFor(() => expect(readChatSession("a").pending).toBeNull());
    expect(requests).toHaveLength(2);
    expect(requests[0].requestId).toEqual(requests[1].requestId);
    expect(requests[0].conversationId).toEqual(requests[1].conversationId);
    expect(screen.getAllByText("こんにちは")).toHaveLength(1);
  });
  it("挨拶と連続応答を含む既存履歴ではサーバーの次ターン番号を使う", async () => {
    localStorage.setItem(
      "v2-chat-session:a",
      JSON.stringify({ version: 1, conversationId: "another-conversation", pending: null }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "POST") return new Response("", { status: 503 });
        return Response.json({
          turn: 8,
          history: [
            { role: "assistant", content: "最初の挨拶" },
            { role: "user", content: "以前の質問" },
            { role: "assistant", content: "以前の応答" },
            { role: "assistant", content: "追加の応答" },
          ],
        });
      }),
    );
    render(<ChatView characterId="a" characterName="案内役" initialConversationId="legacy" />);
    await screen.findByText("追加の応答");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "新しい質問" } });
    fireEvent.click(screen.getByRole("button", { name: "送信" }));
    await screen.findByRole("alert");
    expect(readChatSession("a").pending?.baseTurn).toBe(8);
    expect(readChatSession("a").pending?.conversationId).toBe("legacy");
    expect(screen.getAllByText("新しい質問")).toHaveLength(1);
    expect(screen.getByText("最初の挨拶")).toBeInTheDocument();
  });

  it("端末に再生された最終失敗を入力へ戻し同じ会話で新しい受付番号を使う", async () => {
    const pending = {
      characterId: "a",
      conversationId: "conversation-a",
      requestId: "request-old",
      text: "保留中の質問",
      baseTurn: 1,
    };
    writeChatSession("a", { version: 1, conversationId: "conversation-a", pending });
    const requests: Record<string, unknown>[] = [];
    let historyCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "POST") {
          requests.push(JSON.parse(String(init.body)) as Record<string, unknown>);
          if (requests.length === 1) {
            return new Response(
              'event: error\ndata: {"message":"返信を完了できませんでした。入力に戻してください。","terminal":true}\n\n',
            );
          }
          return new Response(
            'event: done\ndata: {"conversationId":"conversation-a","turn":2,"generationId":null}\n\n',
          );
        }
        historyCalls += 1;
        if (historyCalls < 3) return Response.json({ turn: 1, history: [] });
        return Response.json({
          turn: 2,
          history: [
            { role: "user", content: "新しい質問" },
            { role: "assistant", content: "新しい応答" },
          ],
        });
      }),
    );

    render(<ChatView characterId="a" characterName="案内役" />);
    await screen.findByRole("button", { name: "入力に戻す" });
    fireEvent.click(screen.getByRole("button", { name: "入力に戻す" }));
    await waitFor(() => expect(readChatSession("a").pending).toBeNull());
    expect(screen.getByRole("textbox")).toHaveValue("保留中の質問");

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "新しい質問" } });
    fireEvent.click(screen.getByRole("button", { name: "送信" }));
    await screen.findByText("新しい応答");
    await waitFor(() => expect(readChatSession("a").pending).toBeNull());
    expect(requests).toHaveLength(2);
    expect(requests[0].requestId).toBe("request-old");
    expect(requests[1].requestId).not.toBe(requests[0].requestId);
    expect(requests[1].conversationId).toBe("conversation-a");
  });

  it("入力へ戻す保存に失敗したときは保留と復旧操作を残す", async () => {
    const pending = {
      characterId: "a",
      conversationId: "conversation-a",
      requestId: "request-old",
      text: "保留中の質問",
      baseTurn: 1,
    };
    writeChatSession("a", { version: 1, conversationId: "conversation-a", pending });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "POST") {
          return new Response(
            'event: error\ndata: {"message":"返信を完了できませんでした。入力に戻してください。","terminal":true}\n\n',
          );
        }
        return Response.json({ turn: 1, history: [] });
      }),
    );
    const originalRemoveItem = Storage.prototype.removeItem;
    let failPendingClear = true;
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation((key) => {
      if (failPendingClear && key === "v2-chat-pending:a:conversation-a") {
        failPendingClear = false;
        throw new Error("storage failure");
      }
      originalRemoveItem.call(localStorage, key);
    });

    render(<ChatView characterId="a" characterName="案内役" />);
    await screen.findByRole("button", { name: "入力に戻す" });
    fireEvent.click(screen.getByRole("button", { name: "入力に戻す" }));
    await screen.findByText("入力を戻せませんでした。再試行してください。");
    expect(readChatSession("a").pending).toEqual(pending);
    expect(screen.getByRole("button", { name: "入力に戻す" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "入力に戻す" }));
    await waitFor(() => expect(readChatSession("a").pending).toBeNull());
  });

  it("保存済みの会話Bで送信しても会話Aの保留を失わず、それぞれの会話で再開する", async () => {
    const pendingA = {
      characterId: "a",
      conversationId: "conversation-a",
      requestId: "request-a",
      text: "Aの保留",
      baseTurn: 1,
    };
    // 旧形式（キャラ単位の1件保存）のまま残った保留も読めることを兼ねて確かめる
    localStorage.setItem(
      "v2-chat-session:a",
      JSON.stringify({ version: 1, conversationId: "conversation-a", pending: pendingA }),
    );
    const requests: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "POST") {
          requests.push(JSON.parse(String(init.body)) as Record<string, unknown>);
          return new Response("", { status: 503 });
        }
        return Response.json({ turn: 1, history: [] });
      }),
    );

    const viewB = render(
      <ChatView characterId="a" characterName="案内役" initialConversationId="conversation-b" />,
    );
    await waitFor(() => expect(screen.getByRole("textbox")).toBeEnabled());
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Bの質問" } });
    fireEvent.click(screen.getByRole("button", { name: "送信" }));
    await screen.findByRole("alert");
    expect(readChatSession("a", "conversation-a").pending).toEqual(pendingA);
    expect(readChatSession("a", "conversation-b").pending?.text).toBe("Bの質問");
    viewB.unmount();

    const viewA = render(
      <ChatView characterId="a" characterName="案内役" initialConversationId="conversation-a" />,
    );
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1]).toMatchObject({ conversationId: "conversation-a", requestId: "request-a" });
    viewA.unmount();

    render(<ChatView characterId="a" characterName="案内役" />);
    await waitFor(() => expect(requests).toHaveLength(3));
    expect(requests[2]).toMatchObject({ conversationId: "conversation-b", text: "Bの質問" });
    expect(requests[2].requestId).toBe(requests[0].requestId);
  });

  it("画面を離れた会話Aの受信が後から終わっても会話Bの保存を書き換えない", async () => {
    const pendingA = {
      characterId: "a",
      conversationId: "conversation-a",
      requestId: "request-a",
      text: "Aの保留",
      baseTurn: 1,
    };
    writeChatSession("a", { version: 1, conversationId: "conversation-a", pending: pendingA });
    const finishA: { current: (() => void) | null } = { current: null };
    let postedA = false;
    const streamA = new ReadableStream<Uint8Array>({
      start(controller) {
        finishA.current = () => {
          controller.enqueue(
            new TextEncoder().encode(
              'event: done\ndata: {"conversationId":"conversation-a","turn":2,"generationId":null}\n\n',
            ),
          );
          controller.close();
        };
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "POST") {
          const body = JSON.parse(String(init.body)) as { conversationId: string };
          if (body.conversationId === "conversation-a") {
            postedA = true;
            return new Response(streamA);
          }
          return new Response("", { status: 503 });
        }
        if (String(url).includes("conversation-a"))
          return Response.json({
            turn: 2,
            history: [
              { role: "user", content: "Aの保留" },
              { role: "assistant", content: "Aの応答" },
            ],
          });
        return Response.json({ turn: 1, history: [] });
      }),
    );

    const viewA = render(<ChatView characterId="a" characterName="案内役" />);
    await waitFor(() => expect(postedA).toBe(true));
    viewA.unmount();
    render(
      <ChatView characterId="a" characterName="案内役" initialConversationId="conversation-b" />,
    );
    await waitFor(() => expect(screen.getByRole("textbox")).toBeEnabled());
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Bの質問" } });
    fireEvent.click(screen.getByRole("button", { name: "送信" }));
    await screen.findByRole("alert");
    finishA.current?.();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(readChatSession("a", "conversation-b").pending?.text).toBe("Bの質問");
    expect(readChatSession("a").conversationId).toBe("conversation-b");
    expect(readChatSession("a", "conversation-a").pending).toEqual(pendingA);
    expect(screen.queryByText("Aの応答")).not.toBeInTheDocument();
  });
});
