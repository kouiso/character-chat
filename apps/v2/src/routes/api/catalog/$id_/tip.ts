// POST /api/catalog/:id/tip — 公開キャラの作者へ通貨を贈る（RIT-208）。
import { createFileRoute } from "@tanstack/react-router";

import { handleTip } from "../../../../server/api-tip";

export const Route = createFileRoute("/api/catalog/$id_/tip")({
  server: {
    handlers: {
      POST: ({ params, request }) => handleTip(params.id, request),
    },
  },
});
