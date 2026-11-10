import { useState } from "react";

import { createFileRoute, getRouteApi, Link } from "@tanstack/react-router";

import { ChatModeSelect } from "../component/chat-mode-select";
import {
  ListConnectionState,
  ListEmptyState,
  ListErrorState,
  ListLoadingState,
} from "../component/list-route-state";
import { SafeModeToggle } from "../component/safe-mode-toggle";
import { StyleSelect } from "../component/style-select";
import { UserPersonaInput } from "../component/user-persona-input";
import { VoiceAutoplayToggle } from "../component/voice-autoplay-toggle";
import { avatarUrl } from "../lib/avatar-url";
import { listCharacters, listSavedConversations } from "../server/characters";

const routeApi = getRouteApi("/");

const CharacterListPage = () => {
  const { characters, conversations } = routeApi.useLoaderData();
  // RIT-30 ギャップ（Saylo の検索バー）: 名前一覧が増えると目当てを引けんので
  // クライアント側で絞る。キャラ数は個人利用の桁なのでサーバ検索は要らん。
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const filtered = needle
    ? characters.filter((c) => c.name.toLowerCase().includes(needle))
    : characters;

  return (
    <div className="v2-list">
      {characters.length > 0 && <ListConnectionState />}
      <h1>キャラクター</h1>
      <nav className="v2-nav-grid" aria-label="メニュー">
        <Link to="/characters/new">＋作る</Link>
        <Link to="/catalog">カタログ</Link>
        <Link to="/clips">クリップ</Link>
        <Link to="/create">創作</Link>
        <Link to="/stories">ストーリー</Link>
        <Link to="/groups">パーティ</Link>
        <Link to="/board">雑談</Link>
        <Link to="/revenue">収益</Link>
      </nav>
      {characters.length === 0 ? (
        <ListEmptyState />
      ) : (
        <>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="キャラ名で検索"
            aria-label="キャラ検索"
          />
          <ul className="v2-char-list">
            {filtered.map((c) => (
              <li key={c.id}>
                <Link to="/chat/$id" params={{ id: c.id }} className="v2-char-link">
                  <span className="v2-avatar" aria-hidden>
                    {c.name.slice(0, 1)}
                    {c.avatar && (
                      <img
                        src={avatarUrl(c.avatar) ?? undefined}
                        alt=""
                        loading="lazy"
                        onError={(e) => e.currentTarget.remove()}
                      />
                    )}
                  </span>
                  <span className="v2-char-name">{c.name}</span>
                  {c.playCount > 0 && <span className="v2-play-count">▶ {c.playCount}</span>}
                </Link>
                {c.canEdit && (
                  <Link to="/characters/$id" params={{ id: c.id }} className="v2-char-edit">
                    設定
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {conversations.length > 0 && (
        <section>
          <h2>保存した会話</h2>
          <ul>
            {conversations.map((conversation) => (
              <li key={conversation.id}>
                <Link
                  to="/chat/$id"
                  params={{ id: conversation.characterId }}
                  search={{ conversationId: conversation.id }}
                >
                  {conversation.title || "無題の会話"}
                  {conversation.lastMessage && (
                    <span className="v2-conversation-preview">
                      {conversation.lastMessage.slice(0, 60)}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      <details className="v2-settings">
        <summary>設定</summary>
        <SafeModeToggle />
        <ChatModeSelect />
        <StyleSelect />
        <VoiceAutoplayToggle />
        <UserPersonaInput />
      </details>
    </div>
  );
};

export const Route = createFileRoute("/")({
  pendingComponent: ListLoadingState,
  errorComponent: ListErrorState,
  loader: async ({ abortController }) => {
    const [characters, conversations] = await Promise.all([
      listCharacters({ signal: abortController.signal }),
      listSavedConversations({ signal: abortController.signal }),
    ]);
    return { characters, conversations };
  },
  component: CharacterListPage,
});
