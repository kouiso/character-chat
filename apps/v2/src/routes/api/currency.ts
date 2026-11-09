// GET /api/currency — 残高と直近の通貨台帳を返す（RIT-191）。
import { createFileRoute } from "@tanstack/react-router";

import { handleCurrencyStatusRequest } from "../../server/api-currency";

export const Route = createFileRoute("/api/currency")({
  server: {
    handlers: {
      GET: ({ request }) => handleCurrencyStatusRequest(request),
    },
  },
});
