// サーバ専用モジュール。D1/wrangler 依存は server/ 配下だけに閉じる
// （クライアントバンドルへ wrangler を持ち込まんため、画面ファイルからは直接 import せん）。
import { createServerFn } from "@tanstack/react-start";
import { characterTable, createDb, loadCharacter } from "@v2/db";
import { asc } from "drizzle-orm";

import { getPlatform } from "./platform";

import type { CharacterSheet } from "@v2/engine";

export type CharacterListItem = { id: string; name: string; avatar: string | null };

export const listCharacters = createServerFn({ method: "GET" }).handler(
  async (): Promise<CharacterListItem[]> => {
    const { env } = await getPlatform();
    const db = createDb(env.DB);
    return db
      .select({
        id: characterTable.id,
        name: characterTable.name,
        avatar: characterTable.avatar,
      })
      .from(characterTable)
      .orderBy(asc(characterTable.displayOrder), asc(characterTable.createdAt));
  },
);

// 1 件読みは @v2/db の loadCharacter（Drizzle の行を zod で CharacterSheet に検証）へ委ねる。
// ok が無く failures も空なら行そのものが無い、failures があれば行はあるが設定が不正。
export const readCharacter = async (id: string): ReturnType<typeof loadCharacter> => {
  const { env } = await getPlatform();
  return loadCharacter(createDb(env.DB), id);
};

export const getCharacter = createServerFn({ method: "GET" })
  .validator((id: string) => id)
  .handler(async ({ data: id }): Promise<CharacterSheet | null> => {
    const { ok } = await readCharacter(id);
    return ok ?? null;
  });
