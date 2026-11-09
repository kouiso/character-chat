// POST /api/tts — 応答テキストの音声合成（RIT-211）。
import { createFileRoute } from "@tanstack/react-router";

import { handleTtsRequest } from "../../server/api-tts";

export const Route = createFileRoute("/api/tts")({
  server: {
    handlers: {
      POST: ({ request }) => handleTtsRequest(request),
    },
  },
});
