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
      JSON.stringify({ version: 1, conversationId: "legacy", pending: null }),
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
    render(<ChatView characterId="a" characterName="案内役" />);
    await screen.findByText("追加の応答");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "新しい質問" } });
    fireEvent.click(screen.getByRole("button", { name: "送信" }));
    await screen.findByRole("alert");
    expect(readChatSession("a").pending?.baseTurn).toBe(8);
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
    const originalSetItem = Storage.prototype.setItem;
    let failPendingClear = true;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation((key, value) => {
      if (failPendingClear && key === "v2-chat-session:a" && value.includes('"pending":null')) {
        failPendingClear = false;
        throw new Error("storage failure");
      }
      originalSetItem.call(localStorage, key, value);
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
    await waitFor(() => expect(screen.getByRole("textbox")).toHaveValue("失敗した質問"));
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
      }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "入力に戻す" }));
    await screen.findByText("届いていた応答");
    await waitFor(() => expect(readChatSession("a").pending).toBeNull());
    expect(screen.getByRole("textbox")).toHaveValue("");
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
    expect(screen.getByRole("textbox")).toHaveValue("");

    fireEvent.click(screen.getByRole("button", { name: "入力に戻す" }));
    await waitFor(() => expect(screen.getByRole("textbox")).toHaveValue("失敗した質問"));
    expect(readChatSession("a").pending).toBeNull();
  });
});
