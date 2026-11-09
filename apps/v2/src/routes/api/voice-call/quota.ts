// GET・POST /api/voice-call/quota — 音声通話の日次無料枠（RIT-213）。
import { createFileRoute } from "@tanstack/react-router";

import { handleVoiceCallQuotaAdd, handleVoiceCallQuotaGet } from "../../../server/api-voice-call";

export const Route = createFileRoute("/api/voice-call/quota")({
  server: {
    handlers: {
      GET: () => handleVoiceCallQuotaGet(),
      POST: ({ request }) => handleVoiceCallQuotaAdd(request),
    },
  },
});
