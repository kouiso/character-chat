// この会話のアルバム（板 TalkAlbum）: 届いた画像を新しい順に並べ、
// 「いまの場面を 4コマに」で既存の漫画生成口へつなぐ。
import { useState } from "react";

import { createFileRoute, getRouteApi, Link, notFound, useRouter } from "@tanstack/react-router";
import { z } from "zod";

import { BackIcon, EmptyState, ErrorCard } from "../../../component/make-screen";
import { dayLabel } from "../../../lib/day-label";
import { listChatAlbum } from "../../../server/album";
import { getCharacter, listSavedConversations } from "../../../server/characters";

import "../../../component/album-screen.css";

const routeApi = getRouteApi("/chat/$id_/album");

const ComicButton = ({
  characterId,
  conversationId,
}: {
  characterId: string;
  conversationId: string;
}) => {
  const navigate = useRouter().navigate;
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const start = async () => {
    setBusy(true);
    setFailed(false);
    try {
      const response = await fetch(`/api/chat/${encodeURIComponent(characterId)}/comic`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId }),
      });
      if (!response.ok) throw new Error(`comic ${response.status}`);
      // 生成はトークのタイムラインへ流れるので、画面はトークへ戻して進みを見せる。
      await navigate({
        to: "/chat/$id",
        params: { id: characterId },
        search: { conversationId },
      });
    } catch {
      setFailed(true);
      setBusy(false);
    }
  };
  return (
    <div className="v2-talk-album-comic">
      <button
        type="button"
        className="v2-make-primary"
        disabled={busy}
        onClick={() => void start()}
      >
        <span>{busy ? "たのんでいます" : "いまの場面を 4コマに"}</span>
      </button>
      {failed && <p className="v2-talk-album-comic-fail">4コマをたのめませんでした。もう一度。</p>}
    </div>
  );
};

const TalkAlbumPage = () => {
  const { items, character, conversationTitle } = routeApi.useLoaderData();
  const { id, conversationId } = {
    id: routeApi.useParams().id,
    conversationId: routeApi.useSearch().conversationId,
  };
  const imageCount = items.filter((item) => item.mediaKind !== "video").length;
  const clipCount = items.length - imageCount;
  const counts = [
    imageCount > 0 ? `画像 ${imageCount} 枚` : null,
    clipCount > 0 ? `クリップ ${clipCount} 本` : null,
  ]
    .filter(Boolean)
    .join("・");

  return (
    <main className="v2-make has-bottom-bar">
      <header className="v2-album-head">
        <div className="v2-make-head">
          <Link
            to="/chat/$id"
            params={{ id }}
            search={{ conversationId }}
            aria-label="トークへ戻る"
            className="v2-make-icon-button"
          >
            <BackIcon />
          </Link>
          <div className="v2-talk-album-title">
            <h1>この会話のアルバム</h1>
            {conversationTitle && <span className="v2-talk-album-sub">{conversationTitle}</span>}
          </div>
        </div>
      </header>

      {items.length === 0 ? (
        <div className="v2-album-body">
          <EmptyState
            title="まだ、画像はありません"
            text={
              <>
                トークの中で画像をもらうと、
                <br />
                ここに並びます。
              </>
            }
          >
            <Link
              to="/chat/$id"
              params={{ id }}
              search={{ conversationId }}
              className="v2-make-primary v2-album-empty-go"
            >
              <span>トークへ戻る</span>
            </Link>
          </EmptyState>
        </div>
      ) : (
        <div className="v2-album-body">
          <p className="v2-talk-album-counts">{counts}</p>
          <ComicButton characterId={id} conversationId={conversationId} />
          <ul className="v2-album-grid">
            {items.map((item) => (
              <li key={item.messageId} className="v2-album-cell">
                <a
                  href={item.imageUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="v2-album-tile"
                  aria-label={`${character.name}の${item.mediaKind === "video" ? "クリップ" : item.groupId ? "4コマ" : "画像"}（${dayLabel(item.createdAt)}）`}
                >
                  {item.mediaKind === "video" ? (
                    <video src={item.imageUrl} playsInline muted preload="metadata" />
                  ) : (
                    <img src={item.imageUrl} alt="" loading="lazy" />
                  )}
                  {(item.groupId || item.mediaKind === "video") && (
                    <span className="v2-album-badge">
                      {item.mediaKind === "video" ? "クリップ" : "4コマ"}
                    </span>
                  )}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </main>
  );
};

const TalkAlbumError = () => {
  const router = useRouter();
  const { id, conversationId } = {
    id: routeApi.useParams().id,
    conversationId: routeApi.useSearch().conversationId,
  };
  return (
    <main className="v2-make">
      <div className="v2-make-head">
        <Link
          to="/chat/$id"
          params={{ id }}
          search={{ conversationId }}
          aria-label="トークへ戻る"
          className="v2-make-icon-button"
        >
          <BackIcon />
        </Link>
        <h1>この会話のアルバム</h1>
      </div>
      <div className="v2-album-body">
        <ErrorCard
          message="アルバムを読み込めませんでした。"
          onRetry={() => void router.invalidate()}
        />
      </div>
    </main>
  );
};

export const Route = createFileRoute("/chat/$id_/album")({
  validateSearch: z.object({
    conversationId: z.string().min(1).max(120),
  }),
  loaderDeps: ({ search }) => ({ conversationId: search.conversationId }),
  loader: async ({ params, deps, abortController }) => {
    const [items, character, conversations] = await Promise.all([
      listChatAlbum({
        data: { characterId: params.id, conversationId: deps.conversationId },
        signal: abortController.signal,
      }),
      getCharacter({ data: params.id, signal: abortController.signal }),
      listSavedConversations({ signal: abortController.signal }),
    ]);
    if (!character) throw notFound();
    return {
      items,
      character,
      conversationTitle: conversations.find((row) => row.id === deps.conversationId)?.title ?? null,
    };
  },
  errorComponent: TalkAlbumError,
  component: TalkAlbumPage,
});
