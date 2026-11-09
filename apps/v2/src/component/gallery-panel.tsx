// 画像履歴ギャラリー（RIT-185）。会話で生成した画像を新しい順に並べ、
// 開く・タイムラインの該当メッセージへ戻る・消す、の3動作をパネル1つにまとめる。
// 一覧の正はサーバ側なので、パネルを開くたびに読み直す。
import { useState } from "react";

import {
  deleteChatImage,
  listChatImages,
  type ChatImageEntry,
} from "../lib/chat-session";

import { ChatImage } from "./chat-image";

type GalleryPanelProps = {
  characterId: string;
  getConversationId: () => string | null;
  // タイムライン側の同じ画像へスクロールする。照合は imageUrl（/api/media/<messageId>）で行う。
  onJumpToMessage: (imageUrl: string) => void;
  // 削除でタイムラインからも消えるので、親に履歴の読み直しを頼む。
  onChanged: () => void;
};

export const GalleryPanel = ({
  characterId,
  getConversationId,
  onJumpToMessage,
  onChanged,
}: GalleryPanelProps) => {
  const [open, setOpen] = useState(false);
  const [images, setImages] = useState<ChatImageEntry[] | null>(null);
  const [viewer, setViewer] = useState<ChatImageEntry | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = async (conversationId: string) => {
    const loaded = await listChatImages(characterId, conversationId, new AbortController().signal);
    setImages(loaded);
  };

  const openPanel = async () => {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    setError(null);
    setConfirming(null);
    const conversationId = getConversationId();
    if (!conversationId) {
      setImages([]);
      return;
    }
    try {
      await reload(conversationId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "画像履歴を読み込めませんでした。");
    }
  };

  const remove = async (entry: ChatImageEntry) => {
    const conversationId = getConversationId();
    if (!conversationId) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteChatImage(characterId, conversationId, entry.messageId);
      // サーバ側の一覧・タイムラインの両方から消えるので、両方読み直す。
      await reload(conversationId);
      setConfirming(null);
      if (viewer?.messageId === entry.messageId) setViewer(null);
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "画像を消せませんでした。");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="v2-gallery">
      <button type="button" className="v2-gallery-toggle" onClick={() => void openPanel()}>
        画像履歴
      </button>
      {open && (
        <div className="v2-gallery-panel">
          {error && (
            <div className="v2-error" role="alert">
              {error}
            </div>
          )}
          {images === null && !error && <p>読み込み中…</p>}
          {images !== null && images.length === 0 && !error && (
            <p>この会話で生成した画像はまだありません。</p>
          )}
          {images !== null && images.length > 0 && (
            <ul className="v2-gallery-grid">
              {images.map((entry) => (
                <li key={entry.messageId} className="v2-gallery-item">
                  <button
                    type="button"
                    className="v2-gallery-thumb"
                    aria-label={`ターン${entry.turn}の画像を開く`}
                    onClick={() => setViewer(entry)}
                  >
                    <ChatImage src={entry.imageUrl} />
                  </button>
                  <div className="v2-gallery-actions">
                    <button type="button" onClick={() => onJumpToMessage(entry.imageUrl)}>
                      会話へ
                    </button>
                    {confirming === entry.messageId ? (
                      <button
                        type="button"
                        onClick={() => void remove(entry)}
                        disabled={deleting}
                      >
                        {deleting ? "削除中…" : "本当に消す"}
                      </button>
                    ) : (
                      <button type="button" onClick={() => setConfirming(entry.messageId)}>
                        消す
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {viewer && (
        <div className="v2-gallery-viewer" role="dialog" aria-label="画像プレビュー">
          <button
            type="button"
            className="v2-gallery-viewer-close"
            aria-label="閉じる"
            onClick={() => setViewer(null)}
          >
            ×
          </button>
          <ChatImage src={viewer.imageUrl} />
        </div>
      )}
    </div>
  );
};
