import { type RefObject } from "react";

import { useQuery } from "@tanstack/react-query";

import { useChatAnnouncement } from "@/hook/use-chat-announcement";
import { listConversations, type Character } from "@/lib/api";
import { queryKey } from "@/lib/query-key";
import { useChatStore, type ChatMessage } from "@/store/chat-store";

import { HerMessage } from "./her-message";
import { OU2 } from "./ouse-tokens";
import { YouMessage } from "./you-message";

interface OuseMessageListProps {
  greetingContent: string | null;
  bubbleCharacter: Character | undefined;
  visibleMessages: ChatMessage[];
  handleFeedback: (messageId: string, rating: "good" | "bad", reason?: string) => Promise<void>;
  handleRegenerate: (messageId: string) => Promise<void>;
  handleRetrySend: (messageId: string) => void;
  handleImageClick: (messageId: string) => void;
  imageGeneratingMessageIds: Set<string>;
  activeCharId: string | null;
  isOnline: boolean;
  scrollRef: RefObject<HTMLDivElement | null>;
  onScroll: () => void;
  // 指が触れている間はストリーミングの自動最下部スクロールを止めるための合図(D14)。
  onScrollTouchStart: () => void;
  onScrollTouchEnd: () => void;
}

const ArriveCard = ({
  characterId,
  hasMessages,
  greetingContent,
}: {
  characterId: string | null;
  hasMessages: boolean;
  greetingContent: string | null;
}) => {
  const { data: conversations = [] } = useQuery({
    queryKey: [...queryKey.conversationList, "arrive", characterId],
    queryFn: listConversations,
    enabled: !hasMessages && !!characterId,
  });

  if (hasMessages || !characterId) return null;

  const todayMidnight = new Date();
  todayMidnight.setHours(0, 0, 0, 0);
  const todayTs = todayMidnight.getTime();

  const priorConv = conversations
    .filter((c) => c.characterId === characterId && c.updatedAt < todayTs)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];

  if (!priorConv?.lastAssistantMessage) return null;

  const preview = priorConv.lastAssistantMessage;

  // 新規会話のグリーティングと前回の最後の発言が同じ場合、
  // 同じテキストが上下に重複して表示されるのを防ぐ
  if (greetingContent && preview.trim() === greetingContent.trim()) return null;

  return (
    <div
      style={{
        margin: "8px 26px 16px",
        padding: "10px 16px",
        borderLeft: "2px solid rgba(204,161,72,0.3)",
        background: "rgba(204,161,72,0.04)",
        borderRadius: "0 6px 6px 0",
      }}
    >
      <div
        style={{
          fontFamily: '"Zen Maru Gothic", sans-serif',
          fontSize: 10,
          letterSpacing: "0.18em",
          color: "rgba(204,161,72,0.5)",
          marginBottom: 4,
        }}
      >
        ゆうべのつづき
      </div>
      <p
        style={{
          margin: 0,
          fontFamily: '"Shippori Mincho", "Noto Serif JP", serif',
          fontSize: 12,
          lineHeight: 1.7,
          color: "rgba(251,247,239,0.35)",
          letterSpacing: "0.04em",
        }}
      >
        {preview.slice(0, 60)}
        {preview.length > 60 ? "…" : ""}
      </p>
    </div>
  );
};

const OfflineBanner = ({ isOnline }: { isOnline: boolean }) => {
  if (isOnline) return null;

  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 20,
        display: "flex",
        alignItems: "center",
        gap: 9,
        margin: "0 20px 8px",
        padding: "9px 14px",
        borderRadius: 13,
        border: `1px solid ${OU2.warnBorder}`,
        background: OU2.warnBg,
        color: OU2.warnText,
        fontFamily: '"Zen Maru Gothic", sans-serif',
        fontSize: 11.5,
        letterSpacing: "0.06em",
        backdropFilter: "blur(8px)",
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: OU2.warnText,
          flex: "0 0 auto",
        }}
      />
      <span>つなぎ直しています…</span>
    </div>
  );
};

export const OuseMessageList = ({
  greetingContent,
  bubbleCharacter,
  visibleMessages,
  handleFeedback,
  handleRegenerate,
  handleRetrySend,
  handleImageClick,
  imageGeneratingMessageIds,
  activeCharId,
  isOnline,
  scrollRef,
  onScroll,
  onScrollTouchStart,
  onScrollTouchEnd,
}: OuseMessageListProps) => {
  const removeMessage = useChatStore((s) => s.removeMessage);
  const announcement = useChatAnnouncement(visibleMessages, imageGeneratingMessageIds);
  const isBusy =
    imageGeneratingMessageIds.size > 0 || visibleMessages.some((msg) => msg.isStreaming);

  return (
    <>
      {/* 返信そのものを読み上げる先。role="log" 側を喋らせると伸び続ける本文を
          トークンごとに読み直すので、確定した一文だけをここへ渡す。 */}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>
      <div
        ref={scrollRef}
        onScroll={onScroll}
        onTouchStart={onScrollTouchStart}
        onTouchEnd={onScrollTouchEnd}
        onTouchCancel={onScrollTouchEnd}
        className="ou-message-list"
        role="log"
        aria-label="会話"
        // role="log" の既定 polite を明示的に切る。切らんとストリーミング中の
        // 差分が全部読み上げ対象になる。
        aria-live="off"
        aria-busy={isBusy}
        style={{
          flex: 1,
          minHeight: 0,
          backgroundColor: OU2.night,
        }}
      >
        <OfflineBanner isOnline={isOnline} />
        <ArriveCard
          characterId={activeCharId}
          hasMessages={visibleMessages.length > 0}
          greetingContent={greetingContent}
        />
        {greetingContent !== null && (
          <div key="greeting" data-message-id="greeting">
            <HerMessage
              message={{
                id: "greeting",
                role: "assistant",
                content: greetingContent,
              }}
              isStreaming={false}
              character={bubbleCharacter}
            />
          </div>
        )}
        {visibleMessages.map((msg) =>
          msg.role === "user" ? (
            <div key={msg.id} data-message-id={msg.id}>
              <YouMessage
                message={msg}
                onRetry={() => handleRetrySend(msg.id)}
                onDelete={() => removeMessage(msg.id)}
                onImageClick={() => handleImageClick(msg.id)}
              />
            </div>
          ) : (
            <div key={msg.id} data-message-id={msg.id}>
              <HerMessage
                message={msg}
                isStreaming={msg.isStreaming ?? false}
                character={bubbleCharacter}
                onFeedback={(rating, reason) => void handleFeedback(msg.id, rating, reason)}
                onRegenerate={() => void handleRegenerate(msg.id)}
                feedbackRating={msg.feedbackRating}
                isImageGenerating={imageGeneratingMessageIds.has(msg.id)}
                onImageClick={() => handleImageClick(msg.id)}
              />
            </div>
          ),
        )}
      </div>
    </>
  );
};
