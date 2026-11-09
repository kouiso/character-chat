// POST /api/currency/ad-reward — 広告視聴完了の報酬付与（attemptId 冪等・RIT-194）。
import { createFileRoute } from "@tanstack/react-router";

import { handleAdRewardRequest } from "../../../server/api-retention";

export const Route = createFileRoute("/api/currency/ad-reward")({
  server: {
    handlers: {
      POST: ({ request }) => handleAdRewardRequest(request),
    },
  },
});
