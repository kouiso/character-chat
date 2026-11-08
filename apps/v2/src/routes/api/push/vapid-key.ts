// GET /api/push/vapid-key — PushManager.subscribe が使う VAPID 公開鍵。
import { createFileRoute } from "@tanstack/react-router";

import { handlePushVapidKey } from "../../../server/api-push";

export const Route = createFileRoute("/api/push/vapid-key")({
  server: {
    handlers: {
      GET: () => handlePushVapidKey(),
    },
  },
});
