import { useLayoutEffect } from "react";

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { readChatSession } from "../lib/chat-session";

import { ChatView } from "./chat-view";

describe("ChatView", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.unstubAllGlobals();
  });
  it("キャラ名と入力フォームを描画する", () => {
    render(<ChatView characterId="char-koharu-ex" characterName="小春" />);

    expect(screen.getByText("小春")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("メッセージを入力")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "送信" })).toBeDisabled();
  });

  it("生成上限のterminal通知では再送を出さず、戻る出口を保つ", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          'id: 1\nevent: error\ndata: {"message":"synthetic terminal","retryable":false,"code":"generation_exhausted"}\n\n',
          { headers: { "content-type": "text/event-stream" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<ChatView characterId="synthetic-terminal" characterName="Synthetic" />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "合成メッセージ" } });
    fireEvent.click(screen.getByRole("button", { name: "送信" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("synthetic terminal");
    expect(screen.queryByRole("button", { name: "再接続・再試行" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "会話一覧へ戻る" })).toHaveAttribute("href", "/");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(readChatSession("synthetic-terminal").pending).not.toBeNull();
  });

  it("別キャラの履歴通信失敗には前のterminal状態を持ち越さない", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) =>
        init?.method === "POST"
          ? new Response(
              'id: 1\nevent: error\ndata: {"message":"synthetic terminal","retryable":false}\n\n',
            )
          : new Response("", { status: 503 }),
      ),
    );
    const view = render(<ChatView characterId="synthetic-a" characterName="Synthetic A" />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "合成メッセージ" } });
    fireEvent.click(screen.getByRole("button", { name: "送信" }));
    await screen.findByText("synthetic terminal");
    expect(screen.queryByRole("button", { name: "再接続・再試行" })).not.toBeInTheDocument();
    localStorage.setItem(
      "v2-chat-session:synthetic-b",
      JSON.stringify({
        version: 1,
        conversationId: "synthetic-room-b",
        pending: {
          characterId: "synthetic-b",
          conversationId: "synthetic-room-b",
          requestId: "synthetic-request-b",
          text: "合成入力",
          baseTurn: 1,
        },
      }),
    );
    view.rerender(<ChatView characterId="synthetic-b" characterName="Synthetic B" />);
    await screen.findByText("会話を再開できませんでした。再試行してください。");
    expect(screen.getByRole("button", { name: "再接続・再試行" })).toBeEnabled();
  });

  it("保存のない別キャラへ切り替えたら履歴と入力を消し、初回turnへ戻す", async () => {
    localStorage.setItem(
      "v2-chat-session:synthetic-a",
      JSON.stringify({ version: 1, conversationId: "synthetic-room-a", pending: null }),
    );
    const requests: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "POST") {
          requests.push(JSON.parse(String(init.body)) as Record<string, unknown>);
          return new Response("", { status: 503 });
        }
        return Response.json({ turn: 8, history: [{ role: "assistant", content: "合成Aの履歴" }] });
      }),
    );
    const view = render(<ChatView characterId="synthetic-a" characterName="Synthetic A" />);
    await screen.findByText("合成Aの履歴");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "合成Aの下書き" } });
    view.rerender(<ChatView characterId="synthetic-b" characterName="Synthetic B" />);
    await waitFor(() => expect(screen.queryByText("合成Aの履歴")).not.toBeInTheDocument());
    expect(screen.getByRole("textbox")).toHaveValue("");
    expect(screen.getByRole("textbox")).toBeEnabled();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "合成Bの入力" } });
    fireEvent.click(screen.getByRole("button", { name: "送信" }));
    await screen.findByRole("alert");
    expect(requests[0]).toMatchObject({ turn: 1, text: "合成Bの入力" });
    expect(requests[0].conversationId).not.toBe("synthetic-room-a");
  });

  it("別キャラの初回DOM commitに旧キャラの履歴と下書きを載せない", async () => {
    localStorage.setItem(
      "v2-chat-session:synthetic-a",
      JSON.stringify({ version: 1, conversationId: "synthetic-room-a", pending: null }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          turn: 8,
          history: [{ role: "assistant", content: "合成A初回commit履歴" }],
        }),
      ),
    );
    const commits: { characterId: string; text: string; draft: string }[] = [];
    const Probe = ({ characterId }: { characterId: string }) => {
      useLayoutEffect(() => {
        commits.push({
          characterId,
          text: document.body.textContent ?? "",
          draft: document.querySelector("input")?.value ?? "",
        });
      }, [characterId]);
      return <ChatView characterId={characterId} characterName={characterId} />;
    };
    const view = render(<Probe characterId="synthetic-a" />);
    await screen.findByText("合成A初回commit履歴");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "合成A初回commit下書き" } });
    view.rerender(<Probe characterId="synthetic-b" />);
    const firstCommit = commits.find((commit) => commit.characterId === "synthetic-b");
    expect(firstCommit).toBeDefined();
    expect(firstCommit?.text).not.toContain("合成A初回commit履歴");
    expect(firstCommit?.draft).toBe("");
  });

  it("同じキャラの名前変更では会話と下書きを捨てない", async () => {
    localStorage.setItem(
      "v2-chat-session:synthetic-a",
      JSON.stringify({ version: 1, conversationId: "synthetic-room-a", pending: null }),
    );
    const fetchMock = vi.fn(async () =>
      Response.json({
        turn: 8,
        history: [{ role: "assistant", content: "合成A保持履歴" }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const view = render(<ChatView characterId="synthetic-a" characterName="Synthetic A" />);
    await screen.findByText("合成A保持履歴");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "合成A保持下書き" } });
    view.rerender(<ChatView characterId="synthetic-a" characterName="Synthetic A renamed" />);
    expect(screen.getByText("Synthetic A renamed")).toBeInTheDocument();
    expect(screen.getByText("合成A保持履歴")).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue("合成A保持下書き");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("別キャラへ切り替えたら送信中の旧readerをabortし、待ち状態を持ち越さない", async () => {
    const requestSignals: (AbortSignal | null)[] = [];
    const cancel = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        requestSignals.push(init?.signal ?? null);
        return new Response(new ReadableStream<Uint8Array>({ cancel }));
      }),
    );
    const view = render(<ChatView characterId="synthetic-a" characterName="Synthetic A" />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "合成Aの送信" } });
    fireEvent.click(screen.getByRole("button", { name: "送信" }));
    await waitFor(() => expect(screen.getByRole("textbox")).toBeDisabled());
    view.rerender(<ChatView characterId="synthetic-b" characterName="Synthetic B" />);
    await waitFor(() => expect(cancel).toHaveBeenCalledTimes(1));
    expect(requestSignals[0]?.aborted).toBe(true);
    expect(screen.queryByText("合成Aの送信")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox")).toBeEnabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("切替前に始めた完了履歴の応答が後着しても別キャラのstateへ書かない", async () => {
    let resolveHistory: (response: Response) => void = () => {};
    const historyResponse = new Promise<Response>((resolve) => {
      resolveHistory = resolve;
    });
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) =>
      init?.method === "POST"
        ? new Response(
            'id: 1\nevent: done\ndata: {"conversationId":"synthetic-room-a","turn":1,"generationId":"synthetic-generation-a"}\n\n',
          )
        : historyResponse,
    );
    vi.stubGlobal("fetch", fetchMock);
    const view = render(<ChatView characterId="synthetic-a" characterName="Synthetic A" />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "合成Aの送信" } });
    fireEvent.click(screen.getByRole("button", { name: "送信" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    view.rerender(<ChatView characterId="synthetic-b" characterName="Synthetic B" />);
    await act(async () => {
      resolveHistory(
        Response.json({ turn: 2, history: [{ role: "assistant", content: "後着の合成A返信" }] }),
      );
      await historyResponse;
    });
    expect(screen.queryByText("後着の合成A返信")).not.toBeInTheDocument();
    expect(readChatSession("synthetic-a").pending).not.toBeNull();
    expect(screen.getByRole("textbox")).toBeEnabled();
  });

  it("同一render中の二重submitでも受付番号とpendingを上書きしない", async () => {
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
    render(<ChatView characterId="synthetic" characterName="Synthetic" />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "合成メッセージ" } });
    const form = screen.getByRole("textbox").closest("form");
    if (!form) throw new Error("synthetic form missing");
    act(() => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await screen.findByRole("alert");
    expect(requests).toHaveLength(1);
    expect(readChatSession("synthetic").pending?.requestId).toBe(requests[0].requestId);
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
});
