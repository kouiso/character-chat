import { createFileRoute, getRouteApi, notFound } from "@tanstack/react-router";

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
  return (
    <>
      <ChatConnectionState />
      <ChatView characterId={character.id} characterName={character.name} />
    </>
  );
};

export const Route = createFileRoute("/chat/$id")({
  loader: async ({ params }) => {
    const character = await getCharacter({ data: params.id });
    if (!character) throw notFound();
    return character;
  },
  pendingComponent: ChatLoadingState,
  errorComponent: ChatErrorState,
  notFoundComponent: ChatUnavailableState,
  component: ChatPage,
});
