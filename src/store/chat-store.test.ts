import { beforeEach, describe, expect, it } from "vitest";

import {
  isImageGenerationPlaceholderContent,
  markImageGenerationActive,
  markImageGenerationDone,
  parseImageGenerationProgressPercent,
  useChatStore,
} from "./chat-store";

describe("useChatStore", () => {
  beforeEach(() => {
    useChatStore.setState({
      messages: [],
      groupMessages: [],
      isLoading: false,
      currentConversationId: null,
      activeGroupId: null,
      activeCharacterId: null,
      offlineQueue: [],
    });
  });

  it("addMessage: メッセージリストに追加される", () => {
    useChatStore.getState().addMessage({
      id: "msg-1",
      role: "user",
      content: "hello",
    });

    const { messages } = useChatStore.getState();
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe("hello");
  });

  // codex P1: 手動再送は元の assistantId を引き継ぐ(ou-app.tsx handleRetrySend)。
  // 引き継ぎ元は setSendFailed が message へ書き込む retryAssistantId。
  it("setSendFailed: retryAssistantId を message へ書き込む", () => {
    useChatStore.getState().addMessage({ id: "msg-1", role: "user", content: "hello" });

    useChatStore.getState().setSendFailed("msg-1", true, "assistant-1");

    const { messages } = useChatStore.getState();
    expect(messages[0].sendFailed).toBe(true);
    expect(messages[0].retryAssistantId).toBe("assistant-1");
  });

  it("setSendFailed: retryAssistantId を省略すると undefined のまま", () => {
    useChatStore.getState().addMessage({ id: "msg-1", role: "user", content: "hello" });

    useChatStore.getState().setSendFailed("msg-1", true);

    expect(useChatStore.getState().messages[0].retryAssistantId).toBeUndefined();
  });

  it("updateMessage: 指定IDのメッセージが更新される", () => {
    useChatStore.getState().addMessage({
      id: "msg-1",
      role: "assistant",
      content: "",
      isStreaming: true,
    });

    useChatStore.getState().updateMessage("msg-1", "updated content", false);

    const { messages } = useChatStore.getState();
    expect(messages[0].content).toBe("updated content");
    expect(messages[0].isStreaming).toBe(false);
  });

  it("removeMessage: 指定IDのメッセージが削除される", () => {
    useChatStore.getState().setMessages([
      { id: "msg-1", role: "user", content: "keep" },
      { id: "msg-2", role: "assistant", content: "remove" },
    ]);

    useChatStore.getState().removeMessage("msg-2");

    expect(useChatStore.getState().messages).toEqual([
      { id: "msg-1", role: "user", content: "keep" },
    ]);
  });

  it("removeMessage: 存在しないIDは何もしない", () => {
    useChatStore.getState().setMessages([{ id: "msg-1", role: "user", content: "keep" }]);

    expect(() => useChatStore.getState().removeMessage("missing")).not.toThrow();
    expect(useChatStore.getState().messages).toEqual([
      { id: "msg-1", role: "user", content: "keep" },
    ]);
  });

  it("removeMessage: addMessage後に削除すると元の件数へ戻る", () => {
    useChatStore.getState().setMessages([{ id: "msg-1", role: "user", content: "keep" }]);
    const originalLength = useChatStore.getState().messages.length;

    useChatStore.getState().addMessage({ id: "msg-2", role: "assistant", content: "optimistic" });
    useChatStore.getState().removeMessage("msg-2");

    expect(useChatStore.getState().messages).toHaveLength(originalLength);
  });

  it("updateMessage: warningLevel を更新できる", () => {
    useChatStore.getState().addMessage({
      id: "msg-warning",
      role: "assistant",
      content: "",
      isStreaming: true,
    });

    useChatStore.getState().updateMessage("msg-warning", "warned content", false, true);

    const { messages } = useChatStore.getState();
    expect(messages[0].warningLevel).toBe(true);
  });

  it("updateMessageImage: 画像URLが設定される", () => {
    useChatStore.getState().addMessage({
      id: "msg-1",
      role: "assistant",
      content: "",
    });

    useChatStore.getState().updateMessageImage("msg-1", "https://example.com/image.png");

    const { messages } = useChatStore.getState();
    expect(messages[0].imageUrl).toBe("https://example.com/image.png");
  });

  it("setMessageFeedback: 指定IDの評価が更新される", () => {
    useChatStore.getState().setMessages([
      { id: "msg-feedback", role: "assistant", content: "reply" },
      { id: "msg-other", role: "assistant", content: "other" },
    ]);

    useChatStore.getState().setMessageFeedback("msg-feedback", "good");

    expect(useChatStore.getState().messages).toEqual([
      { id: "msg-feedback", role: "assistant", content: "reply", feedbackRating: "good" },
      { id: "msg-other", role: "assistant", content: "other" },
    ]);
  });

  it("setLoading: ローディング状態が変更される", () => {
    useChatStore.getState().setLoading(true);
    expect(useChatStore.getState().isLoading).toBe(true);

    useChatStore.getState().setLoading(false);
    expect(useChatStore.getState().isLoading).toBe(false);
  });

  it("setConversationId: 会話IDが設定される", () => {
    useChatStore.getState().setConversationId("conv-123");
    expect(useChatStore.getState().currentConversationId).toBe("conv-123");
  });

  it("clearMessages: メッセージリストがクリアされる", () => {
    useChatStore.getState().addMessage({ id: "msg-1", role: "user", content: "a" });
    useChatStore.getState().addMessage({ id: "msg-2", role: "assistant", content: "b" });

    useChatStore.getState().clearMessages();
    expect(useChatStore.getState().messages).toHaveLength(0);
  });

  it("setMessages: メッセージリスト全体が置き換わる", () => {
    useChatStore.getState().addMessage({ id: "old", role: "user", content: "old" });

    useChatStore.getState().setMessages([
      { id: "new-1", role: "user", content: "new1" },
      { id: "new-2", role: "assistant", content: "new2" },
    ]);

    const { messages } = useChatStore.getState();
    expect(messages).toHaveLength(2);
    expect(messages[0].id).toBe("new-1");
  });

  it("setMessages: stale assistant image-generation placeholders are dropped on rehydrate", () => {
    useChatStore.getState().setMessages([
      { id: "user-1", role: "user", content: "request" },
      { id: "ghost-1", role: "assistant", content: "画像を生成中..." },
      { id: "assistant-1", role: "assistant", content: "reply" },
    ]);

    expect(useChatStore.getState().messages).toEqual([
      { id: "user-1", role: "user", content: "request" },
      { id: "assistant-1", role: "assistant", content: "reply" },
    ]);
  });

  it("setMessages: actively streaming image-generation placeholders are kept", () => {
    useChatStore
      .getState()
      .setMessages([
        { id: "streaming-1", role: "assistant", content: "画像を生成中...", isStreaming: true },
      ]);

    expect(useChatStore.getState().messages).toEqual([
      { id: "streaming-1", role: "assistant", content: "画像を生成中...", isStreaming: true },
    ]);
  });

  it("setMessages: user messages that literally contain the placeholder text are kept", () => {
    useChatStore
      .getState()
      .setMessages([
        { id: "user-placeholder", role: "user", content: "画像を生成中...って表示されます" },
      ]);

    expect(useChatStore.getState().messages).toEqual([
      { id: "user-placeholder", role: "user", content: "画像を生成中...って表示されます" },
    ]);
  });

  it("setMessages: assistant messages that only start with the placeholder text are kept", () => {
    useChatStore
      .getState()
      .setMessages([
        { id: "assistant-prefix", role: "assistant", content: "画像を生成中...と表示されています" },
      ]);

    expect(useChatStore.getState().messages).toEqual([
      { id: "assistant-prefix", role: "assistant", content: "画像を生成中...と表示されています" },
    ]);
  });

  it("setMessages: progress-format placeholders (n/m) are dropped", () => {
    useChatStore
      .getState()
      .setMessages([{ id: "ghost-progress", role: "assistant", content: "画像を生成中... (2/3)" }]);

    expect(useChatStore.getState().messages).toEqual([]);
  });

  it("setMessages: placeholders for in-flight generations (marked active) are kept", () => {
    markImageGenerationActive("active-gen-1");
    useChatStore
      .getState()
      .setMessages([{ id: "active-gen-1", role: "assistant", content: "画像を生成中..." }]);

    expect(useChatStore.getState().messages).toEqual([
      { id: "active-gen-1", role: "assistant", content: "画像を生成中..." },
    ]);

    markImageGenerationDone("active-gen-1");
  });

  it("groupMessages: グループメッセージを追加・更新できる", () => {
    useChatStore.getState().addGroupMessage({
      id: "group-msg-1",
      role: "assistant",
      speakerCharacterId: "character-1",
      content: "",
      isStreaming: true,
    });

    useChatStore.getState().updateGroupMessage("group-msg-1", "reply", false, true);

    const { groupMessages } = useChatStore.getState();
    expect(groupMessages).toHaveLength(1);
    expect(groupMessages[0].content).toBe("reply");
    expect(groupMessages[0].warningLevel).toBe(true);
  });

  it("addMessage: offlineQueued なメッセージは offlineQueue へも永続化される", () => {
    useChatStore.getState().addMessage({
      id: "offline-1",
      role: "user",
      content: "届かん",
      offlineQueued: true,
      sendFailed: true,
      characterId: "char-1",
      conversationId: "conv-1",
    });

    expect(useChatStore.getState().messages).toHaveLength(1);
    expect(useChatStore.getState().offlineQueue).toHaveLength(1);
    expect(useChatStore.getState().offlineQueue[0].content).toBe("届かん");
  });

  it("setMessages: offlineQueue のうち現在の会話/キャラに紐づくものを復元する", () => {
    useChatStore.setState({
      activeCharacterId: "char-1",
      currentConversationId: "conv-1",
      offlineQueue: [
        {
          id: "offline-1",
          role: "user",
          content: "届かん",
          offlineQueued: true,
          characterId: "char-1",
          conversationId: "conv-1",
        },
      ],
    });

    useChatStore.getState().setMessages([{ id: "d1-1", role: "assistant", content: "既存" }]);

    const { messages, offlineQueue } = useChatStore.getState();
    expect(messages).toHaveLength(2);
    expect(messages.some((m) => m.id === "offline-1")).toBe(true);
    expect(offlineQueue[0].characterId).toBe("char-1");
  });

  it("removeMessage: offlineQueue にある未送達も同時に削除される", () => {
    useChatStore.getState().addMessage({
      id: "offline-1",
      role: "user",
      content: "届かん",
      offlineQueued: true,
      sendFailed: true,
    });

    useChatStore.getState().removeMessage("offline-1");

    expect(useChatStore.getState().messages).toHaveLength(0);
    expect(useChatStore.getState().offlineQueue).toHaveLength(0);
  });

  it("setActiveGroupId: アクティブグループIDが設定される", () => {
    useChatStore.getState().setActiveGroupId("group-123");
    expect(useChatStore.getState().activeGroupId).toBe("group-123");
  });

  it("setMessages: percent 形式の placeholder も stale 判定で除去される", () => {
    useChatStore
      .getState()
      .setMessages([{ id: "ghost-percent", role: "assistant", content: "画像を生成中... (45%)" }]);

    expect(useChatStore.getState().messages).toEqual([]);
  });
});

