import { and, desc, eq } from "drizzle-orm";

import { characterTable } from "../../../src/schema/character";

import { characterSheetSchema, loadCharacter, saveCharacter } from "./character";
import { characterVersionTable } from "./character-version-schema";

import type { CharacterSaveOptions, CharacterSheet } from "./character";
import type { V2Db } from "./client";

export type CharacterVersion = {
  id: number;
  characterId: string;
  createdAt: number;
  sheet: CharacterSheet;
};

const ownerMetadata = async (db: V2Db, userId: string, characterId: string) => {
  const [row] = await db
    .select({
      currentVersionId: characterTable.activeVersionId,
      revision: characterTable.profileRevision,
    })
    .from(characterTable)
    .where(and(eq(characterTable.id, characterId), eq(characterTable.userId, userId)));
  return row;
};

export const getCharacterEditState = async (
  db: V2Db,
  userId: string,
  characterId: string,
): Promise<{ sheet: CharacterSheet; currentVersionId: number | null; revision: string } | null> => {
  const metadata = await ownerMetadata(db, userId, characterId);
  if (!metadata) return null;
  const { ok } = await loadCharacter(db, characterId);
  if (!ok) throw new Error("保存済みのキャラクター設定を読み出せません。");
  return { sheet: ok, ...metadata };
};

const parseVersion = (row: typeof characterVersionTable.$inferSelect): CharacterVersion => {
  const sheet = characterSheetSchema.strict().parse(JSON.parse(row.snapshot) as unknown);
  if (sheet.id !== row.characterId) throw new Error("キャラクターの履歴が一致しません。");
  return { id: row.id, characterId: row.characterId, createdAt: row.createdAt, sheet };
};

export const listCharacterVersions = async (
  db: V2Db,
  userId: string,
  characterId: string,
): Promise<CharacterVersion[]> => {
  if (!(await ownerMetadata(db, userId, characterId))) return [];
  const rows = await db
    .select()
    .from(characterVersionTable)
    .where(eq(characterVersionTable.characterId, characterId))
    .orderBy(desc(characterVersionTable.id));
  return rows.map(parseVersion);
};

export const restoreCharacterVersion = async (
  db: V2Db,
  userId: string,
  characterId: string,
  versionId: number,
  options: CharacterSaveOptions = {},
): Promise<CharacterSheet> => {
  if (!(await ownerMetadata(db, userId, characterId)))
    throw new Error("キャラクターが見つかりません。");
  const [row] = await db
    .select()
    .from(characterVersionTable)
    .where(
      and(
        eq(characterVersionTable.id, versionId),
        eq(characterVersionTable.characterId, characterId),
      ),
    );
  if (!row) throw new Error("キャラクターの履歴が見つかりません。");
  return saveCharacter(db, userId, parseVersion(row).sheet, options);
};
