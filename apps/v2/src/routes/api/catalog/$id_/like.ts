// POST /api/catalog/:id/like — いいねの冪等トグル（RIT-207）。
import { createFileRoute } from "@tanstack/react-router";

import { handleLikeToggle } from "../../../../server/api-reactions";

export const Route = createFileRoute("/api/catalog/$id_/like")({
  server: {
    handlers: {
      POST: ({ params }) => handleLikeToggle(params.id),
    },
  },
});
