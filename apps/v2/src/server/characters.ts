import { createServerFn } from "@tanstack/react-start";

export type CharacterListItem = {
  id: string;
  name: string;
  avatar: string | null;
  canEdit: boolean;
};

export const toCharacterDisplay = <Character extends { id: string; name: string }>(
  character: Character | null,
) => (character ? { id: character.id, name: character.name } : null);

export const listCharacters = createServerFn({ method: "GET" }).handler(
  async (): Promise<CharacterListItem[]> => {
    const { listCharacterRows } = await import("./character-data.server");
    return listCharacterRows();
  },
);

export const getCharacter = createServerFn({ method: "GET" })
  .validator((id: string) => id)
  .handler(async ({ data: id }): Promise<{ id: string; name: string } | null> => {
    const { readCharacter } = await import("./character-data.server");
    const { ok } = await readCharacter(id);
    return toCharacterDisplay(ok);
  });

export const listSavedConversations = createServerFn({ method: "GET" }).handler(async () => {
  const { listSavedConversationRows } = await import("./character-data.server");
  return listSavedConversationRows();
});
