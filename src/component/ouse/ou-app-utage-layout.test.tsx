import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as api from "@/lib/api";
import { useChatStore } from "@/store/chat-store";

import { OuApp } from "./ou-app";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof api>();
  return {
    ...actual,
    listCharacters: vi.fn(),
    listConversations: vi.fn(),
    listConversationMessages: vi.fn(),
    listGroups: vi.fn(),
    getGroup: vi.fn(),
    listGroupMessages: vi.fn(),
    fetchCurrentUser: vi.fn(),
  };
});

// 宴に立つ人物とは無関係の「直近に開いとったキャラ」。全画面背景に出たら事故。
const CHARACTER = {
  id: "char-1",
  userId: "user-1",
  name: "テスト",
  avatar: "https://example.com/face.png",
  systemPrompt: "テスト用",
  greeting: "",
  tags: [],
  createdAt: 0,
};

const stubMatchMedia = () => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
};

const renderUtage = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<OuApp route={{ page: "groups" }} />, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
};

describe("/groups（宴）のレイアウト", () => {
  beforeEach(() => {
    vi.mocked(api.listCharacters).mockResolvedValue([CHARACTER]);
    vi.mocked(api.listConversations).mockResolvedValue([]);
    vi.mocked(api.listConversationMessages).mockResolvedValue([]);
    vi.mocked(api.listGroups).mockResolvedValue([]);
    stubMatchMedia();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    useChatStore.setState({
      messages: [],
      currentConversationId: null,
      activeCharacterId: null,
      offlineQueue: [],
      isLoading: false,
    });
  });

  it("直近のキャラの全画面立ち絵を背景に敷かん", async () => {
    const { container } = renderUtage();
    await screen.findByText("ふたりじゃない夜も。");
    await waitFor(() => expect(vi.mocked(api.listCharacters)).toHaveBeenCalled());

    expect(container.querySelector(".ou-face-fallback")).toBeNull();
    expect(container.querySelector(".ou-scrim")).toBeNull();
    expect(container.querySelector(".ou-stage-flat-bg")).not.toBeNull();
  });

  it("台本コラムやのうて全画面コラムとして敷く", async () => {
    const { container } = renderUtage();
    await screen.findByText("ふたりじゃない夜も。");

    expect(container.querySelector(".ou-col")).toHaveClass("is-log");
  });

  it("下部タブバーを他の全画面と同じように出す", async () => {
    renderUtage();
    await screen.findByText("ふたりじゃない夜も。");

    expect(screen.getByRole("navigation", { name: "メインタブ" })).toBeInTheDocument();
  });

  // 一覧にはタブバーが要るが、宴の会話は talk と同じくタブバー無しの一枚画面。
  // 一覧の中で会話を開くと、fixed のタブバーが入力欄に重なって書けんようになる。
  it("宴を開くときは会話の画面へ移し、タブバーの下に会話を敷かん", async () => {
    vi.mocked(api.listGroups).mockResolvedValue([
      {
        id: "group-1",
        name: "ふたりの宴",
        characterIds: ["char-1"],
        scenario: null,
        characters: [
          {
            id: "char-1",
            name: "テスト",
            avatar: null,
            systemPrompt: "テスト用",
            greeting: "",
            tags: [],
          },
        ],
        createdAt: 0,
      },
    ]);
    window.history.pushState(null, "", "/groups");

    renderUtage();
    fireEvent.click(await screen.findByRole("button", { name: /ふたりの宴/ }));

    await waitFor(() => expect(window.location.pathname).toBe("/groups/group-1"));
    expect(screen.queryByPlaceholderText("みんなに話しかける…")).toBeNull();
  });
});
