import { createFileRoute, getRouteApi, Link, useNavigate } from "@tanstack/react-router";

import { CharacterEditor } from "../../component/character-editor";
import { MemoryPanel } from "../../component/memory-panel";
import { readCharacterEditorIdentity } from "../../server/character-editor-identity";

const routeApi = getRouteApi("/characters/$id");

const EditCharacterPage = () => {
  const { ownerUserId } = routeApi.useLoaderData();
  const { id } = routeApi.useParams();
  const navigate = useNavigate();
  return (
    <main className="v2-editor">
      <Link to="/">キャラクター一覧へ</Link>
      <CharacterEditor
        key={id}
        characterId={id}
        ownerUserId={ownerUserId}
        onSaved={async (characterId) => {
          await navigate({
            to: "/chat/$id",
            params: { id: characterId },
            search: { newChat: crypto.randomUUID() },
          });
        }}
      />
      <MemoryPanel characterId={id} />
    </main>
  );
};

export const Route = createFileRoute("/characters/$id")({
  loader: () => readCharacterEditorIdentity(),
  component: EditCharacterPage,
});
