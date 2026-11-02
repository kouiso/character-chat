import { useState } from "react";

import { createFileRoute, getRouteApi, Link } from "@tanstack/react-router";

import { MemoryPanel } from "../component/memory-panel";
import { listCharacters, listSavedConversations } from "../server/characters";

const routeApi = getRouteApi("/memories");

const MemoryPage = () => {
  const { characters, conversations } = routeApi.useLoaderData();
  const [selectedCharacter, setSelectedCharacter] = useState(characters[0]?.id ?? "");
  const [selectedConversation, setSelectedConversation] = useState("");
  const matching = conversations.filter((row) => row.characterId === selectedCharacter);
  const conversationId =
    matching.find((row) => row.id === selectedConversation)?.id ?? matching[0]?.id;
  return (
    <main className="v2-list v2-memory-page">
      <h1>キャラクターの記憶</h1>
      <Link to="/">キャラクター一覧へ戻る</Link>
      <label>
        キャラクター
        <select
          aria-label="キャラクター"
          value={selectedCharacter}
          onChange={(event) => {
            setSelectedCharacter(event.target.value);
            setSelectedConversation("");
          }}
        >
          {characters.map((row) => (
            <option key={row.id} value={row.id}>
              {row.name}
            </option>
          ))}
        </select>
      </label>
      {matching.length === 0 ? (
        <p>最初に会話を始めてください。保存した会話ごとに記憶を管理できます。</p>
      ) : (
        <>
          <label>
            会話
            <select
              aria-label="会話"
              value={conversationId}
              onChange={(event) => setSelectedConversation(event.target.value)}
            >
              {matching.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.title || "無題の会話"}
                </option>
              ))}
            </select>
          </label>
          {conversationId && (
            <>
              <Link to="/chat/$id" params={{ id: selectedCharacter }} search={{ conversationId }}>
                この会話に戻る
              </Link>
              <MemoryPanel
                key={`${selectedCharacter}:${conversationId}`}
                characterId={selectedCharacter}
                conversationId={conversationId}
              />
            </>
          )}
        </>
      )}
    </main>
  );
};

export const Route = createFileRoute("/memories")({
  loader: async ({ abortController }) => {
    const [characters, conversations] = await Promise.all([
      listCharacters({ signal: abortController.signal }),
      listSavedConversations({ signal: abortController.signal }),
    ]);
    return { characters, conversations };
  },
  component: MemoryPage,
});
