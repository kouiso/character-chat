// GET /api/follows — 自分のフォロー一覧（RIT-207）。
import { createFileRoute } from "@tanstack/react-router";

import { handleFollowList } from "../../server/api-reactions";

export const Route = createFileRoute("/api/follows")({
  server: {
    handlers: {
      GET: () => handleFollowList(),
    },
  },
});
