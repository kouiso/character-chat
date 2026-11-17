// RIT-204: ブックマーク一覧パネル。印したメッセージの抜粋一覧→クリックでその場へジャンプ。
import { useState } from "react";

import { loadBookmarkItems, type BookmarkItem } from "../lib/marks";
import { TalkSheet } from "./talk-sheet";

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
        <span>しおり</span>
        <span>戻りたい所に印</span>
      </button>
      {open && (
        <TalkSheet title="しおり" onClose={() => setOpen(false)}>
          <div className="v2-talk-bookmarks">
            {failed && <p role="alert">しおりを読み込めませんでした。</p>}
            {!failed && items.length === 0 && <p>まだ、しおりはありません。</p>}
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
                    {item.excerpt}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </TalkSheet>
      )}
    </span>
  );
};
