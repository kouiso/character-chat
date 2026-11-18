// /album ページ用の server fn（clips.ts と同じ分割: loader から直接呼ぶ）。
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { PROMPT_VERSION } from "@v2/prompt";
import { createDb, listConversationImages } from "@v2/db";

import { listAlbumItems } from "./api-album";
import { toConversationImageEntry } from "./api-images";
import { LOCAL_USER_ID } from "./identity";
import { getPlatform } from "./platform";

import type { AlbumItem } from "./api-album";

export const listAlbum = createServerFn({ method: "GET" }).handler(
  async (): Promise<AlbumItem[]> => {
    const { env } = await getPlatform();
    return listAlbumItems(env.DB, LOCAL_USER_ID);
  },
);

// /chat/:id/album — この会話のアルバム（板 TalkAlbum）。GET API と同じ写像を使う。
export const listChatAlbum = createServerFn({ method: "GET" })
  .validator(
    z.object({
      characterId: z.string().min(1).max(120),
      conversationId: z.string().min(1).max(120),
    }).parse,
  )
  .handler(async ({ data }) => {
    const { env } = await getPlatform();
    const rows = await listConversationImages(
      createDb(env.DB),
      { userId: LOCAL_USER_ID, characterId: data.characterId, promptVersion: PROMPT_VERSION },
      data.conversationId,
    );
    return rows.map(toConversationImageEntry);
  });
