// POST /api/chat/:id/comic — 直近シーンを4コマへ分けて一括生成する（RIT-189）。
import { createFileRoute } from "@tanstack/react-router";

import { handleComicRequest } from "../../../../server/api-images";

export const Route = createFileRoute("/api/chat/$id_/comic")({
  server: {
    handlers: {
      POST: ({ request, params }) => handleComicRequest(params.id, request),
    },
  },
});
