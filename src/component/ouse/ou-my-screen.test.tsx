import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OuMyScreen } from "./ou-my-screen";

vi.mock("@/lib/api", () => ({
  listConversations: vi.fn(async () => []),
}));

const character = {
  id: "char-1",
  userId: "user-1",
  name: "燈子",
  avatar: null,
  slug: null,
  systemPrompt: "",
  greeting: "",
  tags: ["恋人"],
  createdAt: 1,
};

const renderMy = (props = {}) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <OuMyScreen
        characters={[character]}
        onCreate={vi.fn()}
        onSettings={vi.fn()}
        onTalk={vi.fn()}
        onEdit={vi.fn()}
        onMemory={vi.fn()}
        onLog={vi.fn()}
        onUtage={vi.fn()}
        {...props}
      />
    </QueryClientProvider>,
  );
};

describe("OuMyScreen", () => {
  afterEach(cleanup);

  it("作成CTAと記録導線を表示する", async () => {
    const onLog = vi.fn();
    renderMy({ onLog });

    expect(screen.getByRole("heading", { name: "マイ" })).toBeInTheDocument();
    expect(screen.getByText("あたらしい相手をつくる")).toBeInTheDocument();
    expect(screen.getByText("つくった子 — 1人")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /履歴/ }));
    expect(onLog).toHaveBeenCalled();
  });
});
