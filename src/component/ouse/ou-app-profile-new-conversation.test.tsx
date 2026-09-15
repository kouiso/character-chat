import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
    fetchCurrentUser: vi.fn(),
  };
});

const CHARACTER = {
  id: "char-1",
  userId: "user-1",
  name: "燈子",
  avatar: null,
  systemPrompt: "x",
  greeting: "",
  tags: [],
  createdAt: 0,
};

const CONV1 = {
  id: "conv-1",
  title: "続きの会話",
  createdAt: 0,
  updatedAt: 0,
  characterId: "char-1",
  characterName: "燈子",
  characterGreeting: "",
  characterSystemPrompt: "x",
  characterAvatar: null,
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

const renderProfileOpenApp = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  // page: "character" は useOuRouting が profileOpen: route.page === "character" として
  // そのまま組む導出値。ここへ直接来ることで、OuApp 初回描画が OuProfileScreen へ
  // onStartNewConversation を配線しとるかどうかを、遷移操作を挟まず初手で検知できる。
  return render(<OuApp route={{ page: "character", characterId: "char-1" }} />, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
};

// #1484: onStartNewConversation は OuProfileScreen 側に受け皿(optional prop)が在るだけでは
// 導線は出ない。呼び出し側の ou-app.tsx が実際に値を渡していないと、プロフィール画面に
// 「はじめから話す」ボタンそのものが描画されない（呼ぶ側が 0 件のまま直った気になるバグ）。
describe("プロフィール画面で「はじめから話す」の配線が生きとる", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubMatchMedia();
    vi.mocked(api.listCharacters).mockResolvedValue([CHARACTER]);
    vi.mocked(api.listConversations).mockResolvedValue([CONV1]);
    vi.mocked(api.listConversationMessages).mockResolvedValue([]);
    vi.mocked(api.fetchCurrentUser).mockResolvedValue({
      email: "x@example.com",
      logoutUrl: null,
      isLocal: true,
      displayName: "ぼく",
    });
    // 「はじめから話す」を押した後、これが null に落ちることで openNewConversation が
    // 実際に呼ばれたと分かる。最初から null だと「押しても何も変わらんかった」ケースと
    // 区別が付かないため、あえて既存の会話を握っとる状態から始める。
    useChatStore.setState({ currentConversationId: "conv-1", activeCharacterId: "char-1" });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.history.replaceState(null, "", "/");
    useChatStore.setState({
      messages: [],
      currentConversationId: null,
      activeCharacterId: null,
      offlineQueue: [],
      isLoading: false,
    });
  });

  it("プロフィール画面に「はじめから話す」ボタンが実際に出る", async () => {
    renderProfileOpenApp();

    // ou-profile-screen.tsx の ProfileConversationActions は onStartNewConversation が
    // 渡された時だけこのボタンを描く。出る＝ ou-app.tsx から prop が届いとる証拠になる。
    expect(await screen.findByRole("button", { name: "はじめから話す" })).toBeTruthy();
  });

  it("「はじめから話す」を押すと、握っとった会話を手放して新しい会話へ入る", async () => {
    renderProfileOpenApp();

    fireEvent.click(await screen.findByRole("button", { name: "はじめから話す" }));

    // ou-app.tsx の onStartNewConversation ハンドラは openNewConversation() を呼び、
    // それが useChatStore の conversationId を null に落とす（新規会話は ?conv= 無しで開く）。
    // ここが null に変わらんければ、ボタンは在ってもハンドラの中身が繋がってへんことになる。
    expect(useChatStore.getState().currentConversationId).toBeNull();
  });
});