describe("isImageGenerationPlaceholderContent", () => {
  it("percent 形式の placeholder を placeholder と判定する", () => {
    expect(isImageGenerationPlaceholderContent("画像を生成中... (45%)")).toBe(true);
  });

  it("attempt 形式と完全一致形式も従来どおり placeholder 判定する", () => {
    expect(isImageGenerationPlaceholderContent("画像を生成中...")).toBe(true);
    expect(isImageGenerationPlaceholderContent("画像を生成中... (2/3)")).toBe(true);
  });

  it("placeholder で始まる正規メッセージは placeholder 判定しない", () => {
    expect(isImageGenerationPlaceholderContent("画像を生成中...と表示されています")).toBe(false);
  });
});

describe("parseImageGenerationProgressPercent", () => {
  it("percent 形式から数値を取り出す", () => {
    expect(parseImageGenerationProgressPercent("画像を生成中... (45%)")).toBe(45);
    expect(parseImageGenerationProgressPercent("画像を生成中... (0%)")).toBe(0);
  });

  it("100 を超える値は 100 に丸める", () => {
    expect(parseImageGenerationProgressPercent("画像を生成中... (150%)")).toBe(100);
  });

  it("attempt 形式や非 placeholder では null を返す（不定形フォールバック）", () => {
    expect(parseImageGenerationProgressPercent("画像を生成中... (2/3)")).toBeNull();
    expect(parseImageGenerationProgressPercent("画像を生成中...")).toBeNull();
    expect(parseImageGenerationProgressPercent("普通のメッセージ")).toBeNull();
  });
});
