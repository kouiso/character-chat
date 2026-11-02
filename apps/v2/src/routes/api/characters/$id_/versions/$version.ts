import { createFileRoute } from "@tanstack/react-router";

import { handleCharacterVersionRequest } from "../../../../../server/api-characters";

export const Route = createFileRoute("/api/characters/$id_/versions/$version")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        handleCharacterVersionRequest(params.id, params.version, request),
    },
  },
});
