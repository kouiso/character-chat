import { createFileRoute } from "@tanstack/react-router";

import { handleCharacterVersionsRequest } from "../../../../server/api-characters";

export const Route = createFileRoute("/api/characters/$id_/versions")({
  server: {
    handlers: {
      GET: ({ request, params }) => handleCharacterVersionsRequest(params.id, request),
    },
  },
});
