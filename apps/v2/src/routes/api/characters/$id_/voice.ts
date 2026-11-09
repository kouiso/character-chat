// GET・PUT /api/characters/:id/voice — キャラ別ボイス設定（RIT-210）。
import { createFileRoute } from "@tanstack/react-router";

import { handleVoiceGet, handleVoicePut } from "../../../../server/api-voice";

export const Route = createFileRoute("/api/characters/$id_/voice")({
  server: {
    handlers: {
      GET: ({ params }) => handleVoiceGet(params.id),
      PUT: ({ request, params }) => handleVoicePut(params.id, request),
    },
  },
});
