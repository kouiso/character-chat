import { createFileRoute, getRouteApi, notFound } from "@tanstack/react-router";
import { z } from "zod";

import {
  ChatErrorState,
  ChatLoadingState,
  ChatUnavailableState,
} from "../../../component/chat-route-state";
import { MemoryScreen } from "../../../component/memory-screen";
import { getCharacter } from "../../../server/characters";

const routeApi = getRouteApi("/chat/$id_/memory");

const MemoryPage = () => {
  const character = routeApi.useLoaderData();
  const { conversationId } = routeApi.useSearch();
  return (
    <MemoryScreen
      characterId={character.id}
      characterName={character.name}
      conversationId={conversationId ?? null}
    />
  );
};

export const Route = createFileRoute("/chat/$id_/memory")({
  validateSearch: z.object({
    conversationId: z.string().min(1).max(120).optional(),
  }),
  loader: async ({ params, abortController }) => {
    const character = await getCharacter({ data: params.id, signal: abortController.signal });
    if (!character) throw notFound();
    return character;
  },
  pendingComponent: ChatLoadingState,
  errorComponent: ChatErrorState,
  notFoundComponent: ChatUnavailableState,
  component: MemoryPage,
});
