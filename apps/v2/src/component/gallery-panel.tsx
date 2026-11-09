// 画像履歴ギャラリー（RIT-185）。会話で生成した画像を新しい順に並べ、
// 開く・タイムラインの該当メッセージへ戻る・消す、の3動作をパネル1つにまとめる。
// 一覧の正はサーバ側なので、パネルを開くたびに読み直す。
// 4コマ漫画（RIT-189）: 同じ groupId のコマは1ブロックでグリッド表示し、
// 「4コマにする」で直近シーンから一括生成する。
// 動画（RIT-190）: mp4 エントリは <video> で再生し、画像には「動画にする」で
// first-frame 変換を起こせる。生成は非同期なので状態をポーリングして完了したら読み直す。
import { useState } from "react";

import {
  deleteChatImage,
  fetchChatVideoStatus,
  listChatImages,
  requestChatComic,
  requestChatVideo,
  type ChatImageEntry,
} from "../lib/chat-session";

import { ChatImage } from "./chat-image";

type GalleryPanelProps = {
  characterId: string;
  getConversationId: () => string | null;
  // タイムライン側の同じ画像へスクロールする。照合は imageUrl（/api/media/<messageId>）で行う。
  onJumpToMessage: (imageUrl: string) => void;
  // 削除・4コマ生成でタイムラインが変わるので、親に履歴の読み直しを頼む。
  onChanged: () => void;
};

// 一覧を「4コマの束」と「単発」のブロックへ分ける。並びは一覧（新しい順）の先頭コマの位置。
type GalleryBlock =
  | { kind: "comic"; groupId: string; panels: ChatImageEntry[] }
  | { kind: "single"; entry: ChatImageEntry };

// 動画の完了待ち。生成中は5秒間隔で確認（上流は2-3分想定。最大6分で見切る）。
const waitForVideo = async (characterId: string, generationId: string): Promise<void> => {
  for (let i = 0; i < 72; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const polled = await fetchChatVideoStatus(
      characterId,
      generationId,
      new AbortController().signal,
    );
    if (polled.status === "ok") return;
    if (polled.status === "failed") {
      throw new Error(polled.failureReason ?? "動画を生成できませんでした。");
    }
  }
  throw new Error("動画の生成に時間が掛かっています。しばらく後で確認してください。");
};

const toBlocks = (images: ChatImageEntry[]): GalleryBlock[] => {
  const blocks: GalleryBlock[] = [];
  const groups = new Map<string, ChatImageEntry[]>();
  for (const entry of images) {
    if (!entry.groupId) {
      blocks.push({ kind: "single", entry });
      continue;
    }
    const panels = groups.get(entry.groupId);
    if (panels) {
      panels.push(entry);
      continue;
    }
    const created = [entry];
    groups.set(entry.groupId, created);
    blocks.push({ kind: "comic", groupId: entry.groupId, panels: created });
  }
  for (const block of blocks) {
    if (block.kind === "comic") {
      block.panels.sort((a, b) => (a.panelIndex ?? 0) - (b.panelIndex ?? 0));
    }
  }
  return blocks;
};

type ItemHandlers = {
  confirming: string | null;
  deleting: boolean;
  comicBusy: boolean;
  videoBusyId: string | null;
  onJumpToMessage: (imageUrl: string) => void;
  onConfirm: (messageId: string) => void;
  onRemove: (entry: ChatImageEntry) => void;
  onRetryPanel: (retry: { groupId: string; panelIndex: number }) => void;
  onMakeVideo: (entry: ChatImageEntry) => void;
  onOpen: (entry: ChatImageEntry) => void;
};

const GalleryMedia = ({ entry }: { entry: ChatImageEntry }) =>
  entry.mediaKind === "video" ? (
    <video className="v2-gallery-video" src={entry.imageUrl} controls preload="metadata" />
  ) : (
    <ChatImage src={entry.imageUrl} />
  );

const ItemActions = ({ entry, handlers }: { entry: ChatImageEntry; handlers: ItemHandlers }) => (
  <div className="v2-gallery-actions">
    <button type="button" onClick={() => handlers.onJumpToMessage(entry.imageUrl)}>
      会話へ
    </button>
    {/* 動画化は画像だけに出す。動画から動画は生成経路として意味を持たん。 */}
    {entry.mediaKind === "image" && (
      <button
        type="button"
        onClick={() => handlers.onMakeVideo(entry)}
        disabled={handlers.videoBusyId !== null}
      >
        {handlers.videoBusyId === entry.messageId ? "動画生成中…" : "動画にする"}
      </button>
    )}
    {handlers.confirming === entry.messageId ? (
      <button type="button" onClick={() => handlers.onRemove(entry)} disabled={handlers.deleting}>
        {handlers.deleting ? "削除中…" : "本当に消す"}
      </button>
    ) : (
      <button type="button" onClick={() => handlers.onConfirm(entry.messageId)}>
        消す
      </button>
    )}
  </div>
);

