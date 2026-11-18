// /album ページ用の server fn（clips.ts と同じ分割: loader から直接呼ぶ）。
import { createServerFn } from "@tanstack/react-start";

import { listAlbumItems } from "./api-album";
import { LOCAL_USER_ID } from "./identity";
import { getPlatform } from "./platform";

import type { AlbumItem } from "./api-album";

export const listAlbum = createServerFn({ method: "GET" }).handler(
  async (): Promise<AlbumItem[]> => {
    const { env } = await getPlatform();
    return listAlbumItems(env.DB, LOCAL_USER_ID);
  },
);
