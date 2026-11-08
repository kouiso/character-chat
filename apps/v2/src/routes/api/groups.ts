// POST /api/groups — 同じ場（グループ会話）を2人以上のキャラで作成する。
import { createFileRoute } from "@tanstack/react-router";

import { handleCreateGroup } from "../../server/api-group";

export const Route = createFileRoute("/api/groups")({
  server: {
    handlers: {
      POST: ({ request }) => handleCreateGroup(request),
    },
  },
});
