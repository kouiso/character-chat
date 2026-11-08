// GET/PUT /api/proactive/characters/:id/settings — キャラごとの話しかけ設定。
// 予定表は ProactiveScheduler DO（1ユーザー1体）の storage が正本。
import { createFileRoute } from "@tanstack/react-router";

import { handleProactiveSettings } from "../../../../../server/api-proactive";

export const Route = createFileRoute("/api/proactive/characters/$id_/settings")({
  server: {
    handlers: {
      GET: ({ request, params }) => handleProactiveSettings(params.id, request),
      PUT: ({ request, params }) => handleProactiveSettings(params.id, request),
    },
  },
});
