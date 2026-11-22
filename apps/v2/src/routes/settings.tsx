// 設定（板 Settings）。マイの「設定」から入る、押してすぐ効く設定の画面。
import { createFileRoute, getRouteApi, useRouter } from "@tanstack/react-router";

import {
  SettingsErrorState,
  SettingsLoadingState,
  SettingsScreen,
} from "../component/settings-screen";
import { getUserSettings } from "../server/settings";

const routeApi = getRouteApi("/settings");

const SettingsPage = () => {
  const settings = routeApi.useLoaderData();
  return <SettingsScreen settings={settings} />;
};

const SettingsError = () => {
  const router = useRouter();
  return (
    <SettingsErrorState
      onRetry={() => {
        void router.invalidate({
          filter: (match) => match.routeId === "/settings",
          forcePending: true,
        });
      }}
    />
  );
};

export const Route = createFileRoute("/settings")({
  loader: () => getUserSettings(),
  pendingComponent: SettingsLoadingState,
  errorComponent: SettingsError,
  component: SettingsPage,
});
