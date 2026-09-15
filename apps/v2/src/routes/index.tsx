import { createFileRoute, getRouteApi, Link } from "@tanstack/react-router";

import { listCharacters } from "../server/characters";

const routeApi = getRouteApi("/");

const CharacterListPage = () => {
  const characters = routeApi.useLoaderData();

  return (
    <div className="v2-list">
      <h1>キャラクター</h1>
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
  loader: () => listCharacters(),
  component: CharacterListPage,
});
