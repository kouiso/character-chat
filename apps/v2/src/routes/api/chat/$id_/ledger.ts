// PATCH /api/chat/:id/ledger — 会話の最新台帳を手で直す（RIT-118）。
import { createFileRoute } from "@tanstack/react-router";

import { handleLedgerRequest } from "../../../../server/api-ledger";

export const Route = createFileRoute("/api/chat/$id_/ledger")({
  server: {
    handlers: {
      PATCH: ({ request, params }) => handleLedgerRequest(params.id, request),
    },
  },
});
