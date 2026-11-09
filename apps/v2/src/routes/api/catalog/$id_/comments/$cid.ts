// DELETE /api/catalog/:id/comments/:cid — 本人コメントの削除（RIT-207）。
import { createFileRoute } from "@tanstack/react-router";

import { handleCommentDelete } from "../../../../../server/api-reactions";

export const Route = createFileRoute("/api/catalog/$id_/comments/$cid")({
  server: {
    handlers: {
      DELETE: ({ params }) => handleCommentDelete(params.id, params.cid),
    },
  },
});
