// POST /api/chat/:id/withdraw — 「入力に戻す」。失敗した受付を取り下げて、
// 送信文が入力へ戻ってよいかを、保存済みかどうかと一緒に返す（RIT-65/RIT-90）。
import { createFileRoute } from "@tanstack/react-router";

import { handleWithdrawRequest } from "../../../../server/api-chat";

export const Route = createFileRoute("/api/chat/$id_/withdraw")({
  server: {
    handlers: {
      POST: ({ request, params }) => handleWithdrawRequest(params.id, request),
    },
  },
});
