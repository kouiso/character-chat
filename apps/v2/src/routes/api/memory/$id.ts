import { createFileRoute } from "@tanstack/react-router";

import { handleMemoryRequest } from "../../../server/api-memory";

export const Route = createFileRoute("/api/memory/$id")({
  server: {
    handlers: {
      GET: ({ params, request }) => handleMemoryRequest(params.id, request),
      POST: ({ params, request }) => handleMemoryRequest(params.id, request),
      PUT: ({ params, request }) => handleMemoryRequest(params.id, request),
      DELETE: ({ params, request }) => handleMemoryRequest(params.id, request),
    },
  },
});
