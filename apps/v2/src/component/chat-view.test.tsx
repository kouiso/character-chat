import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    expect(screen.getByPlaceholderText("なに話す？")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "送信" })).toBeDisabled();
  });

  it("空の会話では「初回のひとこと」が冒頭に出て、送った後も残る", async () => {
    writeChatSession("a", { version: 1, conversationId: null, pending: null });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) =>
        init?.method === "POST"
          ? new Response(
              'id: 1\nevent: done\ndata: {"conversationId":"conversation-a","turn":1,"generationId":null}\n\n',
            )
          : Response.json({
              turn: 2,
              history: [
                { id: "m1", turn: 1, role: "user", content: "よろしく" },
                { id: "m2", turn: 1, role: "assistant", content: "よろしくね" },
              ],
            }),
      ),
    );
    render(
      <ChatView
        characterId="a"
        characterName="案内役"
        characterGreeting="はじめまして、案内役です"
      />,
    );
    expect(screen.getByText("はじめまして、案内役です")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "メッセージ" }), {
      target: { value: "よろしく" },
    });
    fireEvent.click(screen.getByRole("button", { name: "送信" }));
    await screen.findByText("よろしくね");
    expect(screen.getByText("はじめまして、案内役です")).toBeInTheDocument();
  });

  it("確定済みの発言がある会話を再開すると「初回のひとこと」は出さない", async () => {
    writeChatSession("a", {
      version: 1,
      conversationId: "conversation-a",
      pending: null,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          turn: 2,
          history: [
            { id: "m1", turn: 1, role: "user", content: "続き" },
            { id: "m2", turn: 1, role: "assistant", content: "うん" },
          ],
        }),
      ),
    );
    render(
      <ChatView
        characterId="a"
        characterName="案内役"
        characterGreeting="はじめまして、案内役です"
      />,
    );
    await screen.findByText("うん");
    expect(screen.queryByText("はじめまして、案内役です")).toBeNull();
  });

  it("音声ボタンは台詞レイヤにだけ出て、描写・心の声には出ない", async () => {
    writeChatSession("a", {
      version: 1,
      conversationId: "conversation-a",
      pending: null,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          turn: 2,
          history: [
            { id: "m1", turn: 1, role: "user", content: "ねえ" },
            {
              id: "m2",
              turn: 1,
              role: "assistant",
              content:
                "<action>小さく笑って近づく。</action><dialogue>こっち向いて。</dialogue><inner>ドキドキする。</inner>",
            },
          ],
        }),
      ),
    );
    render(<ChatView characterId="a" characterName="案内役" />);
    await screen.findByText("こっち向いて。");
    const dialogue = screen.getByRole("group", { name: "台詞" });
    expect(dialogue.querySelector('[aria-label="この返事を声で聞く"]')).not.toBeNull();
    const narration = screen.getByRole("group", { name: "描写" });
    const inner = screen.getByRole("group", { name: "心の声" });
    expect(narration.querySelector('[aria-label="この返事を声で聞く"]')).toBeNull();
    expect(inner.querySelector('[aria-label="この返事を声で聞く"]')).toBeNull();
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
    const attached: string[] = [];
    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const path = String(url);
      // 候補の自動取得は送りとは別口。受付の数えには入れん。
      if (path.endsWith("/suggest")) return Response.json({ suggestions: [] });
      if (init?.method === "POST") {
        requests.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        return new Response("", { status: 503 });
      }
      // 開き直しの受付の調べ: 受付は部屋に残っとる（並んで待っとる）と答える。
      if (path.includes("/turn?")) {
        const requestId = new URLSearchParams(path.split("?")[1]).get("requestId");
        return Response.json({
          active: null,
          request: {
            requestId,
            status: "queued",
            turn: 1,
            kind: "send",
          },
        });
      }
      // つなぎ直しの GET /events: 完了だけを配る。
      if (path.includes("/events?")) {
        attached.push(path);
        return new Response(
          'id: 1\nevent: done\ndata: {"conversationId":"conversation-a","turn":1,"generationId":null}\n\n',
        );
      }
      if (requests.length === 0 || attached.length === 0) {
        return Response.json({ turn: 1, history: [] });
      }
      return Response.json({
        turn: 2,
        history: [
          { id: "m-hello-user", turn: 1, role: "user", content: "こんにちは" },
          {
            id: "m-hello-assistant",
            turn: 1,
            role: "assistant",
            content: "こんにちは、お元気ですか。",
          },
        ],
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
    expect(screen.getByRole("button", { name: "入力に戻す" })).toBeInTheDocument();
    first.unmount();
    render(<ChatView characterId="a" characterName="案内役" />);
    await screen.findByText("こんにちは、お元気ですか。");
    await waitFor(() => expect(readChatSession("a").pending).toBeNull());
    // 開き直しは POST の送り直しやなく GET /events へのつなぎ直し。受付番号は変わらん。
    expect(requests).toHaveLength(1);
    expect(attached).toHaveLength(1);
    expect(attached[0]).toContain(`requestId=${requests[0].requestId}`);
    expect(attached[0]).toContain(`conversationId=${requests[0].conversationId}`);
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
            { id: "m-greeting", turn: 1, role: "assistant", content: "最初の挨拶" },
            { id: "m-prior-user", turn: 6, role: "user", content: "以前の質問" },
            { id: "m-prior-assistant", turn: 6, role: "assistant", content: "以前の応答" },
            { id: "m-extra-assistant", turn: 7, role: "assistant", content: "追加の応答" },
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
    const withdraws: Record<string, unknown>[] = [];
    let sentNew = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        const path = String(url);
        // 候補の自動取得は送りとは別口。受付の数えには入れん。
        if (path.endsWith("/suggest")) return Response.json({ suggestions: [] });
        if (init?.method === "POST" && path.endsWith("/withdraw")) {
          withdraws.push(JSON.parse(String(init.body)) as Record<string, unknown>);
          return Response.json({
            turn: 1,
            history: [],
            storedTurn: { turn: 1, user: "保留中の質問", answered: false },
          });
        }
        if (init?.method === "POST") {
          requests.push(JSON.parse(String(init.body)) as Record<string, unknown>);
          sentNew = true;
          return new Response(
            'event: done\ndata: {"conversationId":"conversation-a","turn":2,"generationId":null}\n\n',
          );
        }
        // 開き直しの受付の調べ: 確定的に断られた受付（入力に戻すの枠へ）。
        if (path.includes("/turn?")) {
          return Response.json({
            active: null,
            request: {
              requestId: "request-old",
              status: "failed",
              turn: 1,
              kind: "send",
              failureCode: "conflict",
            },
          });
        }
        if (!sentNew) return Response.json({ turn: 1, history: [] });
        return Response.json({
          turn: 2,
          history: [
            { id: "m-new-user", turn: 1, role: "user", content: "新しい質問" },
            { id: "m-new-assistant", turn: 1, role: "assistant", content: "新しい応答" },
          ],
        });
      }),
    );

    render(<ChatView characterId="a" characterName="案内役" />);
    await screen.findByRole("button", { name: "入力に戻す" });
    fireEvent.click(screen.getByRole("button", { name: "入力に戻す" }));
    await waitFor(() => expect(readChatSession("a").pending).toBeNull());
    expect(screen.getByRole("textbox", { name: "メッセージ" })).toHaveValue("保留中の質問");
    expect(withdraws).toEqual([{ conversationId: "conversation-a", requestId: "request-old" }]);

    fireEvent.change(screen.getByRole("textbox", { name: "メッセージ" }), {
      target: { value: "新しい質問" },
    });
    fireEvent.click(screen.getByRole("button", { name: "送信" }));
    await screen.findByText("新しい応答");
    await waitFor(() => expect(readChatSession("a").pending).toBeNull());
    expect(requests).toHaveLength(1);
    expect(requests[0].requestId).not.toBe("request-old");
    expect(requests[0].conversationId).toBe("conversation-a");
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
      vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        const path = String(url);
        if (init?.method === "POST" && path.endsWith("/withdraw")) {
          return Response.json({
            turn: 1,
            history: [],
            storedTurn: { turn: 1, user: "保留中の質問", answered: false },
          });
        }
        if (path.includes("/turn?")) {
          return Response.json({
            active: null,
            request: {
              requestId: "request-old",
              status: "failed",
              turn: 1,
              kind: "send",
              failureCode: "conflict",
            },
          });
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
    const attached: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        const path = String(url);
        // 候補の自動取得は送りとは別口。受付の数えには入れん。
        if (path.endsWith("/suggest")) return Response.json({ suggestions: [] });
        if (init?.method === "POST") {
          requests.push(JSON.parse(String(init.body)) as Record<string, unknown>);
          return new Response("", { status: 503 });
        }
        // 開き直しの受付の調べ: どの受付も部屋で待っとると答える。
        if (path.includes("/turn?")) {
          const query = new URLSearchParams(path.split("?")[1]);
          return Response.json({
            active: null,
            request: {
              requestId: query.get("requestId"),
              status: "queued",
              turn: 1,
              kind: "send",
            },
          });
        }
        // つなぎ直しの GET /events: 終わりが見えんまま開いておく（SSE は空のまま）。
        if (path.includes("/events?")) {
          attached.push(path);
          return new Response(new ReadableStream<Uint8Array>({ start: () => {} }));
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
    // 開き直しは GET /events へのつなぎ直し。POST の重複送信は起きん。
    await waitFor(() => expect(attached).toHaveLength(1));
    expect(attached[0]).toContain("conversationId=conversation-a");
    expect(attached[0]).toContain("requestId=request-a");
    viewA.unmount();

    render(<ChatView characterId="a" characterName="案内役" />);
    await waitFor(() => expect(attached).toHaveLength(2));
    expect(attached[1]).toContain("conversationId=conversation-b");
    expect(attached[1]).toContain(`requestId=${requests[0].requestId}`);
    expect(requests).toHaveLength(1);
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
    let attachedA = false;
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
        const path = String(url);
        if (init?.method === "POST") return new Response("", { status: 503 });
        if (path.includes("/turn?")) {
          const query = new URLSearchParams(path.split("?")[1]);
          return Response.json({
            active: null,
            request: {
              requestId: query.get("requestId"),
              status: "running",
              turn: 1,
              kind: "send",
            },
          });
        }
        // つなぎ直した A の受付の出来事を開いておく（終わりは試験がタイミングを決める）。
        if (path.includes("/events?") && path.includes("conversation-a")) {
          attachedA = true;
          return new Response(streamA);
        }
        if (path.includes("conversation-a"))
          return Response.json({
            turn: 2,
            history: [
              { id: "m-a-user", turn: 1, role: "user", content: "Aの保留" },
              { id: "m-a-assistant", turn: 1, role: "assistant", content: "Aの応答" },
            ],
          });
        return Response.json({ turn: 1, history: [] });
      }),
    );

    const viewA = render(<ChatView characterId="a" characterName="案内役" />);
    await waitFor(() => expect(attachedA).toBe(true));
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

  const PRIOR = [
    { id: "m-before-user", turn: 1, role: "user", content: "前の質問" },
    { id: "m-before-assistant", turn: 1, role: "assistant", content: "前の応答" },
  ];
  // 終わった失敗の受付が残った状態で開く。受付の調べは確定的な拒否（入力に戻すの枠）を返し、
  // 「入力に戻す」の取り下げ応答は試験ごとに渡す。
  const renderTerminalFailure = (
    withdraw: () => Response | Promise<Response>,
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
      vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        const path = String(url);
        if (init?.method === "POST" && path.endsWith("/withdraw")) return withdraw();
        // 作成中へつなぎ直す時の GET /events: 終わりが見えんまま開いておく。
        if (path.includes("/events?")) {
          return new Response(new ReadableStream<Uint8Array>({ start: () => {} }));
        }
        if (path.includes("/turn?")) {
          return Response.json({
            active: null,
            request: {
              requestId: "request-old",
              status: "failed",
              turn: 1,
              kind: "send",
              failureCode: "conflict",
            },
          });
        }
        // 履歴の読込後に印（RIT-204）も読みに来る。履歴の呼び出し回数を数える試験があるので分けて返す。
        if (path.includes("/marks")) return Response.json({ marks: [] });
        return Response.json({ turn: 2, history: PRIOR });
      }),
    );
    render(<ChatView characterId="a" characterName="案内役" />);
  };

  it("最終失敗の次ターン番号が送信時と同じなら入力へ戻し、失敗ターンを履歴に残さない", async () => {
    renderTerminalFailure(() =>
      Response.json({
        turn: 2,
        history: PRIOR,
        storedTurn: { turn: 2, user: "失敗した質問", answered: false },
      }),
    );
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
          { id: "m-failed-user", turn: 2, role: "user", content: "失敗した質問" },
          { id: "m-failed-assistant", turn: 2, role: "assistant", content: "届いていた応答" },
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
    let withdrawCalls = 0;
    renderTerminalFailure(() => {
      withdrawCalls += 1;
      if (withdrawCalls === 1) return new Response("", { status: 500 });
      return Response.json({
        turn: 2,
        history: PRIOR,
        storedTurn: { turn: 2, user: "失敗した質問", answered: false },
      });
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
    renderTerminalFailure(() =>
      Response.json({
        turn: 3,
        history: [
          ...PRIOR,
          { id: "m-other-tab-user", turn: 2, role: "user", content: "別のタブの質問" },
          { id: "m-other-tab-assistant", turn: 2, role: "assistant", content: "別のタブへの応答" },
        ],
        storedTurn: { turn: 2, user: "別のタブの質問", answered: true },
      }),
    );
    const fetchMock = vi.mocked(fetch);
    fireEvent.click(await screen.findByRole("button", { name: "入力に戻す" }));
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "メッセージ" })).toHaveValue("失敗した質問"),
    );
    // 取り下げは同じ受付番号で部屋へ届く。
    const withdrawBodies = fetchMock.mock.calls
      .filter(([url]) => String(url).endsWith("/withdraw"))
      .map(([, init]) => JSON.parse(String(init?.body)) as { requestId?: string });
    expect(withdrawBodies).toEqual([
      { conversationId: "conversation-a", requestId: "request-old" },
    ]);
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
    // 上限超えはカウンタの行が文を出す（板 TalkError・WORDING「文字数の上限」）。
    await screen.findByText(/メッセージは 4,000 文字までです。\s*いま 4,001 文字です。/);
    expect(screen.getByText("4,001 / 4,000")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(readChatSession("a").pending).toBeNull();
    expect(screen.getByRole("textbox", { name: "メッセージ" })).toHaveValue(long);
  });

  it.each([
    [400, {}],
    [409, { code: "conflict" }],
  ])("送り直しても通らん拒否（%s）は再接続でなく入力に戻す道を出す", async (status, body) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        const path = String(url);
        if (init?.method === "POST" && path.endsWith("/withdraw")) {
          return Response.json({
            turn: 1,
            history: [],
            storedTurn: { turn: 1, user: "通らない質問", answered: false },
          });
        }
        if (init?.method === "POST") {
          return Response.json({ message: "拒否", ...body }, { status });
        }
        return Response.json({ turn: 1, history: [] });
      }),
    );
    render(<ChatView characterId="a" characterName="案内役" />);
    fireEvent.change(screen.getByRole("textbox", { name: "メッセージ" }), {
      target: { value: "通らない質問" },
    });
    fireEvent.click(screen.getByRole("button", { name: "送信" }));
    // 確定的な拒否は「もう一度送れない時」の枠。出口は「入力に戻す」だけ。
    await screen.findByText("メッセージを送れませんでした。");
    expect(screen.queryByRole("button", { name: "もう一度" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "入力に戻す" }));
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
      await screen.findByText("会話を再開できませんでした。再試行してください。");
      fireEvent.click(screen.getByRole("button", { name: "入力に戻す" }));
      await waitFor(() =>
        expect(screen.getByRole("textbox", { name: "メッセージ" })).toHaveValue(
          "読めない会話への質問",
        ),
      );
      expect(readChatSession("a").pending).toBeNull();
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
            { id: "m-here-user", turn: 1, role: "user", content: "こちらの質問" },
            { id: "m-here-assistant", turn: 1, role: "assistant", content: "こちらへの応答" },
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
      vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        const path = String(url);
        if (init?.method === "POST") return new Response("", { status: 503 });
        if (path.includes("/turn?")) {
          return Response.json({
            active: null,
            request: { requestId: "request-old", status: "running", turn: 1, kind: "send" },
          });
        }
        // つなぎ直した受付は完了だけを配る（塊は来ない）。
        if (path.includes("/events?")) {
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
    // 取り下げを作成中（409）で断られた時は、その受付へつなぎ直して待ちの表示へ戻る。
    renderTerminalFailure(() =>
      Response.json({ code: "busy", message: "作成中" }, { status: 409 }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "入力に戻す" }));
    // 待ちの表示は板どおり「点 3 つの泡」。読み上げ名が「返事を書いています」。
    await screen.findByRole("status", { name: "返事を書いています" });
    expect(screen.getByRole("textbox", { name: "メッセージ" })).toHaveValue("");
    expect(readChatSession("a").pending?.requestId).toBe("request-old");
    expect(screen.getByRole("button", { name: "返事を止める" })).toBeInTheDocument();
  });

  it("通信が切れた時はブラウザの英語の文を出さず、送れなかった枠で保留を残す", async () => {
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
    await screen.findByText("メッセージを送れませんでした。");
    expect(screen.queryByText(/Failed to fetch/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "もう一度" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "入力に戻す" })).toBeInTheDocument();
    expect(readChatSession("a").pending?.text).toBe("届くかな");
  });

  it("作成中で断られた送信（409 busy）は文を入力へ戻してやり直せる", async () => {
    writeChatSession("a", { version: 1, conversationId: "conversation-a", pending: null });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "POST") {
          return Response.json({ code: "busy", message: "作成中" }, { status: 409 });
        }
        return Response.json({ turn: 1, history: [] });
      }),
    );
    render(<ChatView characterId="a" characterName="案内役" />);
    await waitFor(() => expect(screen.getByRole("textbox", { name: "メッセージ" })).toBeEnabled());
    fireEvent.change(screen.getByRole("textbox", { name: "メッセージ" }), {
      target: { value: "待っている質問" },
    });
    fireEvent.click(screen.getByRole("button", { name: "送信" }));
    // 別の受付が走っとるので受理されへん。文は入力へ戻り、出口は普通の「送信」。
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "メッセージ" })).toHaveValue("待っている質問"),
    );
    expect(readChatSession("a").pending).toBeNull();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "送信" })).toBeInTheDocument();
  });

  it("途中の失敗は「届かなかった」へ出し、「もう一度」の再送が確定的に断られたら入力に戻せる", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        const path = String(url);
        if (init?.method === "POST" && path.endsWith("/withdraw")) {
          return Response.json({
            turn: 1,
            history: [],
            storedTurn: { turn: 1, user: "届かん質問", answered: false },
          });
        }
        if (init?.method === "POST") {
          const retry = JSON.parse(String(init.body)) as { retry?: boolean };
          // 初回は途中の失敗（再試行できる印）、作り直し（retry:true）は確定的な拒否。
          return new Response(
            retry.retry === true
              ? 'event: error\ndata: {"code":"conflict","message":"返信を完了できませんでした。入力に戻してください。","terminal":true}\n\n'
              : 'event: error\ndata: {"message":"返信を完了できませんでした。再試行してください。","terminal":false}\n\n',
          );
        }
        return Response.json({ turn: 1, history: [] });
      }),
    );
    render(<ChatView characterId="a" characterName="案内役" />);
    fireEvent.change(screen.getByRole("textbox", { name: "メッセージ" }), {
      target: { value: "届かん質問" },
    });
    fireEvent.click(screen.getByRole("button", { name: "送信" }));

    // 途中の失敗は 5 分待たず「返事が届きませんでした。」へ出る。出口は「もう一度」だけ。
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("返事が届きませんでした。");
    expect(screen.queryByRole("button", { name: "入力に戻す" })).not.toBeInTheDocument();

    // 作り直しが確定的に断られたら「もう一度」は消えて「入力に戻す」だけ残る。
    fireEvent.click(screen.getByRole("button", { name: "もう一度" }));
    const rejected = await screen.findByRole("alert");
    await waitFor(() => expect(rejected).toHaveTextContent("このままでは送れません。"));
    fireEvent.click(await screen.findByRole("button", { name: "入力に戻す" }));
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "メッセージ" })).toHaveValue("届かん質問"),
    );
    expect(screen.getByRole("textbox", { name: "メッセージ" })).toBeEnabled();
    expect(readChatSession("a").pending).toBeNull();
  });

  it("部屋の試行が始まった印（attempt）で「返事を書いています」へ進み、止めるが出る", async () => {
    const encoder = new TextEncoder();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) =>
        init?.method === "POST"
          ? // attempt を届けたら流れはそのまま（生成が続いている途中）。
            new Response(
              new ReadableStream({
                start(controller) {
                  controller.enqueue(
                    encoder.encode('id: 1\nevent: attempt\ndata: {"attempt":1}\n\n'),
                  );
                },
              }),
            )
          : Response.json({ turn: 1, history: [] }),
      ),
    );
    render(<ChatView characterId="a" characterName="案内役" />);
    fireEvent.change(screen.getByRole("textbox", { name: "メッセージ" }), {
      target: { value: "書いてる途中" },
    });
    fireEvent.click(screen.getByRole("button", { name: "送信" }));

    await screen.findByRole("status", { name: "返事を書いています" });
    // 待ちの間は送信ボタンではなく「返事を止める」が出る。
    expect(screen.getByRole("button", { name: "返事を止める" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "送信" })).not.toBeInTheDocument();
  });

  it("塊が届いた後の失敗は「途中で止まった」へ出る（cut_off）", async () => {
    const judge = JSON.stringify({
      ok: true,
      reasons: [],
      warnings: [],
      checks: {
        ngram: { ok: true, ratio: 0, matchedPhrases: [], exactRepeat: false },
        nearDuplicate: { ok: true, matches: [] },
        voice: { ok: true, endingsMismatch: false },
        format: { ok: true },
        empty: { ok: true },
      },
    });
    const chunk = `event: chunk\ndata: {"seq":0,"text":"届きかけの返事","judge":${judge},"attempt":1,"preExtend":true}\n\n`;
    const failure =
      'event: error\ndata: {"code":"generation_failed","message":"返信を完了できませんでした。再試行してください。","terminal":false}\n\n';
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) =>
        init?.method === "POST"
          ? new Response(chunk + failure)
          : Response.json({ turn: 1, history: [] }),
      ),
    );
    render(<ChatView characterId="a" characterName="案内役" />);
    fireEvent.change(screen.getByRole("textbox", { name: "メッセージ" }), {
      target: { value: "途中で切れる質問" },
    });
    fireEvent.click(screen.getByRole("button", { name: "送信" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("返事が途中で止まりました。");
    // 届きかけの返事の救い方は「もう一度」（作り直し）だけ。
    expect(alert.querySelectorAll("button")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "もう一度" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "入力に戻す" })).not.toBeInTheDocument();
  });

  it("試行の上限（attempt_limit）の失敗は「もう一度送れない時」へ出る", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) =>
        init?.method === "POST"
          ? new Response(
              'event: error\ndata: {"code":"attempt_limit","message":"返信を完了できませんでした。入力に戻してください。","terminal":true}\n\n',
            )
          : Response.json({ turn: 1, history: [] }),
      ),
    );
    render(<ChatView characterId="a" characterName="案内役" />);
    fireEvent.change(screen.getByRole("textbox", { name: "メッセージ" }), {
      target: { value: "何度送っても届かん質問" },
    });
    fireEvent.click(screen.getByRole("button", { name: "送信" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("メッセージを送れませんでした。");
    expect(alert).toHaveTextContent("このままでは送れません。");
    expect(alert).toHaveTextContent("入力に戻して、書き直してください。");
    // 「もう一度」は出さん（試行の上限に達した受付を送り直しても同じ結果）。
    expect(screen.queryByRole("button", { name: "もう一度" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "入力に戻す" })).toBeInTheDocument();
    expect(screen.getByText("まだ送れていません")).toBeInTheDocument();
  });

  it("小出しの途中で止めの POST が届かん時は、残りの塊を全部出して通常へ戻る", async () => {
    // FR-9/S-14b。小出しの予定時刻を先へ伸ばし、出し切る前の途中状態を作る。
    const judge = JSON.stringify({
      ok: true,
      reasons: [],
      warnings: [],
      checks: {
        ngram: { ok: true, ratio: 0, matchedPhrases: [], exactRepeat: false },
        nearDuplicate: { ok: true, matches: [] },
        voice: { ok: true, endingsMismatch: false },
        format: { ok: true },
        empty: { ok: true },
      },
    });
    const chunk = (seq: number, text: string) =>
      `event: chunk\ndata: {"seq":${seq},"text":"${text}","judge":${judge},"attempt":1,"preExtend":true}\n\n`;
    const far = Date.now() + 60_000;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        const path = String(url);
        if (init?.method === "POST" && path.endsWith("/stop")) {
          throw new TypeError("Failed to fetch");
        }
        if (init?.method === "POST") {
          return new Response(
            chunk(0, "一つ目の返事") +
              chunk(1, "二つ目の返事") +
              chunk(2, "三つ目の返事") +
              `event: done\ndata: {"conversationId":"conversation-a","turn":1,"generationId":null,"sendAt":[0,${far},${far}]}\n\n`,
          );
        }
        return Response.json({
          turn: 2,
          history: [
            { id: "m1", turn: 1, role: "user", content: "途中で止める質問" },
            { id: "m2", turn: 1, role: "assistant", content: "保存済みの返事" },
          ],
        });
      }),
    );
    render(<ChatView characterId="a" characterName="案内役" />);
    fireEvent.change(screen.getByRole("textbox", { name: "メッセージ" }), {
      target: { value: "途中で止める質問" },
    });
    fireEvent.click(screen.getByRole("button", { name: "送信" }));

    // 先頭の塊だけ出て、残りは予定時刻待ち（小出しの途中）。
    await screen.findByText("一つ目の返事");
    expect(screen.queryByText("二つ目の返事")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "返事を止める" }));

    // 届かんかったので、残りを全部出して入力へ戻る（作成中の「…」も消える）。
    await screen.findByText("三つ目の返事");
    expect(screen.getByText("二つ目の返事")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "送信" })).toBeInTheDocument();
    expect(document.querySelectorAll(".v2-message-turn.assistant.pending")).toHaveLength(0);
  });

  it("字数カウンタは上限の 8 割を超えた時だけ出て、超過で失敗の文と「!」を足す", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ turn: 1, history: [] })),
    );
    render(<ChatView characterId="a" characterName="案内役" />);
    const box = screen.getByRole("textbox", { name: "メッセージ" });
    // 8 割（3,200）までは出さん。
    fireEvent.change(box, { target: { value: "あ".repeat(3200) } });
    expect(screen.queryByText(/\/ 4,000/)).not.toBeInTheDocument();
    // 8 割超で数えだけ出る（失敗の文はまだ出さん）。
    fireEvent.change(box, { target: { value: "あ".repeat(3201) } });
    expect(screen.getByText("3,201 / 4,000")).toBeInTheDocument();
    expect(screen.queryByText(/メッセージは/)).not.toBeInTheDocument();
    // 超過で失敗の文と「!」の印を足す。送信ボタンは止まる。
    fireEvent.change(box, { target: { value: "あ".repeat(4001) } });
    expect(screen.getByText(/いま 4,001 文字です。/)).toBeInTheDocument();
    expect(screen.getByText("4,001 / 4,000")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "送信" })).toBeDisabled();
  });

  it("持つ手が左の時は、＋と入力・送信の並びを左右入れ替える（板 TalkLeft）", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ turn: 1, history: [] })),
    );
    render(<ChatView characterId="a" characterName="案内役" handedness="left" />);
    const form = screen.getByRole("textbox", { name: "メッセージ" }).closest("form");
    expect(form).toHaveAttribute("data-hand", "left");
    // DOM の順は＋・入力・送信のまま保ち、並び替えは CSS の order に任せる。
    const children = Array.from(form?.querySelectorAll("button, input") ?? []);
    expect(children.indexOf(form?.querySelector(".v2-talk-plus") as Element)).toBeLessThan(
      children.indexOf(form?.querySelector('button[type="submit"]') as Element),
    );
  });

  it("「＋」のトレイは板どおりの構成で、返事の候補の入切は端末に残る", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ turn: 1, history: [] })),
    );
    render(<ChatView characterId="a" characterName="案内役" />);
    fireEvent.click(screen.getByRole("button", { name: /ひらく/ }));
    const tray = document.querySelector(".v2-talk-tray");
    expect(tray).toHaveTextContent("よく使う");
    expect(tray).toHaveTextContent("画像をもらう");
    // 非対応端末では「電話する」の札は出さん（jsdom は音声認識を持たん）。
    expect(tray).toHaveTextContent("この会話");
    expect(tray).toHaveTextContent("雰囲気");
    expect(tray).toHaveTextContent("心の声");
    const suggestRow = within(tray as HTMLElement).getByRole("button", {
      name: /返事の候補/,
    });
    expect(suggestRow).toHaveTextContent("オン");
    expect(tray).toHaveTextContent("場面");
    expect(tray).toHaveTextContent("いまの場面");
    expect(tray).toHaveTextContent("しおり");
    expect(tray).toHaveTextContent("もらう画像の設定");
    // 切った選択は端末へ残る。
    fireEvent.click(suggestRow);
    expect(suggestRow).toHaveTextContent("オフ");
    expect(localStorage.getItem("v2-suggest:a")).toBe("0");
  });
});

