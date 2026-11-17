// POST /api/admin/memory-reindex — 索引の失敗 job の復帰と全記憶の入れ直し（RIT-74）。
import { createFileRoute } from "@tanstack/react-router";

import { handleMemoryReindex } from "../../../server/api-admin-memory";

export const Route = createFileRoute("/api/admin/memory-reindex")({
  server: {
    handlers: {
      POST: ({ request }) => handleMemoryReindex(request),
    },
  },
});
