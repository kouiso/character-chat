// RIT-204: チャットヘッダの操作群（本音表示切替 + ブックマーク一覧）。
import { BookmarkPanel } from "./bookmark-panel";

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
    <BookmarkPanel
      characterId={characterId}
      getConversationId={getConversationId}
      onJump={onJumpMessage}
    />
  </>
);
