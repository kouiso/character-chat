// RIT-204: チャットヘッダの操作群（本音表示切替 + ブックマーク一覧 + 記憶への導線）。
// RIT-79 のトークメニューが main に入ったら「記憶」ボタンはそちらへ移す仮置き（RIT-92）。
// 仮置きの間は <a> にする。Link は RouterProvider 外で描画する既存テストを壊す。
import { BookmarkPanel } from "./bookmark-panel";

const MemoryLink = ({
  characterId,
  getConversationId,
}: {
  characterId: string;
  getConversationId: () => string | null;
}) => {
  const conversationId = getConversationId();
  const query = conversationId ? `?conversationId=${encodeURIComponent(conversationId)}` : "";
  return (
    <a
      href={`/chat/${encodeURIComponent(characterId)}/memory${query}`}
      aria-label="記憶"
      title="記憶"
      className="v2-chat-memory-link"
    >
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
        <path
          d="M10 2.5a5.5 5.5 0 0 0-5.5 5.5c0 2.2 1.3 3.6 2.3 4.8.8 1 1.4 1.6 1.4 2.6h3.6c0-1 .6-1.6 1.4-2.6 1-1.2 2.3-2.6 2.3-4.8A5.5 5.5 0 0 0 10 2.5zM8.2 17h3.6v1h-3.6z"
          fill="currentColor"
        />
      </svg>
    </a>
  );
};

type ChatHeaderControlsProps = {
  characterId: string;
  showInner: boolean;
  getConversationId: () => string | null;
  onToggleInner: () => void;
  onJumpMessage: (messageId: string) => void;
};

export const ChatHeaderControls = ({
  characterId,
  showInner,
  getConversationId,
  onToggleInner,
  onJumpMessage,
}: ChatHeaderControlsProps) => (
  <>
    <button
      type="button"
      aria-pressed={!showInner}
      title="キャラの内心・本音レイヤの表示切替"
      onClick={onToggleInner}
    >
      {showInner ? "本音: 表示" : "本音: 非表示"}
    </button>
    <MemoryLink characterId={characterId} getConversationId={getConversationId} />
    <BookmarkPanel
      characterId={characterId}
      getConversationId={getConversationId}
      onJump={onJumpMessage}
    />
  </>
);
