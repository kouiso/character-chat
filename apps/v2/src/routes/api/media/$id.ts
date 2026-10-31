import { createFileRoute } from "@tanstack/react-router";
import { createDb, readOwnedImageKey } from "@v2/db";

import { LOCAL_USER_ID } from "../../../server/identity";
import { serveOwnedImage } from "../../../server/media";
import { getPlatform } from "../../../server/platform";

export const Route = createFileRoute("/api/media/$id")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { env } = await getPlatform();
        const key = await readOwnedImageKey(createDb(env.DB), LOCAL_USER_ID, params.id);
        return serveOwnedImage(key, env.BUCKET);
      },
    },
  },
});
