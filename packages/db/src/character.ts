// 既存 character テーブルを Drizzle で読み、zod で行ごとに検証する。
// 壊れた行（tags の JSON 不正、greeting 空など）は投げずに failures へ寄せ、他の行は返す。
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { characterTable } from "../../../src/schema/character";

import { characterVersionTable } from "./character-version-schema";

import type { V2Db } from "./client";

// engine の CharacterSheet（id, name, systemPrompt, greeting）を含む、v2 が使う列の集合。
export const characterSheetSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  systemPrompt: z.string().min(1),
  greeting: z.string().min(1),
  introduction: z.string(),
  exampleDialogue: z.string(),
  world: z.string(),
  appearance: z.string(),
  age: z.number().int().min(18),
  adultCategory: z.enum(["general", "adult"]),
  proactiveSettings: z
    .object({
      enabled: z.boolean(),
      intervalMinutes: z.number().int().positive(),
    })
    .strict(),
  tags: z.array(z.string()),
  avatar: z.string().nullable(),
  gender: z.string().nullable(),
  slug: z.string().nullable(),
  isOfficial: z.boolean(),
  displayOrder: z.number().int(),
  createdAt: z.number().int(),
});

export type CharacterSheet = z.infer<typeof characterSheetSchema>;

// tags は DB 上 JSON 文字列。Drizzle の json モードで読むと不正な 1 行で select 全体が
// SyntaxError で落ちるので、生の文字列で受けてここで行ごとに解く。
const jsonValue = z.string().transform((raw, ctx) => {
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    ctx.addIssue({
      code: "custom",
      message: `JSON として読めん: ${error instanceof Error ? error.message : String(error)}`,
    });
    return z.NEVER;
  }
});

const characterRowSchema = characterSheetSchema.extend({
  tags: jsonValue.pipe(characterSheetSchema.shape.tags),
  proactiveSettings: jsonValue.pipe(characterSheetSchema.shape.proactiveSettings),
});

export type CharacterLoadFailure = { id: string; issues: z.core.$ZodIssue[] };

export type CharacterLoadResult = { ok: CharacterSheet[]; failures: CharacterLoadFailure[] };

const selectColumns = {
  id: characterTable.id,
  name: characterTable.name,
  systemPrompt: characterTable.systemPrompt,
  greeting: characterTable.greeting,
  introduction: characterTable.introduction,
  exampleDialogue: characterTable.exampleDialogue,
  world: characterTable.world,
  appearance: characterTable.appearance,
  age: characterTable.age,
  adultCategory: characterTable.adultCategory,
  proactiveSettings: sql<string>`${characterTable.proactiveSettings}`,
  tags: sql<string>`${characterTable.tags}`,
  avatar: characterTable.avatar,
  gender: characterTable.gender,
  slug: characterTable.slug,
  isOfficial: characterTable.isOfficial,
  displayOrder: characterTable.displayOrder,
  createdAt: characterTable.createdAt,
};

const parseRows = (rows: Record<string, unknown>[]): CharacterLoadResult => {
  const result: CharacterLoadResult = { ok: [], failures: [] };
  for (const row of rows) {
    const parsed = characterRowSchema.safeParse(row);
    if (parsed.success) {
      result.ok.push(parsed.data);
    } else {
      result.failures.push({ id: String(row.id), issues: parsed.error.issues });
    }
  }
  return result;
};

export const loadCharacters = async (db: V2Db): Promise<CharacterLoadResult> => {
  const rows = await db
    .select(selectColumns)
    .from(characterTable)
    .orderBy(asc(characterTable.displayOrder), asc(characterTable.createdAt));
  return parseRows(rows);
};

// 見つからん時は ok: null, failures: []。行はあるが検証に落ちた時は ok: null, failures: [その行]。
export const loadCharacter = async (
  db: V2Db,
  id: string,
): Promise<{ ok: CharacterSheet | null; failures: CharacterLoadFailure[] }> => {
  const rows = await db.select(selectColumns).from(characterTable).where(eq(characterTable.id, id));
  const parsed = parseRows(rows);
  return { ok: parsed.ok[0] ?? null, failures: parsed.failures };
};

