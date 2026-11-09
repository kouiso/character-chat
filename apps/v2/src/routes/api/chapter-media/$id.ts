// GET /api/chapter-media/:id — 章挿絵（?panel=n で4コマの各コマ）の配信。所有者確認つき。
import { createFileRoute } from "@tanstack/react-router";

import { readChapterImageKey } from "../../../server/api-story-illustration";
import { readChapterComicPanelKey } from "../../../server/api-story-media";
import { serveOwnedImage } from "../../../server/media";
import { getPlatform } from "../../../server/platform";

export const Route = createFileRoute("/api/chapter-media/$id")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const { env } = await getPlatform();
        const panel = new URL(request.url).searchParams.get("panel");
        const key =
          panel === null
            ? await readChapterImageKey(env.DB, params.id)
            : await readChapterComicPanelKey(env.DB, params.id, Number(panel));
        return serveOwnedImage(key, env.BUCKET);
      },
    },
  },
});
