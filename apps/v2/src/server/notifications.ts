// /notifications（通知の設定）ページ用の server fn。/api/settings の読みと
// 「話しかけてくる子」の一覧（話した子 × DO の enabled 印）をまとめて返す。
import { createServerFn } from "@tanstack/react-start";

import { listOwnerIds, LOCAL_USER_ID } from "./identity";
import { getPlatform } from "./platform";
import { readNotificationSettings, type NotificationSettings } from "./user-settings";

import type { NotificationChild } from "../component/notifications-screen";

export const getNotificationSettings = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ settings: NotificationSettings; characters: NotificationChild[] }> => {
    const { env } = await getPlatform();
    const { createDb, listCharacterSummaries, listConversations } = await import("@v2/db");
    const db = createDb(env.DB);
    const settings = await readNotificationSettings(env.DB, LOCAL_USER_ID);
    // 「話しかけてくる子」は板の通り「話した子」。会話の順（新しい方から）を保つ。
    const [conversations, characters] = await Promise.all([
      listConversations(db, LOCAL_USER_ID),
      listCharacterSummaries(db, await listOwnerIds(db)),
    ]);
    const byId = new Map(characters.map((character) => [character.id, character]));
    const talked: string[] = [];
    for (const conversation of conversations) {
      if (byId.has(conversation.characterId) && !talked.includes(conversation.characterId))
        talked.push(conversation.characterId);
    }
    // enabled 印は ProactiveScheduler DO が正本。GET /enabled でまとめて取る。
    const response = await env.PROACTIVE_SCHEDULERS.getByName(LOCAL_USER_ID).fetch(
      "https://proactive.internal/enabled",
    );
    const body = (await response.json().catch(() => ({}))) as {
      enabled?: Record<string, boolean>;
    };
    const enabled = body.enabled ?? {};
    return {
      settings,
      characters: talked.map((id) => {
        const character = byId.get(id)!;
        return {
          id,
          name: character.name,
          avatar: character.avatar,
          enabled: enabled[id] === true,
        };
      }),
    };
  },
);
