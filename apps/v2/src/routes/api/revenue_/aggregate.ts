// POST /api/revenue/aggregate — 台帳から収益行を冪等集計（RIT-195）。
import { createFileRoute } from "@tanstack/react-router";

import { handleRevenueAggregate } from "../../../server/api-revenue";

export const Route = createFileRoute("/api/revenue_/aggregate")({
  server: {
    handlers: {
      POST: () => handleRevenueAggregate(),
    },
  },
});
