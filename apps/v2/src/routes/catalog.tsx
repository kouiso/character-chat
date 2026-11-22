// 出会う（板 Meet・MeetList・MeetEmpty）: 会える子を 1 人ずつ送って選ぶか、
// 一覧（札・見たい子・名前さがし）からプロフィールへ。
// 旧公開カタログ一覧（いいね・コメント・贈与・フォーク）は板に無い画面なので
// ここでは出さず、API だけ残す（仕様書でも公開一覧は「あとで足す」）。
import { createFileRoute, getRouteApi } from "@tanstack/react-router";

import { MeetErrorState, MeetLoadingState, MeetScreen } from "../component/meet-screen";
import { listMeet } from "../server/meet";

const routeApi = getRouteApi("/catalog");

const MeetPage = () => {
  const items = routeApi.useLoaderData();
  return <MeetScreen items={items} />;
};

export const Route = createFileRoute("/catalog")({
  loader: () => listMeet(),
  pendingComponent: MeetLoadingState,
  errorComponent: MeetErrorState,
  component: MeetPage,
});
