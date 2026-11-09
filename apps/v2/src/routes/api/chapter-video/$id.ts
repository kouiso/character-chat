// GET /api/chapter-video/:id — 章動画の配信（RIT-217）。所有者確認つき。
import { createFileRoute } from "@tanstack/react-router";

import { readChapterVideoKey } from "../../../server/api-story-media";
import { serveOwnedImage } from "../../../server/media";
import { getPlatform } from "../../../server/platform";

export const Route = createFileRoute("/api/chapter-video/$id")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { env } = await getPlatform();
        const key = await readChapterVideoKey(env.DB, params.id);
        return serveOwnedImage(key, env.BUCKET);
      },
    },
  },
});
