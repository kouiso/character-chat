import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
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
    streamChatWithQualityGuard: vi.fn(),
    fetchCurrentUser: vi.fn(),
  };
});

const CHARACTER = {
  id: "char-1",
  userId: "user-1",
  name: "テスト",
  avatar: null,
  systemPrompt: "x",
  greeting: "",
  tags: [],
  createdAt: 0,
};
const CONV = {
  id: "conv-1",
  title: "テスト会話",
  createdAt: 0,
  updatedAt: 0,
  characterId: "char-1",
  characterName: "テスト",
  characterGreeting: "",
  characterSystemPrompt: "x",
  characterAvatar: null,
};

const stubMatchMedia = () => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (q: string) => ({
      matches: false,
      media: q,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
};

describe("RED: 返事の途中に再送を押すと黙って死ぬ", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState(null, "", "/chat/char-1?conv=conv-1");
    vi.mocked(api.listCharacters).mockResolvedValue([CHARACTER]);
    vi.mocked(api.listConversations).mockResolvedValue([CONV]);
    vi.mocked(api.listConversationMessages).mockResolvedValue([]);
    vi.mocked(api.fetchCurrentUser).mockResolvedValue({
      email: "x@e.com",
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

  // 最初は「送れん理由を知らせる」だけにしとった。局長 2026-08-19「押しても再送信しない」——
  // 理由が出ても押した目的（送り直す）は果たされとらん。待てば送れるんやから待つ役をこっちが持つ。
  // オフラインキューと同じ機構（pickAutoRetryTarget）が、返事の明けた瞬間に拾う。
  it("返事待ちの最中に押したら、意思を覚えて明けたら送る", async () => {
    const successToast = vi.spyOn(toast, "success");
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(<OuApp route={{ page: "chat", characterId: "char-1", conversationId: "conv-1" }} />, {
      wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
    });

    await waitFor(() => expect(useChatStore.getState().currentConversationId).toBe("conv-1"));
    // 送信がサーバで落ちて未送達で残っとる発言。返事はまだ流れとる最中。
    useChatStore.setState({
      messages: [
        {
          id: "u1",
          role: "user",
          content: "とどけ",
          sendFailed: true,
          retryAssistantId: "a1",
          createdAt: 1,
        },
      ],
      isLoading: true,
    });
    const bubble = await screen.findByRole("button", { name: /とどけ.*タップで再送/ });

    fireEvent.pointerDown(bubble);
    fireEvent.click(bubble);

    await waitFor(() => expect(successToast).toHaveBeenCalled());
    // 覚えとらんかったら、返事が明けても誰も拾わん。
    expect(useChatStore.getState().messages.find((m) => m.id === "u1")?.retryRequested).toBe(true);
  });
});
