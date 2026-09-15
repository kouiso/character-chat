import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStoredMessageImageUrl } from "@/lib/message-image-url";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt?: number;
  imageUrl?: string;
  imageKey?: string;
  feedbackRating?: "good" | "bad";
  isStreaming?: boolean;
  error?: boolean;
  warningLevel?: boolean;
  // Phase 1 スキャフォールディング: サーバーサイドリトライ中に UI インジケーターを表示するための予約フィールド
  isRegenerating?: boolean;
  streamId?: string;
  // 設計 C-3: 送信失敗/オフラインでキューに積まれた自分の発言。未送達＝D1未永続で、
  // タップ再送・長押し削除の対象になる。
  sendFailed?: boolean;
  // このターンで使うはずだった assistant の id。再送(handleRetrySend)が引き継ぐ。
  // 元の assistant POST がクライアント側の期限切れ後にサーバへ着地していても、
  // 再送が新しい id で応答を書くと別行として重複する(persist-turn.ts のロールバック
  // と同じ理屈)。createRow(assistant) が一度も呼ばれていない場合にも入るが、
  // 使われなかった id を再利用するだけなので無害。
  retryAssistantId?: string;
  // オフラインでキューに積んだものだけ true。再接続時の自動再送はこれだけを対象にし、
  // オンライン送信失敗（サーバエラー等）を自動再送ループさせない。
  offlineQueued?: boolean;
  // 「返事が明けたら送り直す」意思。返事待ちの最中に再送を押した時と、背面へ回って
  // ブラウザに送信を止められた時に立つ。offlineQueued と同じ機構が拾う。
  retryRequested?: boolean;
  // オフラインキューの復元キー。会話 ID が未確定の新規会話では characterId で紐づける。
  characterId?: string;
  conversationId?: string | null;
}

export interface GroupMessage {
  id: string;
  groupId?: string;
  role: "user" | "assistant";
  speakerCharacterId?: string | null;
  content: string;
  createdAt?: number;
  imageUrl?: string | null;
  imageKey?: string | null;
  isStreaming?: boolean;
  error?: boolean;
  warningLevel?: boolean;
}

// プレースホルダ判定は完全一致のみ。prefix 一致だと本文が「画像を生成中...と…」で始まる
// 正規メッセージまで消えるため。optional group は unsafe-regex を踏むので進捗形式は別パターンに分離。
const IMAGE_GENERATION_PLACEHOLDER_EXACT = "画像を生成中...";
const IMAGE_GENERATION_PROGRESS_PATTERN = /^画像を生成中\.{3} \(\d+\/\d+\)$/;
// progress_percent 由来の (45%) 形式。optional group は unsafe-regex を踏むので別パターンに分離する。
const IMAGE_GENERATION_PERCENT_PATTERN = /^画像を生成中\.{3} \((\d+)%\)$/;

// 進行中の画像生成 messageId（in-memory のみ。リロードで消える）。
// これにより「リロード後に残った placeholder＝生成 promise が失われた真の ghost」だけを除去でき、
// 会話切替で一時的に store から外れても、生成中のものを誤って消さない。
const activeImageGenerationIds = new Set<string>();
export const markImageGenerationActive = (id: string): void => {
  activeImageGenerationIds.add(id);
};
export const markImageGenerationDone = (id: string): void => {
  activeImageGenerationIds.delete(id);
};

export const isImageGenerationPlaceholderContent = (content: string): boolean => {
  const text = content.trim();
  return (
    text === IMAGE_GENERATION_PLACEHOLDER_EXACT ||
    IMAGE_GENERATION_PROGRESS_PATTERN.test(text) ||
    IMAGE_GENERATION_PERCENT_PATTERN.test(text)
  );
};

// placeholder 本文に埋め込まれた進捗 % を取り出す。% 形式でなければ null（不定形プログレス扱い）。
export const parseImageGenerationProgressPercent = (content: string): number | null => {
  const matched = IMAGE_GENERATION_PERCENT_PATTERN.exec(content.trim());
  if (!matched) return null;
  const percent = Number(matched[1]);
  if (!Number.isFinite(percent)) return null;
  return Math.min(100, Math.max(0, percent));
};

