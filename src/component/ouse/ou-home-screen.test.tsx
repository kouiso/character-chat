import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OuHomeScreen } from "./ou-home-screen";

vi.mock("@/lib/api", () => ({
  listConversations: vi.fn(async () => [
    {
      id: "conv-1",
      title: "夜の部屋",
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
}));

const character = {
  id: "char-1",
  userId: "user-1",
  name: "燈子",
  avatar: null,
  slug: null,
  systemPrompt: "",
  greeting: "静かな夜です。",
  tags: ["恋人"],
  createdAt: 1,
};

const renderHome = (props = {}) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <OuHomeScreen
        characters={[character]}
        onSelectCharacter={vi.fn()}
        onSelectConversation={vi.fn()}
        onDiscover={vi.fn()}
        onCreate={vi.fn()}
        {...props}
      />
    </QueryClientProvider>,
  );
};

describe("OuHomeScreen", () => {
  afterEach(cleanup);

  it("つづきと出会いと作成導線を表示する", async () => {
    const onCreate = vi.fn();
    renderHome({ onCreate });

    expect(await screen.findByText("つづきから")).toBeInTheDocument();
    expect(await screen.findByText("燈子")).toBeInTheDocument();
    expect(screen.getByText("今夜の出会い")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "✦ 会いたい子がいない夜は — つくる →" }));
    expect(onCreate).toHaveBeenCalled();
  });

  // onCreate は `() => void` と宣言されとるが、実体は handleAddCharacter(assetSrc?) やった。
  // onClick へ直接渡すと型検査を素通りして React の合成イベントが assetSrc に入り、
  // 画像の data URL として扱われて作成フローの素材が壊れる。引数ゼロで呼ぶことを固定する。
  it("作成導線はクリックイベントを引数として渡さない", async () => {
    const onCreate = vi.fn();
    renderHome({ onCreate });

    await screen.findByText("つづきから");
    fireEvent.click(screen.getByRole("button", { name: "✦ 会いたい子がいない夜は — つくる →" }));

    expect(onCreate).toHaveBeenCalledWith();
  });
});
