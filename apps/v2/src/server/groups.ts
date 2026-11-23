// パーティモード画面用の server fn（RIT-216）。API と同じクエリを loader から直接呼ぶ。
import { createServerFn } from "@tanstack/react-start";
import { createDb, listGroupContinuations, listGroups, type GroupRow } from "@v2/db";
import { z } from "zod";

import { loadGroupView, type GroupView } from "./api-group";
import { readCharacter } from "./character-data.server";
import { LOCAL_USER_ID } from "./identity";
import { getPlatform } from "./platform";

export const listUserGroups = createServerFn({ method: "GET" }).handler(
  async (): Promise<GroupRow[]> => {
    const { env } = await getPlatform();
    return listGroups(createDb(env.DB), LOCAL_USER_ID);
  },
);

// ホームの「つづきから」に並べる場。会話と同じく発言のある順で返す。
export const listSavedGroups = createServerFn({ method: "GET" }).handler(async () => {
  const { env } = await getPlatform();
  return listGroupContinuations(createDb(env.DB), LOCAL_USER_ID);
});

export const getGroupView = createServerFn({ method: "GET" })
  .inputValidator(z.string().min(1))
  .handler(async ({ data: groupId }): Promise<GroupView | null> => {
    const { env } = await getPlatform();
    return loadGroupView(createDb(env.DB), groupId, async (characterId) => {
      const { ok } = await readCharacter(characterId);
      return ok?.name ?? null;
    });
  });
