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

  it("新規会話の入口では前の会話を再開せず、再読込時は新しい保留を復元する", async () => {
    writeChatSession("a", { version: 1, conversationId: "old", pending: null });
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") return new Response(null, { status: 503 });
      return Response.json({ turn: 1, history: [] });
    });
    vi.stubGlobal("fetch", fetchMock);
    const first = render(
      <ChatView characterId="a" characterName="案内役" newConversationKey="fresh" />,
    );
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("textbox", { name: "メッセージ" }), {
      target: { value: "新しい会話" },
    });
    fireEvent.click(screen.getByRole("button", { name: "送信" }));
    await screen.findByRole("alert");
    const created = readChatSession("a");
    expect(created.conversationId).not.toBe("old");
    expect(localStorage.getItem("v2-new-chat:a:fresh")).toBe(created.conversationId);
    first.unmount();
    fetchMock.mockClear();
    render(<ChatView characterId="a" characterName="案内役" newConversationKey="fresh" />);
    await screen.findByRole("alert");
    expect(readChatSession("a").pending?.requestId).toBe(created.pending?.requestId);
    expect(fetchMock).toHaveBeenCalled();
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
    fireEvent.change(screen.getByRole("textbox", { name: "メッセージ" }), {
      target: { value: "こんにちは" },
    });
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
    fireEvent.change(screen.getByRole("textbox", { name: "メッセージ" }), {
      target: { value: "新しい質問" },
    });
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
    expect(screen.getByRole("textbox", { name: "メッセージ" })).toHaveValue("保留中の質問");

    fireEvent.change(screen.getByRole("textbox", { name: "メッセージ" }), {
      target: { value: "新しい質問" },
    });
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
    // removeItem を持つ側に刺す。Node 25 の差し替え（setup.ts）は自前のプロパティで持ち、
    // jsdom の Storage は prototype で持つ。
    const owner: Storage = Object.hasOwn(localStorage, "removeItem")
      ? localStorage
      : Storage.prototype;
    const originalRemoveItem = localStorage.removeItem.bind(localStorage);
    let failPendingClear = true;
    vi.spyOn(owner, "removeItem").mockImplementation((key) => {
      if (failPendingClear && key === "v2-chat-pending:a:conversation-a") {
        failPendingClear = false;
        throw new Error("storage failure");
      }
      originalRemoveItem(key);
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
    await waitFor(() => expect(screen.getByRole("textbox", { name: "メッセージ" })).toBeEnabled());
    fireEvent.change(screen.getByRole("textbox", { name: "メッセージ" }), {
      target: { value: "Bの質問" },
    });
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
    await waitFor(() => expect(screen.getByRole("textbox", { name: "メッセージ" })).toBeEnabled());
    fireEvent.change(screen.getByRole("textbox", { name: "メッセージ" }), {
      target: { value: "Bの質問" },
    });
    fireEvent.click(screen.getByRole("button", { name: "送信" }));
    await screen.findByRole("alert");
    finishA.current?.();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(readChatSession("a", "conversation-b").pending?.text).toBe("Bの質問");
    expect(readChatSession("a").conversationId).toBe("conversation-b");
    expect(readChatSession("a", "conversation-a").pending).toEqual(pendingA);
    expect(screen.queryByText("Aの応答")).not.toBeInTheDocument();
  });

  const TERMINAL_ERROR =
    'event: error\ndata: {"message":"返信を完了できませんでした。入力に戻してください。","terminal":true}\n\n';
  const PRIOR = [
    { role: "user", content: "前の質問" },
    { role: "assistant", content: "前の応答" },
  ];
  const renderTerminalFailure = (
    history: () => Response | Promise<Response>,
    baseTurn = 2,
  ): void => {
    const pending = {
      characterId: "a",
      conversationId: "conversation-a",
      requestId: "request-old",
      text: "失敗した質問",
      baseTurn,
    };
    writeChatSession("a", { version: 1, conversationId: "conversation-a", pending });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) =>
        init?.method === "POST" ? new Response(TERMINAL_ERROR) : history(),
      ),
    );
    render(<ChatView characterId="a" characterName="案内役" />);
  };

  it("最終失敗の次ターン番号が送信時と同じなら入力へ戻し、失敗ターンを履歴に残さない", async () => {
    renderTerminalFailure(() => Response.json({ turn: 2, history: PRIOR }));
    fireEvent.click(await screen.findByRole("button", { name: "入力に戻す" }));
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "メッセージ" })).toHaveValue("失敗した質問"),
    );
    expect(readChatSession("a").pending).toBeNull();
    expect(screen.getByText("前の応答")).toBeInTheDocument();
    expect(screen.queryByText("失敗した質問")).not.toBeInTheDocument();
    expect(document.querySelectorAll(".v2-bubble")).toHaveLength(2);
  });

  it("応答付きで保存済みなら入力へ戻さず保存済みの応答を残す", async () => {
    renderTerminalFailure(() =>
      Response.json({
        turn: 3,
        history: [
          ...PRIOR,
          { role: "user", content: "失敗した質問" },
          { role: "assistant", content: "届いていた応答" },
        ],
        storedTurn: { turn: 2, user: "失敗した質問", answered: true },
      }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "入力に戻す" }));
    await screen.findByText("届いていた応答");
    await waitFor(() => expect(readChatSession("a").pending).toBeNull());
    expect(screen.getByRole("textbox", { name: "メッセージ" })).toHaveValue("");
  });

  it("入力へ戻す途中で履歴を読めなければ保留を残し、再度押せば戻せる", async () => {
    let historyCalls = 0;
    renderTerminalFailure(() => {
      historyCalls += 1;
      // 1 回目は起動時の復元、2 回目が「入力に戻す」の読み込み。
      if (historyCalls === 2) return new Response("", { status: 500 });
      return Response.json({ turn: 2, history: PRIOR });
    });
    fireEvent.click(await screen.findByRole("button", { name: "入力に戻す" }));
    await screen.findByText("入力を戻せませんでした。再試行してください。");
    expect(readChatSession("a").pending?.requestId).toBe("request-old");
    expect(screen.getByRole("textbox", { name: "メッセージ" })).toHaveValue("");

    fireEvent.click(screen.getByRole("button", { name: "入力に戻す" }));
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "メッセージ" })).toHaveValue("失敗した質問"),
    );
    expect(readChatSession("a").pending).toBeNull();
  });

  it("番号が進んでいても、そのターンに残ったのが別の発言なら入力へ戻す", async () => {
    const urls: string[] = [];
    renderTerminalFailure(() =>
      Response.json({
        turn: 3,
        history: [
          ...PRIOR,
          { role: "user", content: "別のタブの質問" },
          { role: "assistant", content: "別のタブへの応答" },
        ],
        storedTurn: { turn: 2, user: "別のタブの質問", answered: true },
      }),
    );
    const fetchMock = vi.mocked(fetch);
    fireEvent.click(await screen.findByRole("button", { name: "入力に戻す" }));
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "メッセージ" })).toHaveValue("失敗した質問"),
    );
    for (const [url] of fetchMock.mock.calls) urls.push(String(url));
    expect(urls.some((url) => url.includes("requestId=request-old"))).toBe(true);
    expect(screen.getByText("別のタブへの応答")).toBeInTheDocument();
    expect(readChatSession("a").pending).toBeNull();
  });

  it("上限を超える長さの入力は送らず、保留にもせず入力を残す", async () => {
    const fetchMock = vi.fn(async () => Response.json({ turn: 1, history: [] }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ChatView characterId="a" characterName="案内役" />);
    const long = "あ".repeat(4001);
    fireEvent.change(screen.getByRole("textbox", { name: "メッセージ" }), {
      target: { value: long },
    });
    fireEvent.click(screen.getByRole("button", { name: "送信" }));
    await screen.findByText("4000字以内で送信してください。入力は保持されています。");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(readChatSession("a").pending).toBeNull();
    expect(screen.getByRole("textbox", { name: "メッセージ" })).toHaveValue(long);
  });

  it.each([
    [400, {}],
    [409, { code: "conflict" }],
  ])("送り直しても通らん拒否（%s）は再接続でなく入力に戻す道を出す", async (status, body) => {
    const pending = {
      characterId: "a",
      conversationId: "conversation-a",
      requestId: "request-old",
      text: "通らない質問",
      baseTurn: 1,
    };
    writeChatSession("a", { version: 1, conversationId: "conversation-a", pending });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) =>
        init?.method === "POST"
          ? Response.json({ message: "拒否", ...body }, { status })
          : Response.json({ turn: 1, history: [], storedTurn: null }),
      ),
    );
    render(<ChatView characterId="a" characterName="案内役" />);
    fireEvent.click(await screen.findByRole("button", { name: "入力に戻す" }));
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "メッセージ" })).toHaveValue("通らない質問"),
    );
    expect(readChatSession("a").pending).toBeNull();
  });

  it.each([[404], [422]])(
    "会話やキャラを読めん（%s）時も、保留に閉じ込めず送信文を入力欄へ戻せる",
    async (status) => {
      const pending = {
        characterId: "a",
        conversationId: "conversation-a",
        requestId: "request-old",
        text: "読めない会話への質問",
        baseTurn: 1,
      };
      writeChatSession("a", { version: 1, conversationId: "conversation-a", pending });
      // 本番と同じく、送信も履歴も同じ理由で同じ状態を返す。
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json({ message: "拒否" }, { status })),
      );
      render(<ChatView characterId="a" characterName="案内役" />);
      fireEvent.click(await screen.findByRole("button", { name: "入力に戻す" }));
      await waitFor(() =>
        expect(screen.getByRole("textbox", { name: "メッセージ" })).toHaveValue(
          "読めない会話への質問",
        ),
      );
      expect(readChatSession("a").pending).toBeNull();
      expect(
        screen.getByText("会話を読み込めませんでした。送信内容は入力欄に戻しました。"),
      ).toBeInTheDocument();
    },
  );

  it("別のタブが後から保留を入れたら、こちらの送信が終わってもその保留を消さない", async () => {
    let releasePost: () => void = () => undefined;
    const posted = new Promise<void>((resolve) => {
      releasePost = resolve;
    });
    const otherTab = {
      characterId: "a",
      conversationId: "conversation-b",
      requestId: "request-other-tab",
      text: "別のタブの質問",
      baseTurn: 1,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "POST") {
          await posted;
          return new Response(
            'event: done\ndata: {"conversationId":"conversation-a","turn":1,"generationId":null}\n\n',
          );
        }
        return Response.json({
          turn: 2,
          history: [
            { role: "user", content: "こちらの質問" },
            { role: "assistant", content: "こちらへの応答" },
          ],
        });
      }),
    );
    render(<ChatView characterId="a" characterName="案内役" />);
    fireEvent.change(screen.getByRole("textbox", { name: "メッセージ" }), {
      target: { value: "こちらの質問" },
    });
    fireEvent.click(screen.getByRole("button", { name: "送信" }));
    await waitFor(() => expect(readChatSession("a").pending?.text).toBe("こちらの質問"));
    writeChatSession("a", { version: 1, conversationId: "conversation-b", pending: otherTab });
    releasePost();
    await screen.findByText("こちらへの応答");
    expect(readChatSession("a")).toEqual({
      version: 1,
      conversationId: "conversation-b",
      pending: otherTab,
    });
  });

  it("同じ会話を開いた別のタブが保留を入れ直したら、こちらの送信が終わってもその保留を消さない", async () => {
    let releasePost: () => void = () => undefined;
    const posted = new Promise<void>((resolve) => {
      releasePost = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "POST") {
          await posted;
          return new Response(
            'event: done\ndata: {"conversationId":"conversation-a","turn":1,"generationId":null}\n\n',
          );
        }
        return Response.json({ turn: 1, history: [] });
      }),
    );
    writeChatSession("a", { version: 1, conversationId: "conversation-a", pending: null });
    render(<ChatView characterId="a" characterName="案内役" />);
    await waitFor(() => expect(screen.getByRole("textbox", { name: "メッセージ" })).toBeEnabled());
    fireEvent.change(screen.getByRole("textbox", { name: "メッセージ" }), {
      target: { value: "こちらの質問" },
    });
    fireEvent.click(screen.getByRole("button", { name: "送信" }));
    await waitFor(() => expect(readChatSession("a").pending?.text).toBe("こちらの質問"));
    const otherTab = {
      characterId: "a",
      conversationId: "conversation-a",
      requestId: "request-other-tab",
      text: "別のタブの質問",
      baseTurn: 1,
    };
    writeChatSession("a", { version: 1, conversationId: "conversation-a", pending: otherTab });
    releasePost();
    await waitFor(() => expect(screen.getByRole("textbox", { name: "メッセージ" })).toBeEnabled());
    expect(readChatSession("a", "conversation-a").pending).toEqual(otherTab);
  });

  it("完了した送信は、直後の履歴の読み直しが失敗しても保留に残さず、入力にも戻さない", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) =>
        init?.method === "POST"
          ? new Response(
              'event: chunk\ndata: {"seq":0,"text":"届いた返事"}\n\nevent: done\ndata: {"conversationId":"conversation-a","turn":1,"generationId":null}\n\n',
            )
          : Response.json({ message: "設定が壊れています" }, { status: 422 }),
      ),
    );
    render(<ChatView characterId="a" characterName="案内役" />);
    fireEvent.change(screen.getByRole("textbox", { name: "メッセージ" }), {
      target: { value: "届いた質問" },
    });
    fireEvent.click(screen.getByRole("button", { name: "送信" }));
    await screen.findByRole("alert");
    expect(readChatSession("a").pending).toBeNull();
    expect(screen.queryByRole("button", { name: "入力に戻す" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "メッセージ" })).toHaveValue("");
    expect(screen.getByText("届いた質問")).toBeInTheDocument();
  });

  it("再接続で完了だけが届き履歴を読めなくても、空の返信枠を残さない", async () => {
    const pending = {
      characterId: "a",
      conversationId: "conversation-a",
      requestId: "request-old",
      text: "前に送った質問",
      baseTurn: 1,
    };
    writeChatSession("a", { version: 1, conversationId: "conversation-a", pending });
    let historyCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "POST") {
          return new Response(
            'event: done\ndata: {"conversationId":"conversation-a","turn":1,"generationId":null}\n\n',
          );
        }
        historyCalls += 1;
        return historyCalls === 1
          ? Response.json({ turn: 1, history: [] })
          : new Response("", { status: 503 });
      }),
    );
    render(<ChatView characterId="a" characterName="案内役" />);
    await screen.findByRole("alert");
    expect(readChatSession("a").pending).toBeNull();
    expect(screen.getByText("前に送った質問")).toBeInTheDocument();
    expect(document.querySelectorAll(".v2-bubble.assistant")).toHaveLength(0);
  });

  it("まだ作成中の送信は入力へ戻さず、保留と再接続の道を残す", async () => {
    let historyCalls = 0;
    renderTerminalFailure(() => {
      historyCalls += 1;
      // 1 回目は起動時の復元、2 回目が「入力に戻す」の読み込み（作成中は 409 busy）。
      return historyCalls === 2
        ? Response.json({ code: "busy", message: "作成中" }, { status: 409 })
        : Response.json({ turn: 2, history: PRIOR });
    });
    fireEvent.click(await screen.findByRole("button", { name: "入力に戻す" }));
    await screen.findByText("返信をまだ作成中です。再接続してください。");
    expect(screen.getByRole("textbox", { name: "メッセージ" })).toHaveValue("");
    expect(readChatSession("a").pending?.requestId).toBe("request-old");
    expect(screen.getByRole("button", { name: "再接続・再試行" })).toBeInTheDocument();
  });

  it("通信が切れた時はブラウザの英語の文を出さず、再接続を促して保留を残す", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "POST") throw new TypeError("Failed to fetch");
        return Response.json({ turn: 1, history: [] });
      }),
    );
    render(<ChatView characterId="a" characterName="案内役" />);
    fireEvent.change(screen.getByRole("textbox", { name: "メッセージ" }), {
      target: { value: "届くかな" },
    });
    fireEvent.click(screen.getByRole("button", { name: "送信" }));
    await screen.findByText("通信が切れました。再接続してください。");
    expect(screen.queryByText(/Failed to fetch/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "再接続・再試行" })).toBeInTheDocument();
    expect(readChatSession("a").pending?.text).toBe("届くかな");
  });

  it("作成中で断られた送信（409 busy）は再試行の道を残す", async () => {
    const pending = {
      characterId: "a",
      conversationId: "conversation-a",
      requestId: "request-old",
      text: "待っている質問",
      baseTurn: 1,
    };
    writeChatSession("a", { version: 1, conversationId: "conversation-a", pending });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) =>
        init?.method === "POST"
          ? Response.json({ code: "busy", message: "作成中" }, { status: 409 })
          : Response.json({ turn: 1, history: [] }),
      ),
    );
    render(<ChatView characterId="a" characterName="案内役" />);
    await screen.findByRole("button", { name: "再接続・再試行" });
    expect(screen.queryByRole("button", { name: "入力に戻す" })).not.toBeInTheDocument();
    expect(readChatSession("a").pending?.requestId).toBe("request-old");
  });
});
