// GET /api/chat/:id/history?conversationId=… — v2_* に保存済みの履歴を JSON で返す。
// ディレクトリ名の `$id_` は TanStack Router の非ネスト指定（`$id.ts` の子にせず独立ルートにする）。
import { createFileRoute } from "@tanstack/react-router";

import { handleHistoryRequest } from "../../../../server/api-chat";

export const Route = createFileRoute("/api/chat/$id_/history")({
  server: {
    handlers: {
      GET: ({ request, params }) => handleHistoryRequest(params.id, request),
    },
  },
});
