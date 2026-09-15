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

const sendText = async (text: string) => {
  const editor = await screen.findByRole("textbox", { name: /メッセージ入力/ });
  editor.innerHTML = text;
  fireEvent.input(editor);
  const send = await screen.findByRole("button", { name: "送信" });
  await waitFor(() => expect(send).not.toBeDisabled());
  fireEvent.click(send);
};

describe("撮り直し中に読んどる本文を消さん", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
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
    sessionStorage.clear();
    window.history.replaceState(null, "", "/");
    useChatStore.setState({
      messages: [],
      currentConversationId: null,
      activeCharacterId: null,
      offlineQueue: [],
      isLoading: false,
    });
  });

  const LONG =
    "<response><dialogue>「さいしょの返事です。ここまで読んどる途中やった」</dialogue></response>";

  // 撮り直しは 30〜40 秒かかる。その間本文を空にすると、読んどる最中に文章が消えて
  // 数十秒後に別の文が現れる。読み手には故障と区別が付かん。
  it("サーバが作り直しを始めても、出とる本文がそのまま残る", async () => {
    vi.mocked(api.streamChatWithQualityGuard).mockImplementation(async (...args: unknown[]) => {
      const onChunk = args[2] as (text: string) => void;
      const onRegenerate = args[10] as () => void;
      onChunk(LONG);
      onRegenerate();
      onChunk("<response><dialogue>「あ");
    });

    renderOuApp();
    await sendText("おーい");

    await waitFor(() => {
      const streaming = useChatStore
        .getState()
        .messages.find((m) => m.role === "assistant" && m.isStreaming);
      expect(streaming?.content).toContain("ここまで読んどる途中やった");
    });
  });

  it("作り直し中であることが吹き出しに立つ", async () => {
    vi.mocked(api.streamChatWithQualityGuard).mockImplementation(async (...args: unknown[]) => {
      const onChunk = args[2] as (text: string) => void;
      const onRegenerate = args[10] as () => void;
      onChunk(LONG);
      onRegenerate();
    });

    renderOuApp();
    await sendText("おーい");

    await waitFor(() => {
      const streaming = useChatStore
        .getState()
        .messages.find((m) => m.role === "assistant" && m.isStreaming);
      expect(streaming?.isRegenerating).toBe(true);
    });
  });

  // 旧本文と同じ長さに届いた時点で切り替える。ここで切り替えれば画面の文字数は減らん。
  it("新しい本文が旧本文の長さに届いたら差し替わる", async () => {
    const NEW =
      "<response><dialogue>「まったくちがう新しい返事に書き直したものがこれです」</dialogue></response>";
    vi.mocked(api.streamChatWithQualityGuard).mockImplementation(async (...args: unknown[]) => {
      const onChunk = args[2] as (text: string) => void;
      const onRegenerate = args[10] as () => void;
      onChunk(LONG);
      onRegenerate();
      onChunk(NEW);
    });

    renderOuApp();
    await sendText("おーい");

    await waitFor(() => {
      const streaming = useChatStore
        .getState()
        .messages.find((m) => m.role === "assistant" && m.isStreaming);
      expect(streaming?.content).toContain("書き直したもの");
      expect(streaming?.content).not.toContain("ここまで読んどる途中やった");
    });
  });

  // 撮り直しの最中に上流が落ちた時、吹き出しごと消すと読んどる本文が失われる。
  // 旧本文は onComplete まで D1 へ書かれてへんので、消えたら二度と戻らん。
  it("作り直しの最中に落ちても、出とる本文は消えん", async () => {
    vi.mocked(api.streamChatWithQualityGuard).mockImplementation(async (...args: unknown[]) => {
      const onChunk = args[2] as (text: string) => void;
      const onRegenerate = args[10] as () => void;
      const onError = args[4] as (err: unknown) => void;
      onChunk(LONG);
      onRegenerate();
      onError(new Error("upstream died"));
    });

    renderOuApp();
    await sendText("おーい");

    await waitFor(() => {
      const shown = useChatStore
        .getState()
        .messages.find((m) => m.role === "assistant" && m.content.includes("ここまで読んどる"));
      expect(shown).toBeTruthy();
      expect(shown?.isStreaming).toBe(false);
    });
  });
});
