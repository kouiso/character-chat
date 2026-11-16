// GET /api/admin/character-check — キャラ全件の検査（RIT-80）。読み取りだけ。
import { createFileRoute } from "@tanstack/react-router";

import { handleCharacterCheck } from "../../../server/api-character-check";

export const Route = createFileRoute("/api/admin/character-check")({
  server: {
    handlers: {
      GET: ({ request }) => handleCharacterCheck(request),
    },
  },
});
