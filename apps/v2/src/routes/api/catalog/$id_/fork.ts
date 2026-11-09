// POST /api/catalog/:id/fork — 公開キャラを自分のライブラリへ複製（RIT-206）。
import { createFileRoute } from "@tanstack/react-router";

import { handleCatalogFork } from "../../../../server/api-publish";

export const Route = createFileRoute("/api/catalog/$id_/fork")({
  server: {
    handlers: {
      POST: ({ params }) => handleCatalogFork(params.id),
    },
  },
});
