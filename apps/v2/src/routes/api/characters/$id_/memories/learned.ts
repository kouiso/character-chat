// GET /api/characters/:id/memories/learned — 「覚えた：…」リンクの問い合わせ（RIT-92）。
import { createFileRoute } from "@tanstack/react-router";

import { handleMemoriesLearnedRequest } from "../../../../../server/api-memories";

export const Route = createFileRoute("/api/characters/$id_/memories/learned")({
  server: {
    handlers: {
      GET: ({ request, params }) => handleMemoriesLearnedRequest(params.id, request),
    },
  },
});
