// DELETE /api/board/:id — 本人投稿の削除（RIT-209）。
import { createFileRoute } from "@tanstack/react-router";

import { handleBoardDelete } from "../../../server/api-board";

export const Route = createFileRoute("/api/board/$id")({
  server: {
    handlers: {
      DELETE: ({ params }) => handleBoardDelete(params.id),
    },
  },
});