describe("ChatView 小出しの最中の送信（#196）", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const judge = JSON.stringify({
    ok: true,
    reasons: [],
    warnings: [],
    checks: {
      ngram: { ok: true, ratio: 0, matchedPhrases: [], exactRepeat: false },
      nearDuplicate: { ok: true, matches: [] },
      voice: { ok: true, endingsMismatch: false },
      format: { ok: true },
      empty: { ok: true },
    },
  });
  const chunk = (seq: number, text: string) =>
    `event: chunk\ndata: {"seq":${seq},"text":"${text}","judge":${judge},"attempt":1,"preExtend":true}\n\n`;
  const done = (turn: number, sendAt: string) =>
    `event: done\ndata: {"conversationId":"conversation-a","turn":${turn},"generationId":null${sendAt}}\n\n`;
  // 先頭だけ即出し、残りは遠い先（小出しの途中で止まる）。
  const slowReply = (label: string, turn: number) =>
    chunk(0, `${label}一`) +
    chunk(1, `${label}二`) +
    chunk(2, `${label}三`) +
    done(turn, ',"sendAt":[0,60000,60000]');
  const quickReply = (text: string, turn: number) => chunk(0, text) + done(turn, "");

  const bubbleTexts = () =>
    Array.from(document.querySelectorAll(".v2-message-turn")).map((node) => node.textContent ?? "");

  const expectOrder = (expected: string[]) => {
    const texts = bubbleTexts();
    const order = expected.map((part) => texts.findIndex((text) => text.includes(part)));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  };

  // 送った本文ごとに返す流れを決める（再接続で POST が重なっても取り違えんため）。
  const stubReplies = (replies: Record<string, string>) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "POST") {
          const body = JSON.parse(String(init.body)) as { text: string };
          return new Response(replies[body.text]);
        }
        return Response.json({
          turn: 2,
          history: [
            { id: "m1", turn: 1, role: "user", content: "最初の発言" },
            { id: "m2", turn: 1, role: "assistant", content: "保存済みの返事" },
          ],
        });
      }),
    );
  };

  const sendMessage = (text: string) => {
    fireEvent.change(screen.getByRole("textbox", { name: "メッセージ" }), {
      target: { value: text },
    });
    // 小出しの最中は送信ボタンが「止める」に替わるので、Enter 相当のフォーム送信で送る。
    const form = screen.getByRole("textbox", { name: "メッセージ" }).closest("form");
    if (form === null) throw new Error("フォームが無い");
    fireEvent.submit(form);
  };

  it("小出しの最中に次を送ると、前の返信の残りは新しい発言の前に出て、「…」の枠も残らない", async () => {
    stubReplies({ 最初の発言: slowReply("前", 1), 次の発言: quickReply("次の返事", 2) });
    render(<ChatView characterId="a" characterName="案内役" />);
    sendMessage("最初の発言");
    await screen.findByText("前一");
    expect(screen.queryByText("前二")).not.toBeInTheDocument();

    sendMessage("次の発言");
    await screen.findByText("次の返事");

    expectOrder(["前一", "前二", "前三", "次の発言", "次の返事"]);
    expect(document.querySelectorAll(".v2-message-turn.assistant.pending")).toHaveLength(0);
  });

  it("小出しの最中に 2 回続けて送っても、並びは送った順のまま「…」も残らない", async () => {
    stubReplies({
      発言1: slowReply("前", 1),
      発言2: slowReply("中", 2),
      発言3: quickReply("最後の返事", 3),
    });
    render(<ChatView characterId="a" characterName="案内役" />);
    sendMessage("発言1");
    await screen.findByText("前一");
    sendMessage("発言2");
    await screen.findByText("中一");
    sendMessage("発言3");
    await screen.findByText("最後の返事");

    expectOrder(["前一", "前二", "前三", "発言2", "中一", "中二", "中三", "発言3", "最後の返事"]);
    expect(document.querySelectorAll(".v2-message-turn.assistant.pending")).toHaveLength(0);
  });

  it("小出しの最中に画面を開き直すと、並びは保存どおりで「…」も残らない", async () => {
    stubReplies({ 最初の発言: slowReply("前", 1) });
    const first = render(<ChatView characterId="a" characterName="案内役" />);
    sendMessage("最初の発言");
    await screen.findByText("前一");
    first.unmount();

    render(<ChatView characterId="a" characterName="案内役" />);
    await screen.findByText("保存済みの返事");
    expectOrder(["最初の発言", "保存済みの返事"]);
    expect(screen.queryByText("前二")).not.toBeInTheDocument();
    expect(document.querySelectorAll(".v2-message-turn.assistant.pending")).toHaveLength(0);
  });
});
