import { createFileRoute, getRouteApi, notFound } from "@tanstack/react-router";
import { z } from "zod";

import {
  ChatConnectionState,
  ChatErrorState,
  ChatLoadingState,
  ChatUnavailableState,
} from "../../component/chat-route-state";
import { ChatView } from "../../component/chat-view";
import { ProactiveToggle } from "../../component/proactive-toggle";
import { getCharacter } from "../../server/characters";

const routeApi = getRouteApi("/chat/$id");

const ChatPage = () => {
  const character = routeApi.useLoaderData();
  const { conversationId, newChat } = routeApi.useSearch();
  return (
    <div className="v2-chat-page">
      <ChatConnectionState />
      <ProactiveToggle key={character.id} characterId={character.id} />
      <ChatView
        key={`${character.id}:${conversationId ?? newChat ?? "saved"}`}
        characterId={character.id}
        characterName={character.name}
        characterAvatar={character.avatar}
        initialConversationId={conversationId}
        newConversationKey={newChat}
      />
    </div>
  );
};

export const Route = createFileRoute("/chat/$id")({
  validateSearch: z.object({
    conversationId: z.string().min(1).max(120).optional(),
    newChat: z.string().uuid().optional(),
  }),
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
