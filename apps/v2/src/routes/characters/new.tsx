import { createFileRoute, getRouteApi, Link, useNavigate } from "@tanstack/react-router";

import { CharacterEditor } from "../../component/character-editor";
import { readCharacterEditorIdentity } from "../../server/character-editor-identity";

const routeApi = getRouteApi("/characters/new");

const NewCharacterPage = () => {
  const { ownerUserId } = routeApi.useLoaderData();
  const navigate = useNavigate();
  return (
    <main className="v2-editor">
      <Link to="/">キャラクター一覧へ</Link>
      <CharacterEditor
        ownerUserId={ownerUserId}
        onSaved={async (id) => {
          await navigate({
            to: "/chat/$id",
            params: { id },
            search: { newChat: crypto.randomUUID() },
          });
        }}
      />
    </main>
  );
};

export const Route = createFileRoute("/characters/new")({
  loader: () => readCharacterEditorIdentity(),
  component: NewCharacterPage,
});
