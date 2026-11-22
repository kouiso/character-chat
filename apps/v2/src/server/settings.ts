// /settings（設定）ページ用の server fn。/api/settings の GET と同じ読みを
// loader から直接呼ぶ（server/meet.ts・server/characters.ts と同じ分割）。
import { createServerFn } from "@tanstack/react-start";

import { LOCAL_USER_ID } from "./identity";
import { getPlatform } from "./platform";
import { readChatMode, readChatStyle, readHandedness, readVoiceAutoplay } from "./user-settings";
import type { UserSettings } from "../component/settings-screen";

export const getUserSettings = createServerFn({ method: "GET" }).handler(
  async (): Promise<UserSettings> => {
    const { env } = await getPlatform();
    return {
      chatMode: await readChatMode(env.DB, LOCAL_USER_ID),
      style: await readChatStyle(env.DB, LOCAL_USER_ID),
      voiceAutoplay: await readVoiceAutoplay(env.DB, LOCAL_USER_ID),
      handedness: await readHandedness(env.DB, LOCAL_USER_ID),
    };
  },
);
