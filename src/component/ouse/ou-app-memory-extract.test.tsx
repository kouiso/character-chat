import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as api from "@/lib/api";
import { useChatStore } from "@/store/chat-store";
import { useSettingsStore } from "@/store/settings-store";

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
    generateImage: vi.fn(),
    fetchCurrentUser: vi.fn(),
    extractMemoryNotes: vi.fn(),
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

const sendViaComposer = async () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(<OuApp route={{ page: "chat", characterId: "char-1", conversationId: "conv-1" }} />, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
  const editor = await screen.findByLabelText(`${CHARACTER.name}へのメッセージ入力`);
  editor.textContent = "つづきを聞かせて";
  fireEvent.input(editor);
  const sendButton = await screen.findByLabelText("送信");
  fireEvent.click(sendButton);
};

// A2: `/api/memory/extract` は動くのに呼び出し側が 0 件で、memory_note が 1 行も
// 増えんかった。「彼女がじぶんで覚える」トグルも既定 ON のまま何も起こさん状態やった。
describe("OuApp 記憶の自動抽出", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useSettingsStore.setState({ autoExtractMemories: true, autoGenerateImages: false });
    vi.mocked(api.listCharacters).mockResolvedValue([CHARACTER]);
    vi.mocked(api.listConversations).mockResolvedValue([CONVERSATION]);
    vi.mocked(api.listConversationMessages).mockResolvedValue([ASSISTANT_MESSAGE]);
    vi.mocked(api.createConversationMessage).mockResolvedValue(undefined);
    vi.mocked(api.generateImage).mockResolvedValue({ error: "テスト用に生成させない" });
    vi.mocked(api.extractMemoryNotes).mockResolvedValue({ inserted: 0, facts: [] });
    vi.mocked(api.streamChatWithQualityGuard).mockImplementation(
      async (_messages, _model, _onChunk, onDone) => {
        onDone({ content: "<response><dialogue>「ええよ」</dialogue></response>" });
      },
    );
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

  it("返信が保存し切れた後に、その会話とキャラで抽出を呼ぶ", async () => {
    await sendViaComposer();

    await waitFor(() => {
      expect(vi.mocked(api.extractMemoryNotes)).toHaveBeenCalledWith({
        conversationId: "conv-1",
        characterId: "char-1",
      });
    });
  });

  it("トグルを切っとる間は呼ばん", async () => {
    useSettingsStore.setState({ autoExtractMemories: false });

    await sendViaComposer();

    await waitFor(() => {
      expect(vi.mocked(api.streamChatWithQualityGuard)).toHaveBeenCalled();
    });
    // 抽出は返信の確定より後ろに回るので、走らんことは1拍おいてから確かめる。
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(vi.mocked(api.extractMemoryNotes)).not.toHaveBeenCalled();
  });

  it("抽出が落ちても、確定した返信は画面に残る", async () => {
    vi.mocked(api.extractMemoryNotes).mockRejectedValue(new Error("extract failed"));

    await sendViaComposer();

    await waitFor(() => expect(vi.mocked(api.extractMemoryNotes)).toHaveBeenCalled());
    await waitFor(() => {
      const messages = useChatStore.getState().messages;
      expect(messages.some((m) => m.role === "assistant" && m.content.includes("ええよ"))).toBe(
        true,
      );
      expect(messages.some((m) => m.sendFailed === true)).toBe(false);
    });
  });
});
