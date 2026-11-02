import { createFileRoute } from "@tanstack/react-router";

import { handleCharacterRequest } from "../../../server/api-characters";

export const Route = createFileRoute("/api/characters/$id")({
  server: {
    handlers: {
      GET: ({ request, params }) => handleCharacterRequest(params.id, request),
      PUT: ({ request, params }) => handleCharacterRequest(params.id, request),
    },
  },
});
