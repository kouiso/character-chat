import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as api from "@/lib/api";
import type { AppRoute } from "@/lib/app-route";
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

const renderOuApp = (
  route: AppRoute = { page: "chat", characterId: "char-1", conversationId: "conv-1" },
) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<OuApp route={route} />, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
};

describe("repro: オンラインでのサーバ失敗 → タップで再送", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState(null, "", "/chat/char-1?conv=conv-1");
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

  it("失敗した発言をタップすると再送が走る", async () => {
    const stream = vi.mocked(api.streamChatWithQualityGuard);
    // 1回目: サーバエラー。2回目以降: 成功。
    stream.mockImplementation(async (...args: unknown[]) => {
      const onComplete = args[3] as (r: { content: string }) => void;
      const onError = args[4] as (e: unknown) => void;
      if (stream.mock.calls.length === 1) onError(new Error("boom"));
      else onComplete({ content: "<response><dialogue>「ただいま」</dialogue></response>" });
    });

    renderOuApp();

    const editor = await screen.findByRole("textbox", { name: /メッセージ入力/ });
    editor.innerHTML = "とどけ";
    fireEvent.input(editor);
    const send = await screen.findByRole("button", { name: "送信" });
    await waitFor(() => expect(send).not.toBeDisabled());
    fireEvent.click(send);

    await waitFor(() => {
      const failed = useChatStore.getState().messages.find((m) => m.content === "とどけ");
      expect(failed?.sendFailed).toBe(true);
    });
    expect(useChatStore.getState().isLoading).toBe(false);

    const bubble = await screen.findByRole("button", { name: /とどけ.*タップで再送/ });
    fireEvent.pointerDown(bubble);
    fireEvent.click(bubble);

    await waitFor(() => expect(stream.mock.calls.length).toBeGreaterThanOrEqual(2));
  });
});
