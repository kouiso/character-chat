// GET/POST /api/groups — 自分の場一覧 / 同じ場を2人以上のキャラで作成する。
import { createFileRoute } from "@tanstack/react-router";

import { handleCreateGroup, handleListGroups } from "../../server/api-group";

export const Route = createFileRoute("/api/groups")({
  server: {
    handlers: {
      GET: () => handleListGroups(),
      POST: ({ request }) => handleCreateGroup(request),
    },
  },
});
