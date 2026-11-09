// GET・POST /api/chat/:id/marks — メッセージへの印（ブックマーク・いいね）（RIT-204）。
import { createFileRoute } from "@tanstack/react-router";

import { handleMarkList, handleMarkToggle } from "../../../../server/api-marks";

export const Route = createFileRoute("/api/chat/$id_/marks")({
  server: {
    handlers: {
      GET: ({ request }) => handleMarkList(request),
      POST: ({ request }) => handleMarkToggle(request),
    },
  },
});
