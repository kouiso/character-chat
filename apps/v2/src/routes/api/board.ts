// GET/POST /api/board — 雑談広場の一覧・投稿（RIT-209）。
import { createFileRoute } from "@tanstack/react-router";

import { handleBoardList, handleBoardPost } from "../../server/api-board";

export const Route = createFileRoute("/api/board")({
  server: {
    handlers: {
      GET: ({ request }) => handleBoardList(request),
      POST: ({ request }) => handleBoardPost(request),
    },
  },
});
