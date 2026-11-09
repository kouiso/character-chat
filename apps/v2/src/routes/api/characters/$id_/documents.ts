import { createFileRoute } from "@tanstack/react-router";

import { handleDocumentsRequest } from "../../../../server/api-documents";

export const Route = createFileRoute("/api/characters/$id_/documents")({
  server: {
    handlers: {
      GET: ({ request, params }) => handleDocumentsRequest(params.id, request),
      POST: ({ request, params }) => handleDocumentsRequest(params.id, request),
    },
  },
});
