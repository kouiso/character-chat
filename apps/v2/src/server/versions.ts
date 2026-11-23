// /characters/:id/versions（版の履歴）ページ用の server fn。
// /api/characters/:id と /api/characters/:id/versions の読みを loader から直接呼ぶ
// （server/notifications.ts・server/settings.ts と同じ分割）。
import { createServerFn } from "@tanstack/react-start";

import { resolveEditorUserId } from "./identity";
import { getPlatform } from "./platform";

export type VersionRow = { id: string; version: number; createdAt: number };

export type CharacterVersionsPayload = {
  character: { id: string; name: string; revision: number; ownerUserId: string };
  currentVersionId: string | null;
  versions: VersionRow[];
};

export const getCharacterVersions = createServerFn({ method: "GET" })
  .validator((characterId: string) => characterId)
  .handler(async ({ data: characterId }): Promise<CharacterVersionsPayload | null> => {
    const { env } = await getPlatform();
    const { createDb, listCharacterVersions, readCharacterDetail } = await import("@v2/db");
    const db = createDb(env.DB);
    // 旧名義のキャラもその名義で所有を確かめる（api-characters と同じ名義解決）。
    const userId = await resolveEditorUserId(env.DB, db, characterId);
    const [detail, versions] = await Promise.all([
      readCharacterDetail(db, characterId, userId),
      listCharacterVersions(db, characterId, userId),
    ]);
    if (!detail || !versions) return null;
    return {
      character: {
        id: detail.id,
        name: detail.content.name,
        revision: detail.revision,
        ownerUserId: detail.ownerUserId,
      },
      currentVersionId: versions.currentVersionId,
      versions: versions.versions,
    };
  });
