import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { readChatSession, writeChatSession } from "../lib/chat-session";
import { makeFixtureReply, readFixtureChatRequest } from "../test/chat-fixture";

import { ChatView } from "./chat-view";

import type { FixtureChatRequest } from "../test/chat-fixture";

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const submit = () => {
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "合成の質問" } });
  fireEvent.click(screen.getByRole("button", { name: "送信" }));
};

describe("persisted generation UI", () => {
  it("再試行不可の通知を再読込後も再POSTせず、履歴読直しと戻る出口を残す", async () => {
    let posts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        if (init.method !== "POST") return Response.json({ turn: 1, history: [], deliveries: [] });
        posts++;
        return new Response(
          'id: 1\nevent: error\ndata: {"message":"合成の生成上限","retryable":false,"code":"generation_exhausted"}\n\n',
        );
      }),
    );
    const first = render(<ChatView characterId="synthetic" characterName="案内役" />);
    submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("合成の生成上限");
    expect(screen.queryByRole("button", { name: "再接続・再試行" })).not.toBeInTheDocument();
    expect(readChatSession("synthetic").pending?.terminalError).toBe("合成の生成上限");
    first.unmount();
    render(<ChatView characterId="synthetic" characterName="案内役" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("合成の生成上限");
    fireEvent.click(screen.getByRole("button", { name: "履歴を読み直す" }));
    await screen.findByText("合成の生成上限");
    expect(posts).toBe(1);
    expect(screen.getByRole("link", { name: "会話一覧へ戻る" })).toHaveAttribute("href", "/");
  });

  it("失敗した送信を閉じ、履歴を保持した新しい受付で入力をやり直す", async () => {
    const old = {
      characterId: "synthetic",
      conversationId: "synthetic-room",
      requestId: "failed-request",
      text: "失敗した合成入力",
      baseTurn: 3,
      terminalError: "合成の生成上限",
    };
    writeChatSession("synthetic", { version: 1, conversationId: old.conversationId, pending: old });
    const posts: FixtureChatRequest[] = [];
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      if (init.method === "POST") {
        posts.push(readFixtureChatRequest(init));
        return new Response("", { status: 503 });
      }
      return Response.json({
        conversationId: old.conversationId,
        turn: 3,
        history: [{ role: "user", content: "保存済みの合成入力", turn: 1 }],
        deliveries: [],
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ChatView characterId="synthetic" characterName="案内役" />);
    await screen.findByRole("button", { name: "入力をやり直す" });
    fireEvent.click(screen.getByRole("button", { name: "入力をやり直す" }));
    await waitFor(() => expect(screen.getByRole("textbox")).toBeEnabled());
    expect(screen.getByRole("textbox")).toHaveValue(old.text);
    expect(screen.getByText("保存済みの合成入力")).toBeInTheDocument();
    expect(posts).toHaveLength(0);
    expect(readChatSession("synthetic").pending).toBeNull();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "新しい合成入力" } });
    fireEvent.click(screen.getByRole("button", { name: "送信" }));
    await screen.findByRole("alert");
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({
      conversationId: old.conversationId,
      text: "新しい合成入力",
      turn: 3,
      retry: false,
    });
    expect(posts[0].requestId).not.toBe(old.requestId);
  });

  it("4000文字超は直接submitされても端末へ保存せず入力を保つ", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<ChatView characterId="synthetic" characterName="案内役" />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "x".repeat(4001) } });
    const form = input.closest("form");
    if (!form) throw new Error("合成フォームがありません");
    fireEvent.submit(form);
    await screen.findByText("メッセージは4000文字以内で入力してください。");
    expect(input).toHaveValue("x".repeat(4001));
    expect(input).toBeEnabled();
    expect(readChatSession("synthetic").pending).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(localStorage.getItem("v2-chat-session:synthetic")).toBeNull();
  });

  it("未保存の失敗で履歴404なら旧受付を再送せず新しい会話へ入力を残す", async () => {
    const failed = {
      characterId: "synthetic",
      conversationId: "missing-room",
      requestId: "failed-request",
      text: "保存前に失敗した合成入力",
      baseTurn: 1,
      terminalError: "合成の生成上限",
    };
    writeChatSession("synthetic", {
      version: 1,
      conversationId: failed.conversationId,
      pending: failed,
    });
    const posts: FixtureChatRequest[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        if (init.method === "POST") {
          posts.push(readFixtureChatRequest(init));
          return new Response("", { status: 503 });
        }
        return new Response("", { status: 404 });
      }),
    );
    render(<ChatView characterId="synthetic" characterName="案内役" />);
    const restart = await screen.findByRole("button", { name: "入力をやり直す" });
    await waitFor(() => expect(restart).toBeEnabled());
    fireEvent.click(restart);
    await waitFor(() => expect(screen.getByRole("textbox")).toBeEnabled());
    expect(screen.getByRole("textbox")).toHaveValue(failed.text);
    expect(posts).toHaveLength(0);
    expect(readChatSession("synthetic")).toEqual({
      version: 1,
      conversationId: null,
      pending: null,
    });
    fireEvent.click(screen.getByRole("button", { name: "送信" }));
    await screen.findByRole("alert");
    expect(posts).toHaveLength(1);
    expect(posts[0].conversationId).not.toBe(failed.conversationId);
    expect(posts[0].requestId).not.toBe(failed.requestId);
  });

  it("入力再開の履歴503では失敗した受付と入力保全を解除しない", async () => {
    const failed = {
      characterId: "synthetic",
      conversationId: "synthetic-room",
      requestId: "failed-request",
      text: "保全する合成入力",
      baseTurn: 1,
      terminalError: "合成の生成上限",
    };
    writeChatSession("synthetic", {
      version: 1,
      conversationId: failed.conversationId,
      pending: failed,
    });
    let reads = 0;
    const fetchMock = vi.fn(async () =>
      ++reads === 1
        ? Response.json({ turn: 1, history: [], deliveries: [] })
        : new Response("", { status: 503 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<ChatView characterId="synthetic" characterName="案内役" />);
    await screen.findByText("合成の生成上限");
    fireEvent.click(screen.getByRole("button", { name: "入力をやり直す" }));
    await screen.findByText("入力を再開できませんでした。履歴を確認してからやり直してください。");
    expect(screen.getByRole("textbox")).toBeDisabled();
    expect(readChatSession("synthetic").pending).toEqual(failed);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("別タブ確定後の409でも明示操作で最新turnの新しい入力へ移る", async () => {
    const old = {
      characterId: "synthetic",
      conversationId: "synthetic-room",
      requestId: "stale-request",
      text: "競合した合成入力",
      baseTurn: 1,
    };
    writeChatSession("synthetic", { version: 1, conversationId: old.conversationId, pending: old });
    const posts: FixtureChatRequest[] = [];
    const other = makeFixtureReply(
      {
        conversationId: old.conversationId,
        requestId: "other-request",
        text: "別タブの合成入力",
        turn: 1,
        retry: false,
      },
      [{ seq: 0, text: "別タブの合成返信", scheduledAt: 1000 }],
      2000,
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        if (init.method !== "POST") return Response.json(other.history);
        posts.push(readFixtureChatRequest(init));
        return new Response("", { status: 409 });
      }),
    );
    render(<ChatView characterId="synthetic" characterName="案内役" />);
    await screen.findByRole("alert");
    expect(posts).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "入力をやり直す" }));
    await waitFor(() => expect(screen.getByRole("textbox")).toBeEnabled());
    expect(screen.getByRole("textbox")).toHaveValue(old.text);
    expect(screen.getByText("別タブの合成返信")).toBeInTheDocument();
    expect(posts).toHaveLength(1);
    submit();
    await screen.findByRole("alert");
    expect(posts).toHaveLength(2);
    expect(posts[1].turn).toBe(2);
    expect(posts[1].requestId).not.toBe(old.requestId);
    expect(posts[1].retry).toBe(false);
  });

  it("同一renderの二重submitと再起動でも同じ受付番号を保つ", async () => {
    const requests: FixtureChatRequest[] = [];
    let completed: ReturnType<typeof makeFixtureReply> | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        if (init.method !== "POST")
          return Response.json(completed?.history ?? { turn: 1, history: [] });
        const request = readFixtureChatRequest(init);
        requests.push(request);
        if (requests.length === 1) return new Response("", { status: 503 });
        completed = makeFixtureReply(
          request,
          [{ seq: 0, text: "合成の確定返信", scheduledAt: 1000 }],
          2000,
        );
        return completed.response();
      }),
    );
    const first = render(<ChatView characterId="synthetic" characterName="案内役" />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "合成の質問" } });
    const form = screen.getByRole("textbox").closest("form");
    if (!form) throw new Error("合成フォームがありません");
    act(() => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await screen.findByRole("alert");
    expect(requests).toHaveLength(1);
    first.unmount();
    render(<ChatView characterId="synthetic" characterName="案内役" />);
    await screen.findByText("合成の確定返信");
    await waitFor(() => expect(readChatSession("synthetic").pending).toBeNull());
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual(requests[0]);
    expect(screen.getAllByText("合成の質問")).toHaveLength(1);
  });

  it("端末の保存失敗時は送信せず入力を保つ", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("合成の容量不足");
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<ChatView characterId="synthetic" characterName="案内役" />);
    submit();
    await screen.findByText("この端末に送信内容を保存できません。入力は保持されています。");
    expect(screen.getByRole("textbox")).toHaveValue("合成の質問");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("完了済み履歴は配送の期限前に本文を出さず、GETだけで復元する", async () => {
    let elapsed = 0;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.spyOn(performance, "now").mockImplementation(() => elapsed);
    writeChatSession("synthetic", { version: 1, conversationId: "synthetic-room", pending: null });
    const completed = makeFixtureReply(
      {
        conversationId: "synthetic-room",
        requestId: "synthetic-generation",
        text: "合成の質問",
        turn: 7,
        retry: false,
      },
      [{ seq: 0, text: "<dialogue>予定後の合成返信</dialogue>", scheduledAt: 1_800_000_000_500 }],
    );
    const fetchMock = vi.fn(async (url: string) => {
      if (!url.includes("/history?")) throw new Error("合成履歴以外の通信");
      return Response.json(completed.history);
    });
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => {
      render(<ChatView characterId="synthetic" characterName="案内役" />);
    });
    expect(screen.queryByText("予定後の合成返信")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("入力中");
    act(() => {
      elapsed = 500;
      vi.advanceTimersByTime(500);
    });
    expect(screen.getByRole("group", { name: "台詞" })).toHaveTextContent("予定後の合成返信");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain("/history?");
  });

  it("挨拶と連続assistantを含む旧履歴でもサーバーの次turnを使う", async () => {
    writeChatSession("synthetic", {
      version: 1,
      conversationId: "synthetic-legacy",
      pending: null,
    });
    let request: FixtureChatRequest | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        if (init.method === "POST") {
          request = readFixtureChatRequest(init);
          return new Response("", { status: 503 });
        }
        return Response.json({
          turn: 8,
          history: [
            { role: "assistant", content: "合成の挨拶" },
            { role: "user", content: "合成の以前の質問" },
            { role: "assistant", content: "合成の以前の返信" },
            { role: "assistant", content: "合成の追加返信" },
          ],
        });
      }),
    );
    render(<ChatView characterId="synthetic" characterName="案内役" />);
    await screen.findByText("合成の追加返信");
    submit();
    await screen.findByRole("alert");
    expect(request?.turn).toBe(8);
    expect(readChatSession("synthetic").pending?.baseTurn).toBe(8);
    expect(screen.getAllByText("合成の質問")).toHaveLength(1);
  });
});
