// GET・PATCH /api/chat/:id/ledger — 会話の最新台帳を読み・手で直す（RIT-118）。
import { createFileRoute } from "@tanstack/react-router";

import { handleLedgerGet, handleLedgerRequest } from "../../../../server/api-ledger";

export const Route = createFileRoute("/api/chat/$id_/ledger")({
  server: {
    handlers: {
      GET: ({ request, params }) => handleLedgerGet(params.id, request),
      PATCH: ({ request, params }) => handleLedgerRequest(params.id, request),
    },
  },
});
