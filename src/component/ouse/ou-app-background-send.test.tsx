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

const setVisibility = (state: "visible" | "hidden") => {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
};

// 局長 2026-08-19「他のアプリに移動すると失敗します」。
// ブラウザは背面へ回った送信の通信を止める。止められた中断を前面のサーバエラーと
// 同じ「未送達のまま放置」に落とすと、戻ってきても誰も拾わんので永久に失敗のまま残る。
describe("背面で止められた送信は、戻ったら自動で送り直す", () => {
  let capturedOnError: ((error: string) => void) | undefined;

  const sendText = async (text: string) => {
    const editor = await screen.findByRole("textbox", { name: /メッセージ入力/ });
    editor.innerHTML = text;
    fireEvent.input(editor);
    const send = await screen.findByRole("button", { name: "送信" });
    await waitFor(() => expect(send).not.toBeDisabled());
    fireEvent.click(send);
    await waitFor(() => expect(capturedOnError).toBeDefined());
  };

  const renderApp = () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(<OuApp route={{ page: "chat", characterId: "char-1", conversationId: "conv-1" }} />, {
      wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    capturedOnError = undefined;
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
    // 返事は流さず、こちらの合図で失敗させる。
    vi.mocked(api.streamChatWithQualityGuard).mockImplementation(
      (...args: Parameters<typeof api.streamChatWithQualityGuard>) => {
        capturedOnError = args[4];
        return new Promise(() => {});
      },
    );
    stubMatchMedia();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    setVisibility("visible");
    window.history.replaceState(null, "", "/");
    useChatStore.setState({
      messages: [],
      currentConversationId: null,
      activeCharacterId: null,
      offlineQueue: [],
      isLoading: false,
    });
  });

  it("背面へ回ってから落ちた送信は、送り直しの対象として残る", async () => {
    renderApp();
    await waitFor(() => expect(useChatStore.getState().currentConversationId).toBe("conv-1"));

    await sendText("とどけ");
    setVisibility("hidden");
    capturedOnError?.("network");

    await waitFor(() => {
      const failed = useChatStore.getState().messages.find((m) => m.content === "とどけ");
      expect(failed?.sendFailed).toBe(true);
      expect(failed?.retryRequested).toBe(true);
    });
  });

  // 前面で落ちたものまで自動再送すると、サーバが断り続ける発言を無限に送り続ける。
  it("前面のまま落ちた送信は、今までどおり手動のタップ再送に委ねる", async () => {
    renderApp();
    await waitFor(() => expect(useChatStore.getState().currentConversationId).toBe("conv-1"));

    await sendText("とどけ");
    capturedOnError?.("network");

    await waitFor(() => {
      const failed = useChatStore.getState().messages.find((m) => m.content === "とどけ");
      expect(failed?.sendFailed).toBe(true);
    });
    expect(
      useChatStore.getState().messages.find((m) => m.content === "とどけ")?.retryRequested,
    ).toBeFalsy();
  });

  // 背面のまま送り直しても同じ理由で止められるだけ。上流の枠と課金を捨てるので前面まで待つ。
  it("背面のままでは自動再送を始めん", async () => {
    renderApp();
    await waitFor(() => expect(useChatStore.getState().currentConversationId).toBe("conv-1"));

    await sendText("とどけ");
    setVisibility("hidden");
    capturedOnError?.("network");

    await waitFor(() => {
      expect(
        useChatStore.getState().messages.find((m) => m.content === "とどけ")?.retryRequested,
      ).toBe(true);
    });
    const callsAfterFailure = vi.mocked(api.streamChatWithQualityGuard).mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 50));
    // 送り直しが始まると意思は降りる（handleRetrySend）。降りとらんこと＝まだ誰も送っとらんこと。
    expect(
      useChatStore.getState().messages.find((m) => m.content === "とどけ")?.retryRequested,
    ).toBe(true);
    expect(vi.mocked(api.streamChatWithQualityGuard).mock.calls.length).toBe(callsAfterFailure);

    // 前面へ戻ったら、押さんでも送り直す。
    setVisibility("visible");
    await waitFor(() =>
      expect(vi.mocked(api.streamChatWithQualityGuard).mock.calls.length).toBeGreaterThan(
        callsAfterFailure,
      ),
    );
  });
});
