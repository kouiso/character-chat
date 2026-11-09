// POST /api/admin/legacy-migration — 旧記憶・検索塊の v2 への移行実行（RIT-78）。
import { createFileRoute } from "@tanstack/react-router";

import { handleLegacyMigration } from "../../../server/api-admin-migration";

export const Route = createFileRoute("/api/admin/legacy-migration")({
  server: {
    handlers: {
      POST: ({ request }) => handleLegacyMigration(request),
    },
  },
});
