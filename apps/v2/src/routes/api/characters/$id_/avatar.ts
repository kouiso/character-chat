// GET /api/characters/:id/avatar — 顔の絵。配るかは canServeAvatar、実体の探し方は
// resolveAvatar（同梱 → R2 avatars/<鍵> → R2 <鍵>）に閉じ込める。
import { createFileRoute } from "@tanstack/react-router";
import { createDb } from "@v2/db";
import { z } from "zod";

import { canServeAvatar, resolveAvatar } from "../../../../server/avatar";
import { handleAvatarPost } from "../../../../server/avatar-upload";
import { listOwnerIds } from "../../../../server/identity";
import { getPlatform } from "../../../../server/platform";

const idSchema = z.string().min(1);

const json = (status: number, code: string): Response => Response.json({ code }, { status });

export const handleAvatarRequest = async (id: string, request: Request): Promise<Response> => {
  if (!idSchema.safeParse(id).success) return json(404, "character_not_found");
  const { env } = await getPlatform();
  const owners = await listOwnerIds(createDb(env.DB));
  const servable = await canServeAvatar(env.DB, id, owners);
  if (!servable) return json(404, "character_not_found");
  try {
    const resolved = await resolveAvatar(env, request.url, servable.avatar, "serve");
    switch (resolved.status) {
      case "unset":
        return json(404, "avatar_unset");
      case "bad_key":
        return json(400, "avatar_bad_key");
      case "missing":
        return json(404, "avatar_missing");
      case "not_image":
        return json(415, "avatar_not_image");
      default:
        return new Response(resolved.body, {
          headers: {
            "content-type": resolved.type,
            "x-content-type-options": "nosniff",
            // 同じ id の絵は差し替わりうるので immutable にはしない。
            "cache-control": "private, max-age=300",
          },
        });
    }
  } catch {
    return json(502, "avatar_storage_failed");
  }
};

export const Route = createFileRoute("/api/characters/$id_/avatar")({
  server: {
    handlers: {
      GET: ({ request, params }) => handleAvatarRequest(params.id, request),
      POST: ({ request, params }) => handleAvatarPost(params.id, request),
    },
  },
});
