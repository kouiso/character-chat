// POST/DELETE /api/push/subscriptions — 端末の push 購読を D1 に登録・解除する。
import { createFileRoute } from "@tanstack/react-router";

import { handlePushSubscriptions } from "../../../server/api-push";

export const Route = createFileRoute("/api/push/subscriptions")({
  server: {
    handlers: {
      POST: ({ request }) => handlePushSubscriptions(request),
      DELETE: ({ request }) => handlePushSubscriptions(request),
    },
  },
});
