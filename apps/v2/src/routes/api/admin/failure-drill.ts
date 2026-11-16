// POST /api/admin/failure-drill — 訓練用の知らせ（RIT-66 FR-7）。
import { createFileRoute } from "@tanstack/react-router";

import { handleFailureDrill } from "../../../server/api-failure-drill";

export const Route = createFileRoute("/api/admin/failure-drill")({
  server: {
    handlers: {
      POST: () => handleFailureDrill(),
    },
  },
});
