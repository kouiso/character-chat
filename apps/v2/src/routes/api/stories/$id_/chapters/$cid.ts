// PUT・DELETE /api/stories/:id/chapters/:cid — 章の更新・削除（RIT-214）。
import { createFileRoute } from "@tanstack/react-router";

import { handleChapterDelete, handleChapterPut } from "../../../../../server/api-stories";

export const Route = createFileRoute("/api/stories/$id_/chapters/$cid")({
  server: {
    handlers: {
      PUT: ({ request, params }) => handleChapterPut(params.id, params.cid, request),
      DELETE: ({ params }) => handleChapterDelete(params.id, params.cid),
    },
  },
});
