// GET /api/clips/:id — クリップ生成状態のポーリング。
import { createFileRoute } from "@tanstack/react-router";

import { handleClipStatusRequest } from "../../../server/api-clips";

export const Route = createFileRoute("/api/clips/$id")({
  server: {
    handlers: {
      GET: ({ params }) => handleClipStatusRequest(params.id),
    },
  },
});
