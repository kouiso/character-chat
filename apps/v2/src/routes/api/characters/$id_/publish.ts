// GET・PUT・DELETE /api/characters/:id/publish — キャラの公開状態（RIT-206）。
import { createFileRoute } from "@tanstack/react-router";

import {
  handlePublishSet,
  handlePublishStatus,
  handlePublishUnset,
} from "../../../../server/api-publish";

export const Route = createFileRoute("/api/characters/$id_/publish")({
  server: {
    handlers: {
      GET: ({ params }) => handlePublishStatus(params.id),
      PUT: ({ request, params }) => handlePublishSet(params.id, request),
      DELETE: ({ params }) => handlePublishUnset(params.id),
    },
  },
});
