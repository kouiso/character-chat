// GET・POST /api/chat/:id/branch — 会話メッセージの枝分かれ操作（RIT-202）。
import { createFileRoute } from "@tanstack/react-router";

import { handleBranchAction, handleBranchList } from "../../../../server/api-branch";

export const Route = createFileRoute("/api/chat/$id_/branch")({
  server: {
    handlers: {
      GET: ({ request }) => handleBranchList(request),
      POST: ({ request, params }) => handleBranchAction(params.id, request),
    },
  },
});
