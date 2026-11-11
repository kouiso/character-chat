import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
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
    createConversationMessage: vi.fn(),
    createSceneBookmark: vi.fn(),
    generateImage: vi.fn(),
    getImageTaskResult: vi.fn(),
    persistImageToR2: vi.fn(),
    updateMessageImage: vi.fn(),
    fetchCurrentUser: vi.fn(),
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

// jsdom には matchMedia が無い。PC レイアウト分岐を mobile 側に固定して描画経路を1本にする。
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

// 「場面を保存」は発言アクションから createSceneBookmark までの導線。
// タイトル・抜粋は XML タグを落とした本文から作る。
describe("OuApp の場面を保存", () => {
  beforeEach(() => {
    vi.mocked(api.listCharacters).mockResolvedValue([CHARACTER]);
    vi.mocked(api.listConversations).mockResolvedValue([CONVERSATION]);
    vi.mocked(api.listConversationMessages).mockResolvedValue([ASSISTANT_MESSAGE]);
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

  it("場面を保存でブックマークを作成し、成功を知らせる", async () => {
    const successToast = vi.spyOn(toast, "success");
    vi.mocked(api.createSceneBookmark).mockResolvedValue({
      id: "bm-1",
      conversationId: "conv-1",
      messageId: "msg-1",
      title: "「まえの返事」",
      snippet: "「まえの返事」",
      characterName: "テスト",
      characterId: "char-1",
      createdAt: 100,
    });

    renderOuApp();

    fireEvent.click(await screen.findByRole("button", { name: "場面を保存" }));

    await waitFor(() => {
      expect(api.createSceneBookmark).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: "conv-1",
          messageId: "msg-1",
          title: "「まえの返事」",
          snippet: "「まえの返事」",
          characterName: "テスト",
          characterId: "char-1",
        }),
      );
    });
    expect(successToast).toHaveBeenCalledWith("場面を保存しました");
  });

  it("保存に失敗したら失敗を知らせる", async () => {
    const errorToast = vi.spyOn(toast, "error");
    vi.mocked(api.createSceneBookmark).mockRejectedValue(new Error("network"));

    renderOuApp();

    fireEvent.click(await screen.findByRole("button", { name: "場面を保存" }));

    await waitFor(() => {
      expect(errorToast).toHaveBeenCalledWith("場面を保存できませんでした。もう一度お願いします");
    });
  });
});
