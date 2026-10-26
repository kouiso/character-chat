import { createFileRoute, getRouteApi, Link } from "@tanstack/react-router";

import { listCharacters, listSavedConversations } from "../server/characters";

const routeApi = getRouteApi("/");

const CharacterListPage = () => {
  const { characters, conversations } = routeApi.useLoaderData();

  return (
    <div className="v2-list">
      <h1>キャラクター</h1>
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
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {characters.length === 0 ? (
        <p className="v2-empty">キャラクターが登録されてへん。</p>
      ) : (
        <ul>
          {characters.map((c) => (
            <li key={c.id}>
              <Link to="/chat/$id" params={{ id: c.id }}>
                {c.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export const Route = createFileRoute("/")({
  loader: async () => {
    const [characters, conversations] = await Promise.all([
      listCharacters(),
      listSavedConversations(),
    ]);
    return { characters, conversations };
  },
  component: CharacterListPage,
});
