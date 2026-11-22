// /catalog（出会う）ページ用の server fn。API と同じクエリを loader から直接呼ぶ
// （catalog.ts・album.ts と同じ分割）。
import { createServerFn } from "@tanstack/react-start";

import { listMeetCharacters, type MeetCharacter } from "./api-meet";
import { getPlatform } from "./platform";

export const listMeet = createServerFn({ method: "GET" }).handler(
  async (): Promise<MeetCharacter[]> => {
    const { env } = await getPlatform();
    return listMeetCharacters(env.DB);
  },
);
