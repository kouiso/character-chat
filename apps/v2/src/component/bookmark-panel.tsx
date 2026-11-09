// RIT-204: ブックマーク一覧パネル。印したメッセージの抜粋一覧→クリックでその場へジャンプ。
import { useState } from "react";

import { loadBookmarkItems, type BookmarkItem } from "../lib/marks";

type BookmarkPanelProps = {
  characterId: string;
  getConversationId: () => string | null;
  onJump: (messageId: string) => void;
};

export const BookmarkPanel = ({ characterId, getConversationId, onJump }: BookmarkPanelProps) => {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<BookmarkItem[]>([]);
  const [failed, setFailed] = useState(false);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (!next) return;
    const conversationId = getConversationId();
    if (!conversationId) return;
    void loadBookmarkItems(characterId, conversationId)
      .then(setItems)
      .catch(() => setFailed(true));
  };

  return (
    <span className="v2-bookmarks">
      <button type="button" onClick={toggle} disabled={!getConversationId()}>
        🔖 {open ? "閉じる" : "ブックマーク"}
      </button>
      {open && (
        <div className="v2-bookmark-list" role="dialog" aria-label="ブックマーク一覧">
          {failed && <p role="alert">読み込みに失敗しました。</p>}
          {!failed && items.length === 0 && <p>ブックマークはまだありません。</p>}
          <ul>
            {items.map((item) => (
              <li key={item.messageId}>
                <button
                  type="button"
                  onClick={() => {
                    onJump(item.messageId);
                    setOpen(false);
                  }}
                >
                  t{item.turn}: {item.excerpt}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </span>
  );
};
