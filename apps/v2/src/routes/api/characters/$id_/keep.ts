// PUT・DELETE /api/characters/:id/keep — 出会うの「とっておく」の印（板 Meet）。
import { createFileRoute } from "@tanstack/react-router";

import { handleKeepSet, handleKeepUnset } from "../../../../server/api-meet";

export const Route = createFileRoute("/api/characters/$id_/keep")({
  server: {
    handlers: {
      PUT: ({ params }) => handleKeepSet(params.id),
      DELETE: ({ params }) => handleKeepUnset(params.id),
    },
  },
});
