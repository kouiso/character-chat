// /api/plan — 月額プラン。GET=状態、POST=有効化（RIT-193）。
import { createFileRoute } from "@tanstack/react-router";

import { handlePlanActivateRequest, handlePlanStatusRequest } from "../../server/api-plan";

export const Route = createFileRoute("/api/plan")({
  server: {
    handlers: {
      GET: () => handlePlanStatusRequest(),
      POST: ({ request }) => handlePlanActivateRequest(request),
    },
  },
});
