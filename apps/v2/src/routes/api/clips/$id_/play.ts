// POST /api/clips/:id/play — 再生数を1足す。
import { createFileRoute } from "@tanstack/react-router";

import { handleClipPlayRequest } from "../../../../server/api-clips";

export const Route = createFileRoute("/api/clips/$id_/play")({
  server: {
    handlers: {
      POST: ({ params }) => handleClipPlayRequest(params.id),
    },
  },
});