const GalleryBlockItem = ({ block, handlers }: { block: GalleryBlock; handlers: ItemHandlers }) =>
  block.kind === "comic" ? (
    <li className="v2-gallery-comic">
      <div className="v2-gallery-comic-grid">
        {/* 欠けたコマも本来の枠へ置く。末尾へ寄せると起承転結の並びが崩れる。 */}
        {[0, 1, 2, 3].map((slot) => {
          const entry = block.panels.find((panel) => panel.panelIndex === slot);
          return entry ? (
            <button
              key={entry.messageId}
              type="button"
              className="v2-gallery-thumb"
              aria-label={`4コマ ${slot + 1}枚目を開く`}
              onClick={() => handlers.onOpen(entry)}
            >
              <GalleryMedia entry={entry} />
            </button>
          ) : (
            <button
              key={`missing-${slot}`}
              type="button"
              className="v2-gallery-comic-missing"
              aria-label={`${slot + 1}枚目を生成し直す`}
              disabled={handlers.comicBusy}
              onClick={() => handlers.onRetryPanel({ groupId: block.groupId, panelIndex: slot })}
            >
              {slot + 1}枚目を生成
            </button>
          );
        })}
      </div>
      <ItemActions entry={block.panels[0]} handlers={handlers} />
    </li>
  ) : (
    <li className="v2-gallery-item">
      <button
        type="button"
        className="v2-gallery-thumb"
        aria-label={`ターン${block.entry.turn}の${block.entry.mediaKind === "video" ? "動画" : "画像"}を開く`}
        onClick={() => handlers.onOpen(block.entry)}
      >
        <GalleryMedia entry={block.entry} />
      </button>
      <ItemActions entry={block.entry} handlers={handlers} />
    </li>
  );

const GalleryList = ({
  images,
  error,
  handlers,
}: {
  images: ChatImageEntry[] | null;
  error: string | null;
  handlers: ItemHandlers;
}) => (
  <>
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
        {toBlocks(images).map((block) => (
          <GalleryBlockItem
            key={block.kind === "comic" ? block.groupId : block.entry.messageId}
            block={block}
            handlers={handlers}
          />
        ))}
      </ul>
    )}
  </>
);

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
  const [comicBusy, setComicBusy] = useState(false);
  const [videoBusyId, setVideoBusyId] = useState<string | null>(null);
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

  const createComic = async (retry?: { groupId: string; panelIndex: number }) => {
    const conversationId = getConversationId();
    if (!conversationId || comicBusy) return;
    setComicBusy(true);
    setError(null);
    try {
      const result = await requestChatComic(
        characterId,
        conversationId,
        new AbortController().signal,
        retry,
      );
      // 一部のコマだけ失敗した時は理由を画面へ残す（行は生成記録側に残る）。
      const failed = result.panels.filter((panel) => !panel.ok);
      if (failed.length > 0) {
        setError(`${failed.length}コマを生成できませんでした。コマごとにやり直せます。`);
      }
      await reload(conversationId);
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "4コマを生成できませんでした。");
    } finally {
      setComicBusy(false);
    }
  };

  // 動画は数分掛かるので、登録後に状態エンドポイントを短い間隔で見る。
  // パネルを閉じてもサーバ側の生成は進むので、再表示すれば途中から状態が追える。
  const makeVideo = async (entry: ChatImageEntry) => {
    const conversationId = getConversationId();
    if (!conversationId || videoBusyId) return;
    setVideoBusyId(entry.messageId);
    setError(null);
    try {
      const started = await requestChatVideo(
        characterId,
        conversationId,
        entry.messageId,
        new AbortController().signal,
      );
      await waitForVideo(characterId, started.generationId);
      await reload(conversationId);
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "動画を生成できませんでした。");
    } finally {
      setVideoBusyId(null);
    }
  };

  const handlers: ItemHandlers = {
    confirming,
    deleting,
    comicBusy,
    videoBusyId,
    onJumpToMessage,
    onConfirm: setConfirming,
    onRemove: (entry) => void remove(entry),
    onRetryPanel: (retry) => void createComic(retry),
    onMakeVideo: (entry) => void makeVideo(entry),
    onOpen: setViewer,
  };

  return (
    <div className="v2-gallery">
      <button type="button" className="v2-gallery-toggle" onClick={() => void openPanel()}>
        画像履歴
      </button>
      {open && (
        <div className="v2-gallery-panel">
          <button
            type="button"
            className="v2-gallery-comic-create"
            onClick={() => void createComic()}
            disabled={comicBusy}
          >
            {comicBusy ? "4コマ生成中…" : "4コマにする"}
          </button>
          <GalleryList images={images} error={error} handlers={handlers} />
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
          {viewer.mediaKind === "video" ? (
            <video className="v2-gallery-viewer-video" src={viewer.imageUrl} controls autoPlay />
          ) : (
            <ChatImage src={viewer.imageUrl} />
          )}
        </div>
      )}
    </div>
  );
};
