// GET /api/chapter-media/:id — 章挿絵の配信（RIT-215）。所有者確認つき。
import { createFileRoute } from "@tanstack/react-router";

import { readChapterImageKey } from "../../../server/api-story-illustration";
import { serveOwnedImage } from "../../../server/media";
import { getPlatform } from "../../../server/platform";

export const Route = createFileRoute("/api/chapter-media/$id")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { env } = await getPlatform();
        const key = await readChapterImageKey(env.DB, params.id);
        return serveOwnedImage(key, env.BUCKET);
      },
    },
  },
});
