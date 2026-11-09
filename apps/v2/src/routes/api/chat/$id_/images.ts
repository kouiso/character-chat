// POST /api/chat/:id/images — 会話のキャラの画像を1枚生成してタイムラインへ出す（RIT-182）。
// GET で画像履歴一覧、DELETE で画像メッセージの削除（RIT-185）。
import { createFileRoute } from "@tanstack/react-router";

import {
  handleImageDeleteRequest,
  handleImageListRequest,
  handleImageRequest,
} from "../../../../server/api-images";

export const Route = createFileRoute("/api/chat/$id_/images")({
  server: {
    handlers: {
      GET: ({ request, params }) => handleImageListRequest(params.id, request),
      POST: ({ request, params }) => handleImageRequest(params.id, request),
      DELETE: ({ request, params }) => handleImageDeleteRequest(params.id, request),
    },
  },
});
