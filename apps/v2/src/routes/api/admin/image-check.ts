// GET /api/admin/image-check — 会話の中の画像全件の検査（RIT-80）。読み取りだけ。
import { createFileRoute } from "@tanstack/react-router";

import { handleImageCheck } from "../../../server/api-image-check";

export const Route = createFileRoute("/api/admin/image-check")({
  server: {
    handlers: {
      GET: ({ request }) => handleImageCheck(request),
    },
  },
});
