// POST /api/clips — クリップ生成の登録（RIT-30 ギャップ）。
import { createFileRoute } from "@tanstack/react-router";

import { handleClipStartRequest } from "../../server/api-clips";

export const Route = createFileRoute("/api/clips")({
  server: {
    handlers: {
      POST: ({ request }) => handleClipStartRequest(request),
    },
  },
});
