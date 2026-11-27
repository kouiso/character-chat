// 版の履歴（板 Versions）。キャラの編集の「前の設定」から入る画面。
import { createFileRoute, getRouteApi, notFound, useRouter } from "@tanstack/react-router";

import {
  VersionsErrorState,
  VersionsLoadingState,
  VersionsNotFoundState,
  VersionsScreen,
} from "../../../component/versions-screen";
import { getCharacterVersions } from "../../../server/versions";

const routeApi = getRouteApi("/characters/$id_/versions");

const VersionsPage = () => {
  const data = routeApi.useLoaderData();
  return (
    <VersionsScreen
      key={data.character.id}
      character={data.character}
      currentVersionId={data.currentVersionId}
      versions={data.versions}
    />
  );
};

const VersionsError = () => {
  const router = useRouter();
  const { id } = routeApi.useParams();
  return (
    <VersionsErrorState
      characterId={id}
      onRetry={() => {
        void router.invalidate({
          filter: (match) => match.routeId === "/characters/$id_/versions",
          forcePending: true,
        });
      }}
    />
  );
};

const VersionsPending = () => {
  const { id } = routeApi.useParams();
  return <VersionsLoadingState characterId={id} />;
};

const VersionsNotFound = () => {
  const { id } = routeApi.useParams();
  return <VersionsNotFoundState characterId={id} />;
};

export const Route = createFileRoute("/characters/$id_/versions")({
  loader: async ({ params, abortController }) => {
    const data = await getCharacterVersions({
      data: params.id,
      signal: abortController.signal,
    });
    if (!data) throw notFound();
    return data;
  },
  pendingComponent: VersionsPending,
  errorComponent: VersionsError,
  notFoundComponent: VersionsNotFound,
  component: VersionsPage,
});
