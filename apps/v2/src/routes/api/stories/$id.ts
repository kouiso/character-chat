// GET・PUT・DELETE /api/stories/:id — ストーリー取得・更新・削除（RIT-214）。
import { createFileRoute } from "@tanstack/react-router";

import { handleStoryDelete, handleStoryGet, handleStoryPut } from "../../../server/api-stories";

export const Route = createFileRoute("/api/stories/$id")({
  server: {
    handlers: {
      GET: ({ params }) => handleStoryGet(params.id),
      PUT: ({ request, params }) => handleStoryPut(params.id, request),
      DELETE: ({ params }) => handleStoryDelete(params.id),
    },
  },
});
