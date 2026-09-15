// POST /api/chat/:id — 1 ターンを SSE（token* → chunk+ → done）で返す。
// engine/cf を import するのはこのファイルと src/server/* だけ（クライアントバンドルへ
// wrangler/LangGraph を持ち込まんため、画面ファイルと分ける）。
import { createFileRoute } from "@tanstack/react-router";

import { handleChatRequest } from "../../../server/api-chat";

export const Route = createFileRoute("/api/chat/$id")({
  server: {
    handlers: {
      POST: ({ request, params }) => handleChatRequest(params.id, request),
    },
  },
});