const isStaleImageGenerationPlaceholder = (message: ChatMessage): boolean =>
  message.role === "assistant" &&
  !message.isStreaming &&
  !message.imageUrl &&
  !activeImageGenerationIds.has(message.id) &&
  isImageGenerationPlaceholderContent(message.content);

const removeStaleImageGenerationPlaceholders = (messages: ChatMessage[]): ChatMessage[] =>
  messages.filter((message) => !isStaleImageGenerationPlaceholder(message));

// 未送達メッセージを、現在の会話／キャラクターに復元するかを判定する。
const isMatchingOfflineQueueContext = (
  message: ChatMessage,
  currentConversationId: string | null,
  activeCharacterId: string | null,
): boolean => {
  if (message.conversationId !== undefined && message.conversationId !== null) {
    return message.conversationId === currentConversationId;
  }
  if (message.characterId !== undefined && message.characterId !== null) {
    return message.characterId === activeCharacterId;
  }
  // conversationId・characterId ともに無いレガシーは、active キャラが決まっていればそこに紐付ける。
  return activeCharacterId !== null;
};

interface ChatState {
  messages: ChatMessage[];
  groupMessages: GroupMessage[];
  isLoading: boolean;
  currentConversationId: string | null;
  activeGroupId: string | null;
  activeCharacterId: string | null;
  offlineQueue: ChatMessage[];
  lastMemoryExtractedAtByConversation: Record<string, number>;
  addMessage: (message: ChatMessage) => void;
  removeMessage: (id: string) => void;
  addGroupMessage: (message: GroupMessage) => void;
  updateMessage: (
    id: string,
    content: string,
    isStreaming?: boolean,
    warningLevel?: boolean,
    isRegenerating?: boolean,
  ) => void;
  updateGroupMessage: (
    id: string,
    content: string,
    isStreaming?: boolean,
    warningLevel?: boolean,
  ) => void;
  updateMessageImage: (id: string, imageUrl: string) => void;
  setMessages: (messages: ChatMessage[]) => void;
  setGroupMessages: (groupMessages: GroupMessage[]) => void;
  markMessageError: (id: string) => void;
  setSendFailed: (id: string, failed: boolean, retryAssistantId?: string) => void;
  setRetryRequested: (id: string, requested: boolean) => void;
  setMessageFeedback: (id: string, rating: "good" | "bad") => void;
  markGroupMessageError: (id: string) => void;
  setLoading: (loading: boolean) => void;
  setConversationId: (id: string | null) => void;
  setActiveGroupId: (id: string | null) => void;
  setActiveCharacterId: (id: string | null) => void;
  setLastMemoryExtractedAt: (conversationId: string, timestamp: number) => void;
  clearMessages: () => void;
  clearGroupMessages: () => void;
}

