// POST /api/chat/:id/images — 会話のキャラの画像を1枚生成してタイムラインへ出す（RIT-182）。
import { createFileRoute } from "@tanstack/react-router";

import { handleImageRequest } from "../../../../server/api-images";

export const Route = createFileRoute("/api/chat/$id_/images")({
  server: {
    handlers: {
      POST: ({ request, params }) => handleImageRequest(params.id, request),
    },
  },
});
