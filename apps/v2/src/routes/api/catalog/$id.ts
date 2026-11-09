// GET /api/catalog/:id — 公開キャラ詳細（RIT-206）。
import { createFileRoute } from "@tanstack/react-router";

import { handleCatalogDetail } from "../../../server/api-publish";

export const Route = createFileRoute("/api/catalog/$id")({
  server: {
    handlers: {
      GET: ({ params }) => handleCatalogDetail(params.id),
    },
  },
});
