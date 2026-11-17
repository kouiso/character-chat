import { createFileRoute, getRouteApi, useRouter } from "@tanstack/react-router";

import {
  lastTalkedMap,
  MyErrorState,
  MyLoadingState,
  MyScreen,
  type MyCharacter,
} from "../component/my-screen";
import { listCharacters, listSavedConversations } from "../server/characters";

const routeApi = getRouteApi("/my");

const MyPage = () => {
  const { characters, conversations } = routeApi.useLoaderData();
  const lastTalked = lastTalkedMap(conversations);
  const rows: MyCharacter[] = characters.map((character) => ({
    ...character,
    lastTalkedAt: lastTalked.get(character.id) ?? null,
  }));
  return <MyScreen characters={rows} />;
};

const MyPending = () => <MyLoadingState />;

const MyError = () => {
  const router = useRouter();
  return (
    <MyErrorState
      onRetry={() => {
        void router.invalidate({ filter: (match) => match.routeId === "/my", forcePending: true });
      }}
    />
  );
};

export const Route = createFileRoute("/my")({
  pendingComponent: MyPending,
  errorComponent: MyError,
  loader: async ({ abortController }) => {
    const [characters, conversations] = await Promise.all([
      listCharacters({ signal: abortController.signal }),
      listSavedConversations({ signal: abortController.signal }),
    ]);
    return { characters, conversations };
  },
  component: MyPage,
});
