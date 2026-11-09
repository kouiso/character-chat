// GET /api/image-generations/:id — 生成の状態を問い合わせ、poll が状態を進める（RIT-182）。
import { createFileRoute } from "@tanstack/react-router";

import { handleImageStatusRequest } from "../../../server/api-images";

export const Route = createFileRoute("/api/image-generations/$id")({
  server: {
    handlers: {
      GET: ({ params }) => handleImageStatusRequest(params.id),
    },
  },
});
