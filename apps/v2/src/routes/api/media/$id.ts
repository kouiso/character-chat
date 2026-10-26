import { createFileRoute } from "@tanstack/react-router";
import { createDb, readOwnedImageKey } from "@v2/db";

import { LOCAL_USER_ID } from "../../../server/identity";
import { getPlatform } from "../../../server/platform";

export const Route = createFileRoute("/api/media/$id")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { env } = await getPlatform();
        const key = await readOwnedImageKey(createDb(env.DB), LOCAL_USER_ID, params.id);
        if (!key) return new Response(null, { status: 404 });
        const object = await env.BUCKET.get(key);
        if (!object) return new Response(null, { status: 404 });
        const type = object.httpMetadata?.contentType;
        if (!type || !/^image\/(png|jpeg|webp|gif|avif)$/.test(type)) {
          return new Response(null, { status: 415 });
        }
        return new Response(object.body, {
          headers: { "content-type": type, "x-content-type-options": "nosniff" },
        });
      },
    },
  },
});
