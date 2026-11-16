import { createFileRoute } from "@tanstack/react-router";

import { handleMemoriesRestoreRequest } from "../../../../../server/api-memories";

export const Route = createFileRoute("/api/characters/$id_/memories_/restore")({
  server: {
    handlers: {
      POST: ({ request, params }) => handleMemoriesRestoreRequest(params.id, request),
    },
  },
});
