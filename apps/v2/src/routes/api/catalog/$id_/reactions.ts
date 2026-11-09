// GET /api/catalog/:id/reactions — いいね/コメント数と自分のリアクション状態（RIT-207）。
import { createFileRoute } from "@tanstack/react-router";

import { handleReactions } from "../../../../server/api-reactions";

export const Route = createFileRoute("/api/catalog/$id_/reactions")({
  server: {
    handlers: {
      GET: ({ params }) => handleReactions(params.id),
    },
  },
});
