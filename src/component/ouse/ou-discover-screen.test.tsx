import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { listConversations, type Character } from "@/lib/api";

import { OuDiscoverScreen } from "./ou-discover-screen";

const apiFetchMock = vi.fn();
vi.mock("@/lib/api", () => ({
  listConversations: vi.fn(),
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}));

const characters = [
  {
    id: "character-1",
    userId: "user-1",
    name: "あかり",
    avatar: "/api/avatar/akari.webp",
    systemPrompt: "",
    greeting: "本を読むのが好き",
    tags: ["読書"],
    createdAt: 0,
    isOfficial: true,
  },
  {
    id: "character-2",
    userId: "user-1",
    name: "ひなた",
    avatar: "/api/avatar/hinata.webp",
    systemPrompt: "",
    greeting: "散歩しよう",
    tags: ["散歩"],
    createdAt: 0,
    isOfficial: false,
  },
] as Character[];

const renderDiscover = () => {
  vi.mocked(listConversations).mockResolvedValue([]);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <OuDiscoverScreen
        characters={characters}
        activeCharacterId={null}
        onSelectCharacter={vi.fn()}
      />
    </QueryClientProvider>,
  );
};

describe("OuDiscoverScreen", () => {
  beforeEach(() => {
    apiFetchMock.mockResolvedValue({ ok: true, blob: async () => new Blob(["image"]) });
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:character-avatar"),
    });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("検索欄を一覧と同じスクロール領域の上端に固定する", () => {
    renderDiscover();

    expect(screen.getByTestId("discover-search-dock")).toHaveStyle({
      position: "sticky",
      top: "0px",
    });
  });

  it("検索中も認証取得したキャラクター画像とカードを表示する", async () => {
    renderDiscover();

    fireEvent.change(screen.getByRole("textbox", { name: "キャラクターを検索" }), {
      target: { value: "読書" },
    });

    expect(screen.getAllByTestId("character-card")).toHaveLength(1);
    expect(screen.getByText("あかり")).toBeInTheDocument();
    await waitFor(() =>
      expect(document.querySelector('img[src="blob:character-avatar"]')).not.toBeNull(),
    );
    expect(apiFetchMock).toHaveBeenCalledWith("/api/avatar/akari.webp");
  });

  it("画像取得に失敗してもカードの代替表示を残す", async () => {
    apiFetchMock.mockResolvedValue({ ok: false, status: 401 });
    renderDiscover();

    await waitFor(() => expect(screen.getByText("あ")).toBeInTheDocument());
    expect(apiFetchMock).toHaveBeenCalledWith("/api/avatar/akari.webp");
    expect(document.querySelector('img[src="/api/avatar/akari.webp"]')).toBeNull();
  });
});
