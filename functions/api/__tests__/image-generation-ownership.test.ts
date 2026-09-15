import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";

import { validateImageGenerationOwnership } from "../[[route]]";

type Fixture = {
  characters: Array<{ id: string; userId: string }>;
  conversations: Array<{ id: string; userId: string }>;
};

const makeDatabase = (fixture: Fixture): ReturnType<typeof drizzle> =>
  drizzle({
    prepare: (sql: string) => ({
      bind: (...binds: unknown[]) => ({
        raw: <T = unknown[]>() => {
          const [id, userId] = binds;
          const rows = sql.includes('from "character"')
            ? fixture.characters.filter((row) => row.id === id && row.userId === userId)
            : fixture.conversations.filter((row) => row.id === id && row.userId === userId);
          return Promise.resolve(rows.map((row) => [row.id]) as T[]);
        },
      }),
    }),
  } as D1Database);

describe("画像生成コンテキストのアカウント分離", () => {
  const database = makeDatabase({
    characters: [
      { id: "character-a", userId: "user-a" },
      { id: "character-b", userId: "user-b" },
    ],
    conversations: [
      { id: "conversation-a", userId: "user-a" },
      { id: "conversation-b", userId: "user-b" },
    ],
  });

  it("ユーザーA自身のキャラクターと会話だけを許可する", async () => {
    await expect(
      validateImageGenerationOwnership(database, "user-a", {
        characterId: "character-a",
        conversationId: "conversation-a",
      }),
    ).resolves.toBe(true);
  });

  it("ユーザーAがユーザーBのキャラクターデータを画像生成に使うことを拒否する", async () => {
    await expect(
      validateImageGenerationOwnership(database, "user-a", {
        characterId: "character-b",
        conversationId: "conversation-a",
      }),
    ).resolves.toBe(false);
  });

  it("ユーザーAがユーザーBの会話データを画像生成に使うことを拒否する", async () => {
    await expect(
      validateImageGenerationOwnership(database, "user-a", {
        characterId: "character-a",
        conversationId: "conversation-b",
      }),
    ).resolves.toBe(false);
  });
});
