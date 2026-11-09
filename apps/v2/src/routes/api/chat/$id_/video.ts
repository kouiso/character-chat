// POST /api/chat/:id/video — ギャラリー画像を first-frame に動画生成を登録する（RIT-190）。
// GET は generationId 指定で生成状態をポーリングする（完了時に mp4 が R2・メッセージへ入る）。
import { createFileRoute } from "@tanstack/react-router";

import { handleVideoStartRequest, handleVideoStatusRequest } from "../../../../server/api-video";

export const Route = createFileRoute("/api/chat/$id_/video")({
  server: {
    handlers: {
      GET: ({ request, params }) => handleVideoStatusRequest(params.id, request),
      POST: ({ request, params }) => handleVideoStartRequest(params.id, request),
    },
  },
});
