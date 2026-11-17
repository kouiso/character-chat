import { createServerFn } from "@tanstack/react-start";

export type CharacterListItem = {
  id: string;
  name: string;
  avatar: string | null;
  // マイ画面の副行に出す。先頭の札だけ使う
  tags: string[];
  canEdit: boolean;
  playCount: number;
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
  .handler(
    async ({
      data: id,
    }): Promise<{
      id: string;
      name: string;
      avatar: string | null;
      greeting: string;
      tags: string[];
    } | null> => {
      const { readCharacter } = await import("./character-data.server");
      const { ok } = await readCharacter(id);
      // チャット画面のバブル横アイコンに avatar、会話冒頭の「初回のひとこと」に greeting、
      // プロフィールの札行に tags を使う。
      return ok
        ? { id: ok.id, name: ok.name, avatar: ok.avatar, greeting: ok.greeting, tags: ok.tags }
        : null;
    },
  );

export const listSavedConversations = createServerFn({ method: "GET" }).handler(async () => {
  const { listSavedConversationRows } = await import("./character-data.server");
  return listSavedConversationRows();
});
