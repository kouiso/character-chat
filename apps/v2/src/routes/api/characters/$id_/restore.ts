import { createFileRoute } from "@tanstack/react-router";

import { handleCharacterRestoreRequest } from "../../../../server/api-characters";

export const Route = createFileRoute("/api/characters/$id_/restore")({
  server: {
    handlers: {
      POST: ({ request, params }) => handleCharacterRestoreRequest(params.id, request),
    },
  },
});
