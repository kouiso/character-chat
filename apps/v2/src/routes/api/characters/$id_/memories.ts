import { createFileRoute } from "@tanstack/react-router";

import { handleMemoriesRequest } from "../../../../server/api-memories";

export const Route = createFileRoute("/api/characters/$id_/memories")({
  server: {
    handlers: {
      GET: ({ request, params }) => handleMemoriesRequest(params.id, request),
      POST: ({ request, params }) => handleMemoriesRequest(params.id, request),
      PATCH: ({ request, params }) => handleMemoriesRequest(params.id, request),
      DELETE: ({ request, params }) => handleMemoriesRequest(params.id, request),
    },
  },
});
