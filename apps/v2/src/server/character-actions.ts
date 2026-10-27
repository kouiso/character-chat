import {
  CharacterConflictError,
  characterSheetSchema,
  characterTable,
  getCharacterEditState,
  listCharacterVersions,
  saveCharacter,
} from "@v2/db";
import { asc, eq } from "drizzle-orm";
import { z, ZodError } from "zod";

import type {
  CharacterActionResult,
  CharacterEditorState,
  EditableCharacter,
} from "../lib/character-contract";
import type { V2Db } from "@v2/db";

const actorContextSchema = z.object({
  characterActor: z.object({ userId: z.string().min(1) }),
});
const writeSchema = z
  .object({
    sheet: z.unknown(),
    expectedVersionId: z.number().int().positive().nullable(),
    expectedRevision: z.string(),
  })
  .strict();
const restoreSchema = z
  .object({
    characterId: z.string().min(1),
    versionId: z.number().int().positive(),
    expectedVersionId: z.number().int().positive().nullable(),
    expectedRevision: z.string(),
  })
  .strict();

// handler context は RPC 入力も混ざるため、認証済みの global context だけを使う。
const resolveCharacterActor = (context: unknown): string | null => {
  const actor = actorContextSchema.safeParse(context);
  return actor.success ? actor.data.characterActor.userId : null;
};

export const createCharacterActions = (
  getDb: () => Promise<V2Db>,
  getTrustedContext: () => unknown,
) => {
  const owned = async <T>(
    run: (db: V2Db, userId: string) => Promise<CharacterActionResult<T>>,
  ): Promise<CharacterActionResult<T>> => {
    try {
      const userId = resolveCharacterActor(getTrustedContext());
      if (!userId) return { ok: false, code: "unauthorized", message: "ログインが必要です。" };
      return await run(await getDb(), userId);
    } catch (error) {
      if (error instanceof CharacterConflictError) {
        return {
          ok: false,
          code: "conflict",
          message: "別の画面で変更されました。最新版を読み直してください。",
        };
      }
      if (error instanceof ZodError) {
        return {
          ok: false,
          code: "invalid",
          message: "入力内容を確認してください。年齢は18歳以上の整数が必要です。",
        };
      }
      return {
        ok: false,
        code: "unavailable",
        message: "保存先に接続できません。もう一度お試しください。",
      };
    }
  };

  const state = async (
    db: V2Db,
    userId: string,
    characterId: string,
  ): Promise<CharacterActionResult<CharacterEditorState>> => {
    const current = await getCharacterEditState(db, userId, characterId);
    if (!current)
      return { ok: false, code: "not-found", message: "編集できるキャラクターが見つかりません。" };
    const versions = await listCharacterVersions(db, userId, characterId);
    return { ok: true, data: { ...current, versions } };
  };

  return {
    list: () =>
      owned(
        async (
          db,
          userId,
        ): Promise<
          CharacterActionResult<{
            actorKey: string;
            characters: EditableCharacter[];
          }>
        > => {
          const characters = await db
            .select({ id: characterTable.id, name: characterTable.name })
            .from(characterTable)
            .where(eq(characterTable.userId, userId))
            .orderBy(asc(characterTable.displayOrder), asc(characterTable.createdAt));
          return { ok: true, data: { actorKey: userId, characters } };
        },
      ),
    load: (input: unknown) =>
      owned((db, userId) => state(db, userId, z.string().min(1).parse(input))),
    save: (input: unknown) =>
      owned(async (db, userId) => {
        const { sheet, expectedVersionId, expectedRevision } = writeSchema.parse(input);
        const parsed = characterSheetSchema.strict().parse(sheet);
        const current = await getCharacterEditState(db, userId, parsed.id);
        const safe = {
          ...parsed,
          isOfficial: current?.sheet.isOfficial ?? false,
          displayOrder: current?.sheet.displayOrder ?? 0,
          createdAt: current?.sheet.createdAt ?? Date.now(),
        };
        const saved = await saveCharacter(db, userId, safe, {
          expectedVersionId,
          expectedRevision,
        });
        return state(db, userId, saved.id);
      }),
    restore: (input: unknown) =>
      owned(async (db, userId) => {
        const { characterId, versionId, expectedVersionId, expectedRevision } =
          restoreSchema.parse(input);
        const current = await getCharacterEditState(db, userId, characterId);
        const version = (await listCharacterVersions(db, userId, characterId)).find(
          (candidate) => candidate.id === versionId,
        );
        if (!current || !version) {
          return { ok: false, code: "not-found", message: "戻せる版が見つかりません。" };
        }
        await saveCharacter(
          db,
          userId,
          {
            ...version.sheet,
            isOfficial: current.sheet.isOfficial,
            displayOrder: current.sheet.displayOrder,
            createdAt: current.sheet.createdAt,
          },
          {
            expectedVersionId,
            expectedRevision,
          },
        );
        return state(db, userId, characterId);
      }),
  };
};
