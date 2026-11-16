import { createDb, listCharacterSummaries, listConversations, loadCharacter } from "@v2/db";

import { listOwnerIds, LOCAL_USER_ID } from "./identity";
import { getPlatform } from "./platform";

import type { CharacterListItem } from "./characters";

export const listCharacterRows = async (): Promise<CharacterListItem[]> => {
  const { env } = await getPlatform();
  const db = createDb(env.DB);
  return listCharacterSummaries(db, await listOwnerIds(db));
};

export const readCharacter = async (id: string): ReturnType<typeof loadCharacter> => {
  const { env } = await getPlatform();
  const db = createDb(env.DB);
  return loadCharacter(db, id, await listOwnerIds(db));
};

export const listSavedConversationRows = async () => {
  const { env } = await getPlatform();
  return listConversations(createDb(env.DB), LOCAL_USER_ID);
};
