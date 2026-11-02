import { createDb, listCharacterSummaries, listConversations, loadCharacter } from "@v2/db";

import { LOCAL_USER_ID } from "./identity";
import { getPlatform } from "./platform";

import type { CharacterListItem } from "./characters";

export const listCharacterRows = async (): Promise<CharacterListItem[]> => {
  const { env } = await getPlatform();
  return listCharacterSummaries(createDb(env.DB));
};

export const readCharacter = async (id: string): ReturnType<typeof loadCharacter> => {
  const { env } = await getPlatform();
  return loadCharacter(createDb(env.DB), id);
};

export const listSavedConversationRows = async () => {
  const { env } = await getPlatform();
  return listConversations(createDb(env.DB), LOCAL_USER_ID);
};
