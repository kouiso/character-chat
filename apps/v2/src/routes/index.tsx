import { createFileRoute, getRouteApi, Link } from "@tanstack/react-router";

import {
  ListConnectionState,
  ListEmptyState,
  ListErrorState,
  ListLoadingState,
} from "../component/list-route-state";
import { listCharacters } from "../server/characters";

const routeApi = getRouteApi("/");

const CharacterListPage = () => {
  const characters = routeApi.useLoaderData();

  return (
    <div className="v2-list">
      {characters.length > 0 && <ListConnectionState />}
      <h1>キャラクター</h1>
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
  loader: () => listCharacters(),
  pendingComponent: ListLoadingState,
  errorComponent: ListErrorState,
  component: CharacterListPage,
});
