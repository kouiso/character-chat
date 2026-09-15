import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { listMemoryNotes } from "@/lib/api";

import { OuDrawer } from "./ou-drawer";

vi.mock("@/lib/api", () => ({
  listMemoryNotes: vi.fn(),
}));

const renderDrawer = (characterId: string | null) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <OuDrawer
        open
        onOpenChange={() => {}}
        messages={[]}
        characterId={characterId}
        characterName="燈子"
      />
    </QueryClientProvider>,
  );
};

// 「ふたりの抽斗」の記憶タブは常に「まだ記憶はありません」を静的表示しており、
// listMemoryNotes を一度も呼ばずに空だと断定していた。
describe("OuDrawer の記憶タブ", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("保存済みの記憶があれば内容を表示する", async () => {
    vi.mocked(listMemoryNotes).mockResolvedValue([
      {
        id: "n1",
        characterId: "c1",
        content: "誕生日は3月3日と言っていた",
        createdAt: 1000,
      },
    ]);

    renderDrawer("c1");

    expect(await screen.findByText("誕生日は3月3日と言っていた")).toBeInTheDocument();
    expect(listMemoryNotes).toHaveBeenCalledWith("c1");
    expect(screen.queryByText("まだ記憶はありません")).toBeNull();
  });

  it("記憶が本当に無い場合のみ空状態を表示する", async () => {
    vi.mocked(listMemoryNotes).mockResolvedValue([]);

    renderDrawer("c1");

    expect(await screen.findByText("まだ記憶はありません")).toBeInTheDocument();
  });

  // 取得に失敗しても useQuery の data は既定の [] のままなので、isError を見んと
  // 「通信に失敗しただけ」を「記憶が無い」と断定してまう。実際には残っとるかもしれん。
  it("取得に失敗した時は空状態やのうて失敗を伝える", async () => {
    vi.mocked(listMemoryNotes).mockRejectedValue(new Error("network"));

    renderDrawer("c1");

    expect(await screen.findByText("記憶を読み込めませんでした")).toBeInTheDocument();
    expect(screen.queryByText("まだ記憶はありません")).toBeNull();
  });
});

// 記憶/場面/写真/分岐 は選択中がゴールドの縁と文字色だけで示されており、
// 支援技術にも色を見分けられん人にも「いまどれが開いているか」が届いていなかった。
describe("OuDrawer のタブ", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("選択中のタブを aria-selected で伝える", () => {
    vi.mocked(listMemoryNotes).mockResolvedValue([]);
    renderDrawer("c1");

    expect(screen.getByRole("tab", { name: "記憶" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "写真" })).toHaveAttribute("aria-selected", "false");

    fireEvent.click(screen.getByRole("tab", { name: "写真" }));

    expect(screen.getByRole("tab", { name: "記憶" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("tab", { name: "写真" })).toHaveAttribute("aria-selected", "true");
  });

  it("tablist を名乗る以上、左右キーでもタブを移動できる", () => {
    vi.mocked(listMemoryNotes).mockResolvedValue([]);
    renderDrawer("c1");

    fireEvent.keyDown(screen.getByRole("tab", { name: "記憶" }), { key: "ArrowRight" });

    expect(screen.getByRole("tab", { name: "場面" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "場面" })).toHaveFocus();
  });
});
