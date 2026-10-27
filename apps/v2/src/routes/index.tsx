import { createFileRoute, getRouteApi } from "@tanstack/react-router";

import { CharacterWorkspace } from "../component/character-workspace";
import {
  ListConnectionState,
  ListEmptyState,
  ListErrorState,
  ListLoadingState,
} from "../component/list-route-state";
import {
  listCharacters,
  listEditableCharacters,
  loadCharacterEditor,
  restoreCharacterEditor,
  saveCharacterEditor,
} from "../server/characters";

const routeApi = getRouteApi("/");

const CharacterListPage = () => {
  const characters = routeApi.useLoaderData();

  return (
    <CharacterWorkspace
      characters={characters}
      listState={(empty) => (empty ? <ListEmptyState /> : <ListConnectionState />)}
      transport={{
        list: () => listEditableCharacters(),
        load: (id) => loadCharacterEditor({ data: id }),
        save: (input) => saveCharacterEditor({ data: input }),
        restore: (input) => restoreCharacterEditor({ data: input }),
      }}
    />
  );
};

export const Route = createFileRoute("/")({
  loader: () => listCharacters(),
  pendingComponent: ListLoadingState,
  errorComponent: ListErrorState,
  component: CharacterListPage,
});
