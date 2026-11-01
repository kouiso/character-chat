import { createFileRoute, getRouteApi, Link } from "@tanstack/react-router";

import {
  ListConnectionState,
  ListEmptyState,
  ListErrorState,
  ListLoadingState,
} from "../component/list-route-state";
import { listCharacters, listSavedConversations } from "../server/characters";

const routeApi = getRouteApi("/");

const CharacterListPage = () => {
  const { characters, conversations } = routeApi.useLoaderData();

  return (
    <div className="v2-list">
      {characters.length > 0 && <ListConnectionState />}
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
        <ListEmptyState />
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
