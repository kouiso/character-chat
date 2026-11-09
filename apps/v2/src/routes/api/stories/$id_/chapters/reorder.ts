// POST /api/stories/:id/chapters/reorder — 章の並び替え（RIT-214）。
import { createFileRoute } from "@tanstack/react-router";

import { handleChapterReorder } from "../../../../../server/api-stories";

export const Route = createFileRoute("/api/stories/$id_/chapters/reorder")({
  server: {
    handlers: {
      POST: ({ request, params }) => handleChapterReorder(params.id, request),
    },
  },
});
