// POST/GET /api/stories/:id/chapters/:cid/video — 章のプロットビデオ変換（RIT-217）。
import { createFileRoute } from "@tanstack/react-router";

import {
  handleChapterVideoGet,
  handleChapterVideoPost,
} from "../../../../../../server/api-story-media";

export const Route = createFileRoute("/api/stories/$id_/chapters/$cid_/video")({
  server: {
    handlers: {
      POST: ({ params }) => handleChapterVideoPost(params.id, params.cid),
      GET: ({ params }) => handleChapterVideoGet(params.id, params.cid),
    },
  },
});
