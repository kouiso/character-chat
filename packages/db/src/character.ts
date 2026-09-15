// 既存 character テーブルを Drizzle で読み、zod で行ごとに検証する。
// 壊れた行（tags の JSON 不正、greeting 空など）は投げずに failures へ寄せ、他の行は返す。
import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { characterTable } from "../../../src/schema/character";

import type { V2Db } from "./client";

// engine の CharacterSheet（id, name, systemPrompt, greeting）を含む、v2 が使う列の集合。
export const characterSheetSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  systemPrompt: z.string().min(1),
  greeting: z.string().min(1),
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
const jsonStringArray = z.string().transform((raw, ctx) => {
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    ctx.addIssue({
      code: "custom",
      message: `tags が JSON として読めん: ${error instanceof Error ? error.message : String(error)}`,
    });
    return z.NEVER;
  }
});

const characterRowSchema = characterSheetSchema.extend({
  tags: jsonStringArray.pipe(z.array(z.string())),
});

export type CharacterLoadFailure = { id: string; issues: z.core.$ZodIssue[] };

export type CharacterLoadResult = { ok: CharacterSheet[]; failures: CharacterLoadFailure[] };

const selectColumns = {
  id: characterTable.id,
  name: characterTable.name,
  systemPrompt: characterTable.systemPrompt,
  greeting: characterTable.greeting,
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
