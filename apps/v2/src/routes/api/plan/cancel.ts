// POST /api/plan/cancel — プラン解約（期限で段階が落ちる・RIT-193）。
import { createFileRoute } from "@tanstack/react-router";

import { handlePlanCancelRequest } from "../../../server/api-plan";

export const Route = createFileRoute("/api/plan/cancel")({
  server: {
    handlers: {
      POST: () => handlePlanCancelRequest(),
    },
  },
});
