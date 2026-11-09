// POST /api/stories/:id/chapters/:cid/comic — 章の4コマ変換（RIT-217）。
import { createFileRoute } from "@tanstack/react-router";

import { handleChapterComicPost } from "../../../../../../server/api-story-media";

export const Route = createFileRoute("/api/stories/$id_/chapters/$cid_/comic")({
  server: {
    handlers: {
      POST: ({ params }) => handleChapterComicPost(params.id, params.cid),
    },
  },
});
