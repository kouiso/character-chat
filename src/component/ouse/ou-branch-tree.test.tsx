import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { listBranches, updateConversationTitle, type ConversationSummary } from "@/lib/api";

import { OuBranchTree } from "./ou-branch-tree";

vi.mock("@/lib/api", () => ({
  listBranches: vi.fn(),
  updateConversationTitle: vi.fn(),
}));

const BRANCH: ConversationSummary = {
  id: "branch-1",
  title: "燈子・「窓際で手を繋ぐ」・11/10",
  createdAt: new Date(2026, 10, 10).getTime(),
  updatedAt: new Date(2026, 10, 10).getTime(),
  characterId: "char-1",
  characterName: "燈子",
  characterGreeting: "",
  characterSystemPrompt: "",
  characterAvatar: null,
  parentConversationId: "conv-1",
  branchedFromMessageId: "msg-9",
  parentTitle: "初めての夜",
  lastAssistantMessage: "「もう少しだけ、ここにいて」",
};

const renderTree = (
  conversationId: string | null = "conv-1",
  onOpen: (conversationId: string, characterId?: string) => void = () => {},
) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <OuBranchTree conversationId={conversationId} onOpen={onOpen} />
    </QueryClientProvider>,
  );
};

describe("OuBranchTree", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("分岐カードを日付ラベル・タイトル・直近の返事つきで並べる", async () => {
    vi.mocked(listBranches).mockResolvedValue([BRANCH]);

    renderTree("conv-1");

    expect(await screen.findByText("if ・ 11/10に分岐")).toBeInTheDocument();
    expect(screen.getByText("燈子・「窓際で手を繋ぐ」・11/10")).toBeInTheDocument();
    expect(screen.getByText("「もう少しだけ、ここにいて」")).toBeInTheDocument();
  });

  it("親ルートの題名を from: 行としてカードに出す", async () => {
    vi.mocked(listBranches).mockResolvedValue([BRANCH]);

    renderTree("conv-1");

    expect(await screen.findByText("from: 初めての夜")).toBeInTheDocument();
  });

  it("parentTitle が無い分岐には from: 行を出さない", async () => {
    vi.mocked(listBranches).mockResolvedValue([{ ...BRANCH, parentTitle: null }]);

    renderTree("conv-1");

    await screen.findByText("燈子・「窓際で手を繋ぐ」・11/10");
    expect(screen.queryByText(/^from:/)).toBeNull();
  });

  it("カードをタップするとそのルートへ飛ぶ", async () => {
    vi.mocked(listBranches).mockResolvedValue([BRANCH]);
    const onOpen = vi.fn();

    renderTree("conv-1", onOpen);

    fireEvent.click(await screen.findByText("燈子・「窓際で手を繋ぐ」・11/10"));

    expect(onOpen).toHaveBeenCalledWith("branch-1", "char-1");
  });

  it("なまえの書き換えで updateConversationTitle を呼んで一覧を取り直す", async () => {
    vi.mocked(listBranches).mockResolvedValue([BRANCH]);
    vi.mocked(updateConversationTitle).mockResolvedValue(undefined);

    renderTree("conv-1");

    fireEvent.click(await screen.findByRole("button", { name: "なまえを変える" }));

    const input = screen.getByLabelText("分岐のなまえ");
    fireEvent.change(input, { target: { value: "  雨の日の分岐  " } });
    fireEvent.click(screen.getByRole("button", { name: "このなまえにする" }));

    await waitFor(() => {
      // 前後の空白は落として送る
      expect(updateConversationTitle).toHaveBeenCalledWith("branch-1", "雨の日の分岐");
    });
    // 書き換え成功後は一覧を取り直す
    await waitFor(() => {
      expect(listBranches).toHaveBeenCalledTimes(2);
    });
    // 入力欄は畳まれてカード表示へ戻る
    await waitFor(() => {
      expect(screen.queryByLabelText("分岐のなまえ")).toBeNull();
    });
  });

  it("空のなまえでは updateConversationTitle を呼ばない", async () => {
    vi.mocked(listBranches).mockResolvedValue([BRANCH]);

    renderTree("conv-1");

    fireEvent.click(await screen.findByRole("button", { name: "なまえを変える" }));

    const input = screen.getByLabelText("分岐のなまえ");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(updateConversationTitle).not.toHaveBeenCalled();
    // 確定ボタン自体も無効化されている
    expect(screen.getByRole("button", { name: "このなまえにする" })).toBeDisabled();
  });

  it("Escape で編集をやめると API は呼ばれずカードへ戻る", async () => {
    vi.mocked(listBranches).mockResolvedValue([BRANCH]);

    renderTree("conv-1");

    fireEvent.click(await screen.findByRole("button", { name: "なまえを変える" }));
    const input = screen.getByLabelText("分岐のなまえ");
    fireEvent.change(input, { target: { value: "書きかけ" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(updateConversationTitle).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("分岐のなまえ")).toBeNull();
    expect(screen.getByText("燈子・「窓際で手を繋ぐ」・11/10")).toBeInTheDocument();
  });

  it("conversationId が無いときは案内だけを出して API を呼ばない", () => {
    renderTree(null);

    expect(screen.getByText("会話を始めると分岐が現れます")).toBeInTheDocument();
    expect(listBranches).not.toHaveBeenCalled();
  });
});
