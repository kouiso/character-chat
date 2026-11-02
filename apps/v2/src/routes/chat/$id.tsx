import { createFileRoute, getRouteApi, notFound } from "@tanstack/react-router";
import { z } from "zod";

import { ChatView } from "../../component/chat-view";
import { getCharacter } from "../../server/characters";

const routeApi = getRouteApi("/chat/$id");

const ChatPage = () => {
  const character = routeApi.useLoaderData();
  const { conversationId } = routeApi.useSearch();
  return (
    <ChatView
      key={`${character.id}:${conversationId ?? "saved"}`}
      characterId={character.id}
      characterName={character.name}
      initialConversationId={conversationId}
    />
  );
};

export const Route = createFileRoute("/chat/$id")({
  validateSearch: z.object({ conversationId: z.string().min(1).max(120).optional() }),
  loader: async ({ params }) => {
    const character = await getCharacter({ data: params.id });
    if (!character) throw notFound();
    return character;
  },
  component: ChatPage,
});
