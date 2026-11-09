// POST /api/catalog/:id/follow — キャラ/作者フォローの冪等トグル（RIT-207）。
import { createFileRoute } from "@tanstack/react-router";

import { handleFollowToggle } from "../../../../server/api-reactions";

export const Route = createFileRoute("/api/catalog/$id_/follow")({
  server: {
    handlers: {
      POST: ({ params, request }) => handleFollowToggle(params.id, request),
    },
  },
});
