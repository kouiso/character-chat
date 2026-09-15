import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as api from "@/lib/api";
import type { AppRoute } from "@/lib/app-route";
import { STREAM_STORAGE_PREFIX } from "@/lib/stream-session-storage";
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

// リロード相当。DOM も in-memory の messages も捨てて URL だけから開き直す
// (messages は persist の partialize に入っていないため、実際のリロードでも消える)。
const remountAsReload = () => {
  cleanup();
  useChatStore.setState({ messages: [], currentConversationId: null, isLoading: false });
  return renderOuApp();
};

const sendText = async (text: string) => {
  const editor = await screen.findByRole("textbox", { name: /メッセージ入力/ });
  editor.innerHTML = text;
  fireEvent.input(editor);
  const send = await screen.findByRole("button", { name: "送信" });
  await waitFor(() => expect(send).not.toBeDisabled());
  fireEvent.click(send);
};

describe("ストリーミング中断からの返信復元", () => {
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

  it("生成途中で中断された返信が、開き直した後も画面に残る", async () => {
    // onDone を呼ばん = チャンクだけ届いた所でページを離れた/リロードした状態。
    vi.mocked(api.streamChatWithQualityGuard).mockImplementation(async (...args: unknown[]) => {
      const onChunk = args[2] as (text: string) => void;
      onChunk("<response><dialogue>「とちゅうまでの返事");
    });

    renderOuApp();
    await sendText("おーい");

    // 生成中の吹き出しは use-paced-reveal が時間差で出すため、中断前はストアで見る。
    await waitFor(() =>
      expect(
        useChatStore.getState().messages.some((m) => m.content.includes("とちゅうまでの返事")),
      ).toBe(true),
    );

    remountAsReload();

    expect(await screen.findByText(/とちゅうまでの返事/)).toBeTruthy();
  });

  it("返信が完了して保存できた会話では、途中経過が生き返らん", async () => {
    vi.mocked(api.streamChatWithQualityGuard).mockImplementation(async (...args: unknown[]) => {
      const onChunk = args[2] as (text: string) => void;
      const onDone = args[3] as (result: { content: string }) => void;
      onChunk("<response><dialogue>「とちゅうまでの返事");
      onDone({ content: "<response><dialogue>「さいごまでの返事」</dialogue></response>" });
    });
    vi.mocked(api.createConversationMessage).mockResolvedValue(undefined);

    renderOuApp();
    await sendText("おーい");

    await waitFor(() => expect(screen.queryByText(/さいごまでの返事/)).not.toBeNull());
    await waitFor(() =>
      expect(sessionStorage.getItem(`${STREAM_STORAGE_PREFIX}conv-1`)).toBeNull(),
    );

    remountAsReload();

    await screen.findByText(/まえの返事/);
    expect(screen.queryByText(/とちゅうまでの返事/)).toBeNull();
  });

  it("D1 に同じ id の行が在る途中経過は、二重に足さず捨てる", async () => {
    sessionStorage.setItem(
      `${STREAM_STORAGE_PREFIX}conv-1`,
      JSON.stringify({
        messageId: ASSISTANT_MESSAGE.id,
        streamId: "1",
        content: "<response><dialogue>「まえの返事",
        savedAt: Date.now(),
        conversationId: "conv-1",
      }),
    );

    renderOuApp();

    await screen.findByText(/まえの返事/);
    await waitFor(() =>
      expect(
        useChatStore.getState().messages.filter((m) => m.id === ASSISTANT_MESSAGE.id),
      ).toHaveLength(1),
    );
    expect(sessionStorage.getItem(`${STREAM_STORAGE_PREFIX}conv-1`)).toBeNull();
  });

  // 復元しただけの返信は D1 に無い。控えを残したままにすると、開き直すたび同じ
  // 幽霊返信が保持期限まで何度も生き返る。
  it("復元に成功した後は保存が消えとる", async () => {
    vi.mocked(api.streamChatWithQualityGuard).mockImplementation(async (...args: unknown[]) => {
      const onChunk = args[2] as (text: string) => void;
      onChunk("<response><dialogue>「とちゅうまでの返事");
    });

    renderOuApp();
    await sendText("おーい");

    await waitFor(() =>
      expect(
        useChatStore.getState().messages.some((m) => m.content.includes("とちゅうまでの返事")),
      ).toBe(true),
    );

    remountAsReload();

    expect(await screen.findByText(/とちゅうまでの返事/)).toBeTruthy();
    await waitFor(() =>
      expect(sessionStorage.getItem(`${STREAM_STORAGE_PREFIX}conv-1`)).toBeNull(),
    );

    // 2 回目の開き直しで戻ってきたら、控えが消えてへん証拠。
    remountAsReload();

    await screen.findByText(/まえの返事/);
    expect(screen.queryByText(/とちゅうまでの返事/)).toBeNull();
  });

  // 作り直しの途中で切れた時に古い本文が復元されると、新しい返事に混ざる。
  it("作り直しを始めたら保存が消えとる", async () => {
    vi.mocked(api.streamChatWithQualityGuard).mockImplementation(async (...args: unknown[]) => {
      const onChunk = args[2] as (text: string) => void;
      onChunk("<response><dialogue>「あたらしい返事");
    });
    vi.mocked(api.updateMessageContent).mockResolvedValue(undefined);

    renderOuApp();
    await screen.findByText(/まえの返事/);

    sessionStorage.setItem(
      `${STREAM_STORAGE_PREFIX}conv-1`,
      JSON.stringify({
        messageId: "msg-ghost",
        streamId: "1",
        content: "<response><dialogue>「ふるい途中経過",
        savedAt: Date.now(),
        conversationId: "conv-1",
      }),
    );

    const regenerate = await screen.findByRole("button", { name: "再生成" });
    fireEvent.click(regenerate);

    await waitFor(() =>
      expect(sessionStorage.getItem(`${STREAM_STORAGE_PREFIX}conv-1`)).toBeNull(),
    );
  });

  it("チャンクごとに sessionStorage へ書かん（間引く）", async () => {
    // jsdom の Storage は Proxy 越しなので、prototype も実体も spyOn では差し替わらん。
    // window.sessionStorage 自体を数える薄い包みに入れ替えて呼び出し回数を取る。
    const real = window.sessionStorage;
    const writtenKeys: string[] = [];
    const counting = {
      getItem: (key: string) => real.getItem(key),
      setItem: (key: string, value: string) => {
        writtenKeys.push(key);
        real.setItem(key, value);
      },
      removeItem: (key: string) => real.removeItem(key),
      clear: () => real.clear(),
      key: (index: number) => real.key(index),
      get length() {
        return real.length;
      },
    } as unknown as Storage;
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      value: counting,
    });
    vi.mocked(api.streamChatWithQualityGuard).mockImplementation(async (...args: unknown[]) => {
      const onChunk = args[2] as (text: string) => void;
      for (let i = 0; i < 200; i++) onChunk("あ");
    });

    renderOuApp();
    await sendText("おーい");

    await waitFor(() =>
      expect(useChatStore.getState().messages.some((m) => m.content.length >= 200)).toBe(true),
    );

    const streamWrites = writtenKeys.filter((key) => key.startsWith(STREAM_STORAGE_PREFIX));
    Object.defineProperty(window, "sessionStorage", { configurable: true, value: real });
    expect(streamWrites.length).toBeGreaterThan(0);
    expect(streamWrites.length).toBeLessThan(10);
  });
});
