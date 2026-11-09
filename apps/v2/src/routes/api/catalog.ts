// GET /api/catalog — 公開キャラ一覧（RIT-206）。
import { createFileRoute } from "@tanstack/react-router";

import { handleCatalogList } from "../../server/api-publish";

export const Route = createFileRoute("/api/catalog")({
  server: {
    handlers: {
      GET: () => handleCatalogList(),
    },
  },
});
