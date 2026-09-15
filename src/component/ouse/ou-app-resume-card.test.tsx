import { useEffect, useState } from "react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as api from "@/lib/api";
import { parseRoute, type AppRoute } from "@/lib/app-route";
import { getRoutePath, ROUTE_CHANGE_EVENT } from "@/lib/navigation";
import { useChatStore } from "@/store/chat-store";

import { OuApp } from "./ou-app";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof api>();
  return {
    ...actual,
    listCharacters: vi.fn(),
    listConversations: vi.fn(),
    listConversationMessages: vi.fn(),
    streamChatWithQualityGuard: vi.fn(),
    updateMessageContent: vi.fn(),
    createConversationMessage: vi.fn(),
    generateImage: vi.fn(),
    getImageTaskResult: vi.fn(),
    persistImageToR2: vi.fn(),
    updateMessageImage: vi.fn(),
    fetchCurrentUser: vi.fn(),
    updateMyDisplayName: vi.fn(),
  };
});

const CHARACTER = {
  id: "char-1",
  userId: "user-1",
  name: "テスト",
  avatar: null,
  systemPrompt: "テスト用",
  greeting: "",
  tags: [],
  createdAt: 0,
};
const CONVERSATION = {
  id: "conv-1",
  title: "テスト会話",
  createdAt: 0,
  updatedAt: 0,
  characterId: "char-1",
  characterName: "テスト",
  characterGreeting: "",
  characterSystemPrompt: "テスト用",
  characterAvatar: null,
};
const ASSISTANT_MESSAGE = {
  id: "msg-1",
  role: "assistant" as const,
  content: "<response><dialogue>「まえの返事」</dialogue></response>",
  createdAt: 1,
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

// 本物の App と同じく、pushPath の ROUTE_CHANGE_EVENT で route を差し替える。
const RoutedOuApp = () => {
  const [route, setRoute] = useState<AppRoute>(() => parseRoute(getRoutePath()));
  useEffect(() => {
    const sync = () =>
      setRoute((prev) => {
        const next = parseRoute(getRoutePath());
        return JSON.stringify(next) === JSON.stringify(prev) ? prev : next;
      });
    window.addEventListener(ROUTE_CHANGE_EVENT, sync);
    window.addEventListener("popstate", sync);
    return () => {
      window.removeEventListener(ROUTE_CHANGE_EVENT, sync);
      window.removeEventListener("popstate", sync);
    };
  }, []);
  return <OuApp route={route} />;
};

const renderApp = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<RoutedOuApp />, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
};

describe("repro: つづきから", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState(null, "", "/");
    vi.mocked(api.listCharacters).mockResolvedValue([CHARACTER]);
    vi.mocked(api.listConversations).mockResolvedValue([CONVERSATION]);
    vi.mocked(api.listConversationMessages).mockResolvedValue([ASSISTANT_MESSAGE]);
    vi.mocked(api.fetchCurrentUser).mockResolvedValue({
      email: "x@example.com",
      logoutUrl: null,
      isLocal: true,
      displayName: "ぼく",
    });
    stubMatchMedia();
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

  it("カードを押すとトーク画面が出る", async () => {
    renderApp();
    const row = await screen.findByRole("button", { name: "テストとの会話を開く" });
    fireEvent.click(row);
    await waitFor(() => expect(window.location.pathname).toBe("/chat/char-1"));
    // talk 画面の入力欄が出るはず
    await waitFor(() =>
      expect(screen.queryByRole("textbox", { name: /メッセージ入力/ })).not.toBeNull(),
    );
    await waitFor(() =>
      expect(useChatStore.getState().messages.some((m) => m.id === "msg-1")).toBe(true),
    );
  });
});
