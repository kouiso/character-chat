// GET /api/revenue — 自分の収益一覧と合計（RIT-195）。
import { createFileRoute } from "@tanstack/react-router";

import { handleRevenueList } from "../../server/api-revenue";

export const Route = createFileRoute("/api/revenue")({
  server: {
    handlers: {
      GET: () => handleRevenueList(),
    },
  },
});
