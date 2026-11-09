// GET/POST /api/catalog/:id/comments — 公開キャラへのコメント一覧・投稿（RIT-207）。
import { createFileRoute } from "@tanstack/react-router";

import { handleCommentCreate, handleCommentList } from "../../../../server/api-reactions";

export const Route = createFileRoute("/api/catalog/$id_/comments")({
  server: {
    handlers: {
      GET: ({ params }) => handleCommentList(params.id),
      POST: ({ params, request }) => handleCommentCreate(params.id, request),
    },
  },
});
