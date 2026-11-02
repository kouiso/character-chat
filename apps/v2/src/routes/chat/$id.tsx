import { createFileRoute, getRouteApi, notFound } from "@tanstack/react-router";
import { z } from "zod";

import {
  ChatConnectionState,
  ChatErrorState,
  ChatLoadingState,
  ChatUnavailableState,
} from "../../component/chat-route-state";
import { ChatView } from "../../component/chat-view";
import { getCharacter } from "../../server/characters";

const routeApi = getRouteApi("/chat/$id");

const ChatPage = () => {
  const character = routeApi.useLoaderData();
  const { conversationId } = routeApi.useSearch();
  return (
    <div className="v2-chat-page">
      <ChatConnectionState />
      <ChatView
        key={`${character.id}:${conversationId ?? "saved"}`}
        characterId={character.id}
        characterName={character.name}
        initialConversationId={conversationId}
      />
    </div>
  );
};

export const Route = createFileRoute("/chat/$id")({
  validateSearch: z.object({ conversationId: z.string().min(1).max(120).optional() }),
  loader: async ({ params, abortController }) => {
    const character = await getCharacter({ data: params.id, signal: abortController.signal });
    if (!character) throw notFound();
    return character;
  },
  pendingComponent: ChatLoadingState,
  errorComponent: ChatErrorState,
  notFoundComponent: ChatUnavailableState,
  component: ChatPage,
});
