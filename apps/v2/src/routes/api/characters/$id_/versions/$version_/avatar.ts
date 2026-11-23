// GET /api/characters/:id/versions/:version/avatar — その版の時点の顔の絵。
// 配るかはキャラ単位の canServeAvatar、実体の探し方は版の content.avatarRef を
// resolveAvatar へそのまま渡す（現行の顔しか返せん avatar 口だと旧版の顔を偽るので）。
import { createFileRoute } from "@tanstack/react-router";
import { createDb, readCharacterVersion } from "@v2/db";
import { z } from "zod";

import { canServeAvatar, resolveAvatar } from "../../../../../../server/avatar";
import { listOwnerIds, resolveEditorUserId } from "../../../../../../server/identity";
import { getPlatform } from "../../../../../../server/platform";

const idSchema = z.string().min(1);

const json = (status: number, code: string): Response => Response.json({ code }, { status });

export const handleVersionAvatarRequest = async (
  id: string,
  versionId: string,
  request: Request,
): Promise<Response> => {
  if (!idSchema.safeParse(id).success || !idSchema.safeParse(versionId).success) {
    return json(404, "character_not_found");
  }
  const { env } = await getPlatform();
  const db = createDb(env.DB);
  const owners = await listOwnerIds(db);
  const servable = await canServeAvatar(env.DB, id, owners);
  if (!servable) return json(404, "character_not_found");
  const version = await readCharacterVersion(db, {
    characterId: id,
    versionId,
    userId: await resolveEditorUserId(env.DB, db, id),
  });
  if (!version) return json(404, "version_not_found");
  try {
    const resolved = await resolveAvatar(env, request.url, version.content.avatarRef, "serve");
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
            // 同じ版の絵は変わらんが、版の消えた絵の取り違いを避けるため immutable にはしない。
            "cache-control": "private, max-age=300",
          },
        });
    }
  } catch {
    return json(502, "avatar_storage_failed");
  }
};

export const Route = createFileRoute("/api/characters/$id_/versions/$version_/avatar")({
  server: {
    handlers: {
      GET: ({ request, params }) => handleVersionAvatarRequest(params.id, params.version, request),
    },
  },
});