export class CharacterConflictError extends Error {
  readonly code = "character_conflict";

  constructor() {
    super("別の編集が保存されています。最新の内容を読み直してください。");
    this.name = "CharacterConflictError";
  }
}

export const characterSaveOptionsSchema = z
  .object({
    expectedVersionId: z.number().int().positive().nullable().optional(),
    expectedRevision: z.string().optional(),
  })
  .strict();

export type CharacterSaveOptions = z.infer<typeof characterSaveOptionsSchema>;

type CharacterSaveMetadata = { userId: string; revision: string; versionId: number | null };

const assertCharacterSaveExpected = (
  ownerId: string,
  previous: CharacterSaveMetadata,
  expected: CharacterSaveOptions,
): void => {
  if (previous.userId !== ownerId) throw new Error("character の所有者が一致せん");
  if (expected.expectedVersionId !== undefined && expected.expectedVersionId !== previous.versionId)
    throw new CharacterConflictError();
  if (expected.expectedRevision !== undefined && expected.expectedRevision !== previous.revision)
    throw new CharacterConflictError();
};

export const saveCharacter = async (
  db: V2Db,
  userId: string,
  input: unknown,
  options: CharacterSaveOptions = {},
): Promise<CharacterSheet> => {
  const ownerId = z.string().min(1).parse(userId);
  const sheet = characterSheetSchema.strict().parse(input);
  const expected = characterSaveOptionsSchema.parse(options);
  const [previous] = await db
    .select({
      userId: characterTable.userId,
      revision: characterTable.profileRevision,
      versionId: characterTable.activeVersionId,
    })
    .from(characterTable)
    .where(eq(characterTable.id, sheet.id));
  assertCharacterSaveExpected(
    ownerId,
    previous ?? { userId: ownerId, revision: "", versionId: null },
    expected,
  );

  const oldSheet = previous ? (await loadCharacter(db, sheet.id)).ok : null;
  const revision = previous?.revision ?? crypto.randomUUID();
  const guard = and(
    eq(characterTable.id, sheet.id),
    eq(characterTable.userId, ownerId),
    eq(characterTable.profileRevision, revision),
  );
  const now = Date.now();
  const snapshot = JSON.stringify(sheet);
  const snapshotInsert = (value: string | null) =>
    db
      .insert(characterVersionTable)
      .select(
        db
          .select({
            id: sql<number>`NULL`.as("id"),
            characterId: sql<string>`${sheet.id}`.as("character_id"),
            snapshot: sql<string>`${value ?? "null"}`.as("snapshot"),
            createdAt: sql<number>`${now}`.as("created_at"),
          })
          .from(characterTable)
          .where(and(guard, value === null ? sql`0` : sql`1`)),
      )
      .onConflictDoNothing();
  const activeVersionId = db
    .select({ id: characterVersionTable.id })
    .from(characterVersionTable)
    .where(
      and(
        eq(characterVersionTable.characterId, sheet.id),
        eq(characterVersionTable.snapshot, snapshot),
      ),
    );

  // D1 の batch は全体を原子的に扱う。作成トークンを分けて同一IDの競合も履歴へ混ぜん。
  const result = await db.batch([
    db
      .insert(characterTable)
      .values({ ...sheet, userId: ownerId, profileRevision: revision })
      .onConflictDoNothing(),
    snapshotInsert(oldSheet ? JSON.stringify(oldSheet) : null),
    snapshotInsert(snapshot),
    db
      .update(characterTable)
      .set({
        ...sheet,
        profileRevision: crypto.randomUUID(),
        activeVersionId: sql`(${activeVersionId})`,
      })
      .where(guard)
      .returning({ id: characterTable.id }),
  ]);
  if (result[3].length === 0) throw new CharacterConflictError();
  return sheet;
};
