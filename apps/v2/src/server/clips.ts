// /clips・/create ページ用の server fn（catalog.ts と同じ分割: loader から直接呼ぶ）。
import { createServerFn } from "@tanstack/react-start";

import { listClipRows, listClippableImages } from "./api-clips";
import { LOCAL_USER_ID } from "./identity";
import { getPlatform } from "./platform";

import type { ClipListItem, ClippableImage } from "./api-clips";

export const listClips = createServerFn({ method: "GET" }).handler(
  async (): Promise<ClipListItem[]> => {
    const { env } = await getPlatform();
    return listClipRows(env.DB, LOCAL_USER_ID);
  },
);

export const listClipImages = createServerFn({ method: "GET" })
  .validator((characterId: string) => characterId)
  .handler(async ({ data: characterId }): Promise<ClippableImage[]> => {
    const { env } = await getPlatform();
    return listClippableImages(env.DB, characterId);
  });
