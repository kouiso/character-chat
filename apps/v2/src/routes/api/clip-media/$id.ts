// GET /api/clip-media/:id — クリップ動画の配信（所有者確認つき）。
import { createFileRoute } from "@tanstack/react-router";

import { readClipVideoKey } from "../../../server/api-clips";
import { serveOwnedImage } from "../../../server/media";
import { getPlatform } from "../../../server/platform";

export const Route = createFileRoute("/api/clip-media/$id")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { env } = await getPlatform();
        const key = await readClipVideoKey(env.DB, params.id);
        return serveOwnedImage(key, env.BUCKET);
      },
    },
  },
});
