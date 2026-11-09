// POST /api/chat/:id/images — 会話起点の画像生成を起動する（RIT-182）。
import { createFileRoute } from "@tanstack/react-router";

import { handleCreateImageRequest } from "../../../../server/api-images";

export const Route = createFileRoute("/api/chat/$id_/images")({
  server: {
    handlers: {
      POST: ({ request, params }) => handleCreateImageRequest(params.id, request),
    },
  },
});
