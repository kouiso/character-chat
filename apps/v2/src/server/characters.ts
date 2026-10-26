import { createServerFn } from "@tanstack/react-start";

import type { CharacterSheet } from "@v2/engine";

export type CharacterListItem = { id: string; name: string; avatar: string | null };

export const listCharacters = createServerFn({ method: "GET" }).handler(
  async (): Promise<CharacterListItem[]> => {
    const { listCharacterRows } = await import("./character-data.server");
    return listCharacterRows();
  },
);

export const getCharacter = createServerFn({ method: "GET" })
  .validator((id: string) => id)
  .handler(async ({ data: id }): Promise<CharacterSheet | null> => {
    const { readCharacter } = await import("./character-data.server");
    const { ok } = await readCharacter(id);
    return ok ?? null;
  });
