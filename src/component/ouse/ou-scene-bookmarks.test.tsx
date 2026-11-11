import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  deleteSceneBookmark,
  listSceneBookmarks,
  renameSceneBookmark,
  type SceneBookmark,
} from "@/lib/api";

import { OuSceneBookmarkList } from "./ou-scene-bookmarks";

vi.mock("@/lib/api", () => ({
  listSceneBookmarks: vi.fn(),
  renameSceneBookmark: vi.fn(),
  deleteSceneBookmark: vi.fn(),
}));

const BOOKMARK: SceneBookmark = {
  id: "bm-1",
  conversationId: "conv-1",
  messageId: "msg-1",
  title: "旅館の縁側で",
  snippet: "「ここ、静かでいいね」",
  characterName: "燈子",
  characterId: "char-1",
  createdAt: new Date(2026, 0, 15).getTime(),
};

const renderList = (
  characterId: string | null = "char-1",
  onOpen?: (conversationId: string, characterId: string | null, messageId: string) => void,
) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <OuSceneBookmarkList characterId={characterId} onOpen={onOpen} />
    </QueryClientProvider>,
  );
};

describe("OuSceneBookmarkList", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("保存済みの場面をタイトル・抜粋・キャラ名・日付付きで一覧する", async () => {
    vi.mocked(listSceneBookmarks).mockResolvedValue({ items: [BOOKMARK], nextCursor: null });

    renderList("char-1");

    expect(await screen.findByText("旅館の縁側で")).toBeInTheDocument();
    expect(screen.getByText("「ここ、静かでいいね」")).toBeInTheDocument();
    expect(screen.getByText("燈子", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("1/15")).toBeInTheDocument();
  });

  it("「このキャラのみ」が ON のとき characterId 付きで取得し、OFF で全体を取得する", async () => {
    vi.mocked(listSceneBookmarks).mockResolvedValue({ items: [], nextCursor: null });

    renderList("char-1");

    await waitFor(() => {
      expect(listSceneBookmarks).toHaveBeenCalledWith(
        expect.objectContaining({ characterId: "char-1" }),
      );
    });

    fireEvent.click(screen.getByRole("checkbox"));

    await waitFor(() => {
      expect(listSceneBookmarks).toHaveBeenLastCalledWith(
        expect.not.objectContaining({ characterId: "char-1" }),
      );
    });
  });

  it("検索語は確定してから q として送る", async () => {
    vi.mocked(listSceneBookmarks).mockResolvedValue({ items: [], nextCursor: null });

    renderList("char-1");

    fireEvent.change(screen.getByLabelText("場面をさがす"), { target: { value: " kiss " } });

    await waitFor(
      () => {
        expect(listSceneBookmarks).toHaveBeenLastCalledWith(expect.objectContaining({ q: "kiss" }));
      },
      { timeout: 2000 },
    );
  });

  it("場面をタップすると会話と発言へ飛ぶ", async () => {
    vi.mocked(listSceneBookmarks).mockResolvedValue({ items: [BOOKMARK], nextCursor: null });
    const onOpen = vi.fn();

    renderList("char-1", onOpen);

    fireEvent.click(await screen.findByText("旅館の縁側で"));

    expect(onOpen).toHaveBeenCalledWith("conv-1", "char-1", "msg-1");
  });

  it("なまえの書き換えで renameSceneBookmark を呼んで一覧を取り直す", async () => {
    vi.mocked(listSceneBookmarks).mockResolvedValue({ items: [BOOKMARK], nextCursor: null });
    vi.mocked(renameSceneBookmark).mockResolvedValue({ ...BOOKMARK, title: "新しいなまえ" });

    renderList("char-1");

    fireEvent.click(await screen.findByRole("button", { name: "なまえを変える" }));

    const input = screen.getByLabelText("場面のなまえ");
    fireEvent.change(input, { target: { value: "夜のプール" } });
    fireEvent.click(screen.getByRole("button", { name: "このなまえにする" }));

    await waitFor(() => {
      expect(renameSceneBookmark).toHaveBeenCalledWith("bm-1", "夜のプール");
    });
    // 書き換え成功後は一覧を取り直す
    await waitFor(() => {
      expect(listSceneBookmarks).toHaveBeenCalledTimes(2);
    });
  });

  it("消すは二度タップで確定し deleteSceneBookmark を呼ぶ", async () => {
    vi.mocked(listSceneBookmarks).mockResolvedValue({ items: [BOOKMARK], nextCursor: null });
    vi.mocked(deleteSceneBookmark).mockResolvedValue(undefined);

    renderList("char-1");

    const deleteButton = await screen.findByRole("button", { name: "この場面を消す" });
    fireEvent.click(deleteButton);
    expect(deleteSceneBookmark).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "この場面を消す" }));

    await waitFor(() => {
      expect(deleteSceneBookmark).toHaveBeenCalledWith("bm-1");
    });
  });

  it("保存済みが無いときだけ空状態を出す", async () => {
    vi.mocked(listSceneBookmarks).mockResolvedValue({ items: [], nextCursor: null });

    renderList("char-1");

    expect(await screen.findByText("保存した場面はまだありません")).toBeInTheDocument();
  });

  it("取得に失敗したときは空状態ではなく失敗を伝える", async () => {
    vi.mocked(listSceneBookmarks).mockRejectedValue(new Error("network"));

    renderList("char-1");

    expect(await screen.findByText("場面を読み込めませんでした")).toBeInTheDocument();
    expect(screen.queryByText("保存した場面はまだありません")).toBeNull();
  });

  it("nextCursor が返ると「さらに読む」でカーソル付きの次ページを取得して末尾に足す", async () => {
    const second: SceneBookmark = {
      ...BOOKMARK,
      id: "bm-2",
      title: "深夜のコンビニ",
    };
    vi.mocked(listSceneBookmarks)
      .mockResolvedValueOnce({ items: [BOOKMARK], nextCursor: "MTc2OTY0MTYwMDAwMDpibS0x" })
      .mockResolvedValueOnce({ items: [second], nextCursor: null });

    renderList("char-1");

    expect(await screen.findByText("旅館の縁側で")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "さらに読む" }));

    expect(await screen.findByText("深夜のコンビニ")).toBeInTheDocument();
    expect(listSceneBookmarks).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: "MTc2OTY0MTYwMDAwMDpibS0x" }),
    );
    expect(screen.queryByRole("button", { name: "さらに読む" })).toBeNull();
  });

  it("続き取得が失敗しても取得済みの一覧を残して再試行できる", async () => {
    vi.mocked(listSceneBookmarks)
      .mockResolvedValueOnce({ items: [BOOKMARK], nextCursor: "MTc2OTY0MTYwMDAwMDpibS0x" })
      .mockRejectedValueOnce(new Error("network"));

    renderList("char-1");

    expect(await screen.findByText("旅館の縁側で")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "さらに読む" }));

    expect(
      await screen.findByRole("button", { name: "読み込めませんでした。もう一度" }),
    ).toBeInTheDocument();
    expect(screen.getByText("旅館の縁側で")).toBeInTheDocument();
    expect(screen.queryByText("場面を読み込めませんでした")).toBeNull();
  });
});
