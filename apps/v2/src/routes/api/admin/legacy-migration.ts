// POST /api/admin/legacy-migration — 旧会話の v2 への取り込み（RIT-77）。mode は
// sources・conversations・verify-conversations の 3 つ。
import { createFileRoute } from "@tanstack/react-router";

import { handleLegacyMigration } from "../../../server/api-admin-migration";

export const Route = createFileRoute("/api/admin/legacy-migration")({
  server: {
    handlers: {
      POST: ({ request }) => handleLegacyMigration(request),
    },
  },
});
