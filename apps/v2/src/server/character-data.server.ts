import {
  createDb,
  listCharacterSummaries,
  listConversations,
  listLegacySourceUserIds,
  loadCharacter,
} from "@v2/db";

import { LOCAL_USER_ID } from "./identity";
import { getPlatform } from "./platform";

import type { CharacterListItem } from "./characters";

// local と、移行済み会話が指す旧名義の両方を同一人物として扱う。
const ownerIds = async (db: ReturnType<typeof createDb>) => [
  LOCAL_USER_ID,
  ...(await listLegacySourceUserIds(db)),
];

export const listCharacterRows = async (): Promise<CharacterListItem[]> => {
  const { env } = await getPlatform();
  const db = createDb(env.DB);
  return listCharacterSummaries(db, await ownerIds(db));
};

export const readCharacter = async (id: string): ReturnType<typeof loadCharacter> => {
  const { env } = await getPlatform();
  const db = createDb(env.DB);
  return loadCharacter(db, id, await ownerIds(db));
};

export const listSavedConversationRows = async () => {
  const { env } = await getPlatform();
  return listConversations(createDb(env.DB), LOCAL_USER_ID);
};
