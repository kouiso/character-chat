import { createFileRoute } from "@tanstack/react-router";

import { handleDocumentRequest } from "../../../../../server/api-documents";

export const Route = createFileRoute("/api/characters/$id_/documents/$doc")({
  server: {
    handlers: {
      PATCH: ({ request, params }) => handleDocumentRequest(params.id, params.doc, request),
      DELETE: ({ request, params }) => handleDocumentRequest(params.id, params.doc, request),
    },
  },
});
