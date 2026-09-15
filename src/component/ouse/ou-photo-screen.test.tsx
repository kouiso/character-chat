import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { listGalleryImages } from "@/lib/api";

import { OuPhotoScreen } from "./ou-photo-screen";

// 認証付きメディア解決は常に成功扱いにし、タイル（クリック可能ボタン）が描画される状態にする。
vi.mock("@/lib/authenticated-image", () => ({
  useAuthenticatedImageUrl: () => ({ url: "blob:mock", failed: false }),
  pickDisplaySrc: (src: string) => src,
  shouldAuthenticate: () => false,
}));
vi.mock("@/lib/api", () => ({
  listGalleryImages: vi.fn(),
}));

const galleryRow = (over: Record<string, unknown>) => ({
  messageId: "x",
  conversationId: "c",
  conversationTitle: "夜",
  characterId: "ch",
  characterName: "みつき",
  characterAvatar: null,
  imageUrl: "/api/image/r2/still.png",
  imageKey: "images/still.png",
  content: "",
  createdAt: 1000,
  ...over,
});

const renderGallery = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <OuPhotoScreen mode="gallery" messages={[]} />
    </QueryClientProvider>,
  );
};

describe("OuPhotoScreen gallery — 写真タイル", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("写真タイルは aria-label に「の写真を開く」を含む", async () => {
    vi.mocked(listGalleryImages).mockResolvedValue([galleryRow({ messageId: "img" })]);
    renderGallery();

    expect(await screen.findByRole("button", { name: /の写真を開く/ })).toBeInTheDocument();
  });

  it("写真タイルのタップでは写真・全画面を開く", async () => {
    vi.mocked(listGalleryImages).mockResolvedValue([galleryRow({ messageId: "img" })]);
    renderGallery();

    fireEvent.click(await screen.findByRole("button", { name: /の写真を開く/ }));

    expect(screen.getByRole("dialog", { name: "写真・全画面" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "写真を閉じる" }));

    expect(screen.queryByRole("dialog", { name: "写真・全画面" })).toBeNull();
  });

  // 絞り込みピルは選択中が背景と文字色だけで示されており、支援技術にも
  // 色を見分けられん人にも「いまどれで絞っとるか」が届いていなかった。
  it("絞り込みピルは選択状態を aria-pressed で伝える", async () => {
    vi.mocked(listGalleryImages).mockResolvedValue([galleryRow({ messageId: "img" })]);
    renderGallery();

    const character = await screen.findByRole("button", { name: "みつき" });
    const all = screen.getByRole("button", { name: "すべて" });
    expect(all).toHaveAttribute("aria-pressed", "true");
    expect(character).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(character);

    expect(screen.getByRole("button", { name: "すべて" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "みつき" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("OuPhotoScreen conversation — ドロワーの写真タブ", () => {
  afterEach(cleanup);

  // ドロワーの写真タブ(mode既定=conversation)の ImageGrid はタイルに aria-label を
  // 持たず、スクリーンリーダーには無名ボタンが並ぶだけやった。
  it("会話内の写真タイルはキャラ名を含む aria-label を持つ", () => {
    render(
      <OuPhotoScreen
        messages={[{ id: "m1", role: "assistant", content: "", imageUrl: "/api/image/r2/a.png" }]}
        characterName="みつき"
      />,
    );

    expect(screen.getByRole("button", { name: "みつきの写真" })).toBeInTheDocument();
  });
});
