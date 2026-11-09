// POST /api/stories/:id/chapters/:cid/illustration — 章挿絵の生成（RIT-215）。
import { createFileRoute } from "@tanstack/react-router";

import { handleChapterIllustrationPost } from "../../../../../../server/api-story-illustration";

export const Route = createFileRoute("/api/stories/$id_/chapters/$cid_/illustration")({
  server: {
    handlers: {
      POST: ({ params }) => handleChapterIllustrationPost(params.id, params.cid),
    },
  },
});
