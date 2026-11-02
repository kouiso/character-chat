import { createFileRoute } from "@tanstack/react-router";

import { handleCharactersRequest } from "../../server/api-characters";

export const Route = createFileRoute("/api/characters")({
  server: {
    handlers: {
      POST: ({ request }) => handleCharactersRequest(request),
    },
  },
});