export const useChatStore = create<ChatState>()(
  persist(
    (set) => ({
      messages: [],
      groupMessages: [],
      isLoading: false,
      currentConversationId: null,
      activeGroupId: null,
      activeCharacterId: null,
      offlineQueue: [],
      lastMemoryExtractedAtByConversation: {},
      addMessage: (message) =>
        set((state) => ({
          messages: [...state.messages, message],
          offlineQueue: message.offlineQueued
            ? [...state.offlineQueue.filter((m) => m.id !== message.id), message]
            : state.offlineQueue,
        })),
      removeMessage: (id) =>
        set((state) => ({
          messages: state.messages.filter((message) => message.id !== id),
          offlineQueue: state.offlineQueue.filter((message) => message.id !== id),
        })),
      addGroupMessage: (message) =>
        set((state) => ({ groupMessages: [...state.groupMessages, message] })),
      updateMessage: (
        id,
        content,
        isStreaming = false,
        warningLevel = false,
        isRegenerating = false,
      ) =>
        set((state) => ({
          // リトライ成功時にerrorフラグが残らないよう明示的にクリア
          messages: state.messages.map((m) =>
            m.id === id
              ? { ...m, content, isStreaming, error: false, warningLevel, isRegenerating }
              : m,
          ),
        })),
      updateGroupMessage: (id, content, isStreaming = false, warningLevel = false) =>
        set((state) => ({
          groupMessages: state.groupMessages.map((m) =>
            m.id === id ? { ...m, content, isStreaming, error: false, warningLevel } : m,
          ),
        })),
      updateMessageImage: (id, imageUrl) =>
        set((state) => ({
          messages: state.messages.map((m) => {
            if (m.id !== id) return m;
            const nextImageKey = imageUrl.startsWith("images/") ? imageUrl : m.imageKey;
            const resolved = resolveStoredMessageImageUrl(imageUrl, nextImageKey);
            return {
              ...m,
              imageUrl: resolved ?? imageUrl ?? undefined,
              imageKey: nextImageKey,
            };
          }),
        })),
      markMessageError: (id) =>
        set((state) => ({
          messages: state.messages.map((m) =>
            m.id === id ? { ...m, error: true, isStreaming: false } : m,
          ),
        })),
      setSendFailed: (id, failed, retryAssistantId) =>
        set((state) => ({
          messages: state.messages.map((m) =>
            m.id === id ? { ...m, sendFailed: failed, retryAssistantId } : m,
          ),
        })),
      setRetryRequested: (id, requested) =>
        set((state) => ({
          messages: state.messages.map((m) =>
            m.id === id ? { ...m, retryRequested: requested } : m,
          ),
        })),
      setMessageFeedback: (id, rating) =>
        set((state) => ({
          messages: state.messages.map((m) => (m.id === id ? { ...m, feedbackRating: rating } : m)),
        })),
      markGroupMessageError: (id) =>
        set((state) => ({
          groupMessages: state.groupMessages.map((m) =>
            m.id === id ? { ...m, error: true, isStreaming: false } : m,
          ),
        })),
      setMessages: (messages) =>
        set((state) => {
          const byId = new Map<string, ChatMessage>();
          for (const message of messages) {
            byId.set(message.id, message);
          }
          const matchedQueue: ChatMessage[] = [];
          for (const message of state.offlineQueue) {
            if (
              !isMatchingOfflineQueueContext(
                message,
                state.currentConversationId,
                state.activeCharacterId,
              )
            ) {
              continue;
            }
            const enriched = {
              ...message,
              characterId: message.characterId ?? state.activeCharacterId ?? undefined,
              conversationId: message.conversationId ?? state.currentConversationId ?? undefined,
            };
            matchedQueue.push(enriched);
            byId.set(message.id, enriched);
          }
          return {
            messages: removeStaleImageGenerationPlaceholders([...byId.values()]),
            offlineQueue: state.offlineQueue.map((message) => {
              const matched = matchedQueue.find((m) => m.id === message.id);
              return matched ?? message;
            }),
          };
        }),
      setGroupMessages: (groupMessages) => set({ groupMessages }),
      setLoading: (isLoading) => set({ isLoading }),
      setConversationId: (id) => set({ currentConversationId: id }),
      setActiveGroupId: (id) => set({ activeGroupId: id }),
      setActiveCharacterId: (id) => set({ activeCharacterId: id }),
      setLastMemoryExtractedAt: (conversationId, timestamp) =>
        set((state) => ({
          lastMemoryExtractedAtByConversation: {
            ...state.lastMemoryExtractedAtByConversation,
            [conversationId]: timestamp,
          },
        })),
      clearMessages: () => set({ messages: [] }),
      clearGroupMessages: () => set({ groupMessages: [] }),
    }),
    {
      name: "ai-chat-messages",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        offlineQueue: state.offlineQueue,
        activeCharacterId: state.activeCharacterId,
        currentConversationId: state.currentConversationId,
      }),
    },
  ),
);
