// GET・POST /api/stories — ストーリー一覧・作成（RIT-214）。
import { createFileRoute } from "@tanstack/react-router";

import { handleStoriesGet, handleStoriesPost } from "../../server/api-stories";

export const Route = createFileRoute("/api/stories")({
  server: {
    handlers: {
      GET: () => handleStoriesGet(),
      POST: ({ request }) => handleStoriesPost(request),
    },
  },
});
