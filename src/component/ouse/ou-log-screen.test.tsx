import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type * as ApiModule from "@/lib/api";

import { OuLogScreen } from "./ou-log-screen";

const deleteConversation = vi.fn(async (conversationId: string) => {
  void conversationId;
});

const searchConversationMessages = vi.fn(async (query: string) => {
  void query;
  return [
    {
      messageId: "msg-9",
      conversationId: "conv-2",
      conversationTitle: "傘のこと",
      role: "assistant" as const,
      snippet: "傘、持っていかなかったでしょう。",
      createdAt: Date.now(),
      characterName: "燈子",
      characterAvatar: null,
    },
  ];
});

// use-chat-query が @/lib/api の関数を丸ごと使うので、実物を土台にして
// この画面が触る2つだけ差し替える。
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof ApiModule>()),
  listConversations: vi.fn(async () => [
    {
      id: "conv-1",
      title: "雨の夜",
      createdAt: Date.now() - 120000,
      updatedAt: Date.now() - 120000,
      characterId: "char-1",
      characterName: "燈子",
      characterGreeting: "おかえりなさい。",
      characterSystemPrompt: "",
      characterAvatar: null,
      lastAssistantMessage: "続きを待っていました。",
    },
  ]),
  deleteConversation: (id: string) => deleteConversation(id),
  searchConversationMessages: (query: string) => searchConversationMessages(query),
}));

const renderLog = (onSelectConversation = vi.fn()) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    onSelectConversation,
    ...render(
      <QueryClientProvider client={client}>
        <OuLogScreen onSelectConversation={onSelectConversation} />
      </QueryClientProvider>,
    ),
  };
};

afterEach(() => {
  cleanup();
  deleteConversation.mockClear();
  searchConversationMessages.mockClear();
});

// 画面には「消しても、彼女の記憶は残ります」と書いてあるのに、消す操作がどこにも
// 無かった（#1459）。API も hook も揃っとって、繋がっとらんかっただけ。
describe("履歴から会話を消せる", () => {
  it("削除は二段。一段目では消えん", async () => {
    renderLog();
    fireEvent.click(await screen.findByRole("button", { name: "燈子との会話を削除" }));

    expect(deleteConversation).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "消す" })).toBeTruthy();
  });

  it("「やめる」で必ず戻れる", async () => {
    renderLog();
    fireEvent.click(await screen.findByRole("button", { name: "燈子との会話を削除" }));
    fireEvent.click(screen.getByRole("button", { name: "やめる" }));

    expect(deleteConversation).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "燈子との会話を削除" })).toBeTruthy();
  });

  it("「消す」で初めて削除が走る", async () => {
    renderLog();
    fireEvent.click(await screen.findByRole("button", { name: "燈子との会話を削除" }));
    fireEvent.click(screen.getByRole("button", { name: "消す" }));

    await waitFor(() => expect(deleteConversation).toHaveBeenCalledWith("conv-1"));
  });
});

// 検索欄は「会話の中身も検索できます…」と名乗っとるのに、実際は手元に持っとる
// 題・相手の名前・最後の一言しか見てへんかった。本文で探すサーバの口も
// クライアントの関数も揃っとって、画面が呼んでへんだけ（呼ぶ側 0 件）。
describe("検索欄が名乗っとるとおり本文も探す", () => {
  it("打ち終わったら本文をサーバへ探しにいく", async () => {
    renderLog();

    fireEvent.change(screen.getByLabelText("会話を検索"), { target: { value: "傘の" } });

    await waitFor(() => expect(searchConversationMessages).toHaveBeenCalledWith("傘の"));
    expect(await screen.findByText("傘、持っていかなかったでしょう。")).toBeTruthy();
  });

  it("一文字では投げん（打つたびにサーバを叩かんため）", async () => {
    renderLog();

    fireEvent.change(screen.getByLabelText("会話を検索"), { target: { value: "傘の" } });
    await waitFor(() => expect(searchConversationMessages).toHaveBeenCalled());
    searchConversationMessages.mockClear();

    fireEvent.change(screen.getByLabelText("会話を検索"), { target: { value: "あ" } });
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(searchConversationMessages).not.toHaveBeenCalled();
  });

  // 探し当てた発言が数十ターン上に埋まっとると、開くだけではまた探し直しになる。
  it("本文のヒットを押すと、その発言まで飛ぶ", async () => {
    const { onSelectConversation } = renderLog();

    fireEvent.change(screen.getByLabelText("会話を検索"), { target: { value: "傘の" } });
    fireEvent.click(await screen.findByText("傘、持っていかなかったでしょう。"));

    expect(onSelectConversation).toHaveBeenCalledWith("conv-2", undefined, "msg-9");
  });
});
