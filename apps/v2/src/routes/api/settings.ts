// /api/settings — ユーザー設定。GET=状態、PUT=更新（RIT-199）。
import { createFileRoute } from "@tanstack/react-router";

import { handleSettingsReadRequest, handleSettingsWriteRequest } from "../../server/api-settings";

export const Route = createFileRoute("/api/settings")({
  server: {
    handlers: {
      GET: () => handleSettingsReadRequest(),
      PUT: ({ request }) => handleSettingsWriteRequest(request),
    },
  },
});
