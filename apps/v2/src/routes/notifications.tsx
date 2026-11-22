// 通知の設定（板 Notifications）。マイの「通知の設定」から入る画面。
import { createFileRoute, getRouteApi, useRouter } from "@tanstack/react-router";

import {
  NotificationsErrorState,
  NotificationsLoadingState,
  NotificationsScreen,
} from "../component/notifications-screen";
import { getNotificationSettings } from "../server/notifications";

const routeApi = getRouteApi("/notifications");

const NotificationsPage = () => {
  const { settings, characters } = routeApi.useLoaderData();
  return <NotificationsScreen settings={settings} characters={characters} />;
};

const NotificationsError = () => {
  const router = useRouter();
  return (
    <NotificationsErrorState
      onRetry={() => {
        void router.invalidate({
          filter: (match) => match.routeId === "/notifications",
          forcePending: true,
        });
      }}
    />
  );
};

export const Route = createFileRoute("/notifications")({
  loader: () => getNotificationSettings(),
  pendingComponent: NotificationsLoadingState,
  errorComponent: NotificationsError,
  component: NotificationsPage,
});
