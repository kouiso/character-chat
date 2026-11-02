// character_version は不変の本文を持ち、character は互換ミラーと現在版ポインターだけを持つ。
import { and, desc, eq, or, sql } from "drizzle-orm";

import { characterTable } from "../../../src/schema/character";

import {
  canonicalContentJson,
  characterContentHash,
  composeSystemPrompt,
  legacyCharacterContent,
  storedCharacterContentSchema,
  CHARACTER_CONTENT_SCHEMA_VERSION,
  type CharacterContent,
} from "./character-version";
import { characterRevisionTable, characterVersionTable, v2ConversationTable } from "./v2-schema";

import type { V2Db } from "./client";

export class CharacterConflictError extends Error {
  constructor() {
    super("別の画面で変更されています。最新の内容を読み直してください。");
    this.name = "CharacterConflictError";
  }
}

export class CharacterVersionNotFoundError extends Error {
  constructor() {
    super("指定された版が見つかりません。");
    this.name = "CharacterVersionNotFoundError";
  }
}

export type CharacterVersionRow = {
  id: string;
  version: number;
  createdAt: number;
};

export type CharacterHistoryRow = {
  revision: number;
  versionId: string;
  action: "create" | "update" | "restore" | "legacy";
  createdAt: number;
};

type CharacterUpdateInput = {
  id: string;
  userId: string;
  expectedRevision: number;
  content: CharacterContent;
};

type OwnedCharacter = {
  id: string;
  userId: string;
  name: string;
  systemPrompt: string;
  greeting: string;
  tags: string;
  avatar: string | null;
  revision: number;
  currentVersionId: string | null;
};

const ownedCharacter = async (db: V2Db, id: string, userId: string) => {
  const [row] = await db
    .select({
      id: characterTable.id,
      userId: characterTable.userId,
      name: characterTable.name,
      systemPrompt: characterTable.systemPrompt,
      greeting: characterTable.greeting,
      tags: sql<string>`${characterTable.tags}`,
      avatar: characterTable.avatar,
      revision: characterTable.revision,
      currentVersionId: characterTable.currentVersionId,
    })
    .from(characterTable)
    .where(and(eq(characterTable.id, id), eq(characterTable.userId, userId)));
  return row ?? null;
};

const accessibleCharacter = async (db: V2Db, id: string, userId: string) => {
  const [row] = await db
    .select({
      id: characterTable.id,
      userId: characterTable.userId,
      name: characterTable.name,
      systemPrompt: characterTable.systemPrompt,
      greeting: characterTable.greeting,
      tags: sql<string>`${characterTable.tags}`,
      avatar: characterTable.avatar,
      revision: characterTable.revision,
      currentVersionId: characterTable.currentVersionId,
      isOfficial: characterTable.isOfficial,
    })
    .from(characterTable)
    .where(
      and(
        eq(characterTable.id, id),
        or(eq(characterTable.userId, userId), eq(characterTable.isOfficial, true)),
      ),
    );
  return row ?? null;
};

const parseTags = (raw: string): string[] => {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    return [];
  }
};

const mirrorColumns = (content: CharacterContent) => ({
  name: content.name,
  greeting: content.greeting,
  systemPrompt: composeSystemPrompt(content),
  tags: content.tags,
  avatar: content.avatarRef,
});

const hasReturnedRow = (value: unknown): value is readonly unknown[] =>
  Array.isArray(value) && value.length > 0;

const returnedCharacterPointer = (
  value: unknown,
): { revision: number; versionId: string } | null => {
  if (!hasReturnedRow(value)) return null;
  const [row] = value;
  if (typeof row !== "object" || row === null) return null;
  const revision = Reflect.get(row, "revision");
  const versionId = Reflect.get(row, "currentVersionId");
  return typeof revision === "number" && typeof versionId === "string"
    ? { revision, versionId }
    : null;
};

const legacyContent = (row: OwnedCharacter): CharacterContent =>
  legacyCharacterContent({
    name: row.name,
    systemPrompt: row.systemPrompt,
    greeting: row.greeting,
    tags: parseTags(row.tags),
    avatar: row.avatar,
  });

const bindUnpinnedConversations = (db: V2Db, characterId: string) =>
  db
    .update(v2ConversationTable)
    .set({
      characterVersionId: sql`(
        select current_version_id from character
        where id = ${characterId}
      )`,
    })
    .where(
      and(
        eq(v2ConversationTable.characterId, characterId),
        sql`${v2ConversationTable.characterVersionId} is null`,
        sql`exists (
          select 1 from character
          where id = ${characterId} and current_version_id is not null
        )`,
      ),
    );

const historyFor = async (db: V2Db, characterId: string): Promise<CharacterHistoryRow[]> =>
  db
    .select({
      revision: characterRevisionTable.revision,
      versionId: characterRevisionTable.versionId,
      action: characterRevisionTable.action,
      createdAt: characterRevisionTable.createdAt,
    })
    .from(characterRevisionTable)
    .where(eq(characterRevisionTable.characterId, characterId))
    .orderBy(desc(characterRevisionTable.revision));

const updateHistoryInsert = (
  db: V2Db,
  input: {
    id: string;
    userId: string;
    expectedRevision: number;
    action: "update" | "restore";
    now: number;
  },
) =>
  db
    .insert(characterRevisionTable)
    .select(
      db
        .select({
          characterId: characterTable.id,
          revision: characterTable.revision,
          versionId: characterTable.currentVersionId,
          action: sql<"update" | "restore">`${input.action}`.as("action"),
          createdAt: sql<number>`${input.now}`.as("createdAt"),
        })
        .from(characterTable)
        .where(
          and(
            eq(characterTable.id, input.id),
            eq(characterTable.userId, input.userId),
            eq(characterTable.revision, input.expectedRevision + 1),
            sql`${characterTable.currentVersionId} is not null`,
            sql`changes() = 1`,
            sql`not exists (
              select 1 from character_revision
              where character_id = ${input.id}
                and revision = ${input.expectedRevision + 1}
            )`,
          ),
        ),
    )
    .onConflictDoNothing();

export const ensureCurrentVersion = async (
  db: V2Db,
  characterId: string,
  userId: string,
): Promise<{ versionId: string; revision: number } | null> => {
  const row = await accessibleCharacter(db, characterId, userId);
  if (!row) return null;
  if (!row.currentVersionId) {
    const content = legacyContent(row);
    const versionId = crypto.randomUUID();
    const hash = await characterContentHash(content);
    const now = Date.now();
    await db.batch([
      db
        .insert(characterVersionTable)
        .select(
          db
            .select({
              id: sql<string>`${versionId}`.as("id"),
              characterId: characterTable.id,
              ownerUserId: characterTable.userId,
              version: sql<number>`(
                select coalesce(max(version), 0) + 1
                from character_version where character_id = ${characterId}
              )`.as("version"),
              schemaVersion: sql<number>`${CHARACTER_CONTENT_SCHEMA_VERSION}`.as("schemaVersion"),
              contentJson: sql<string>`${canonicalContentJson(content)}`.as("contentJson"),
              contentHash: sql<string>`${hash}`.as("contentHash"),
              createdAt: sql<number>`${now}`.as("createdAt"),
            })
            .from(characterTable)
            .where(
              and(
                eq(characterTable.id, characterId),
                or(eq(characterTable.userId, userId), eq(characterTable.isOfficial, true)),
                eq(characterTable.revision, row.revision),
                sql`${characterTable.currentVersionId} is null`,
              ),
            ),
        )
        .onConflictDoNothing({
          target: [characterVersionTable.characterId, characterVersionTable.contentHash],
        }),
      db
        .update(characterTable)
        .set({
          currentVersionId: sql`coalesce(
            current_version_id,
            (select id from character_version
             where character_id = ${characterId} and content_hash = ${hash})
          )`,
        })
        .where(
          and(
            eq(characterTable.id, characterId),
            or(eq(characterTable.userId, userId), eq(characterTable.isOfficial, true)),
            eq(characterTable.revision, row.revision),
            sql`${characterTable.currentVersionId} is null`,
          ),
        ),
      db
        .insert(characterRevisionTable)
        .select(
          db
            .select({
              characterId: characterTable.id,
              revision: characterTable.revision,
              versionId: characterTable.currentVersionId,
              action: sql<"legacy">`'legacy'`.as("action"),
              createdAt: sql<number>`${now}`.as("createdAt"),
            })
            .from(characterTable)
            .where(
              and(
                eq(characterTable.id, characterId),
                eq(characterTable.userId, row.userId),
                eq(characterTable.revision, row.revision),
                sql`${characterTable.currentVersionId} = (
                  select id from character_version
                  where character_id = ${characterId} and content_hash = ${hash}
                )`,
              ),
            ),
        )
        .onConflictDoNothing(),
      bindUnpinnedConversations(db, characterId),
    ]);
  } else {
    await db.batch([bindUnpinnedConversations(db, characterId)]);
  }
  const current = await accessibleCharacter(db, characterId, userId);
  return current?.currentVersionId
    ? { versionId: current.currentVersionId, revision: current.revision }
    : null;
};

export const createCharacterWithVersion = async (
  db: V2Db,
  userId: string,
  content: CharacterContent,
): Promise<{ id: string; versionId: string; revision: number }> => {
  const id = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  const now = Date.now();
  const hash = await characterContentHash(content);
  await db.batch([
    db.insert(characterTable).values({
      id,
      userId,
      isOfficial: false,
      displayOrder: 0,
      ...mirrorColumns(content),
      createdAt: now,
      revision: 1,
      currentVersionId: null,
    }),
    db.insert(characterVersionTable).values({
      id: versionId,
      characterId: id,
      ownerUserId: userId,
      version: sql<number>`(
        select coalesce(max(version), 0) + 1
        from character_version where character_id = ${id}
      )`,
      schemaVersion: CHARACTER_CONTENT_SCHEMA_VERSION,
      contentJson: canonicalContentJson(content),
      contentHash: hash,
      createdAt: now,
    }),
    db.update(characterTable).set({ currentVersionId: versionId }).where(eq(characterTable.id, id)),
    db.insert(characterRevisionTable).values({
      characterId: id,
      revision: 1,
      versionId,
      action: "create",
      createdAt: now,
    }),
  ]);
  return { id, versionId, revision: 1 };
};

export type CharacterDeleteResult = "deleted" | "in-use" | "not-found";

const deletableCharacter = (id: string, userId: string) => sql`
  exists (
    select 1 from character
    where id = ${id} and user_id = ${userId}
      and not exists (select 1 from conversation where character_id = ${id})
      and not exists (select 1 from v2_conversation where character_id = ${id})
  )
`;

export const deleteCharacterWithVersions = async (
  db: V2Db,
  input: { id: string; userId: string },
): Promise<CharacterDeleteResult> => {
  const canDelete = deletableCharacter(input.id, input.userId);
  const result = await db.batch([
    db
      .delete(characterRevisionTable)
      .where(and(eq(characterRevisionTable.characterId, input.id), canDelete)),
    db
      .delete(characterVersionTable)
      .where(and(eq(characterVersionTable.characterId, input.id), canDelete)),
    db
      .delete(characterTable)
      .where(
        and(
          eq(characterTable.id, input.id),
          eq(characterTable.userId, input.userId),
          sql`not exists (select 1 from conversation where character_id = ${input.id})`,
          sql`not exists (select 1 from v2_conversation where character_id = ${input.id})`,
        ),
      )
      .returning({ id: characterTable.id }),
  ]);
  if (hasReturnedRow(result[2])) return "deleted";

  const [owned] = await db
    .select({ id: characterTable.id })
    .from(characterTable)
    .where(and(eq(characterTable.id, input.id), eq(characterTable.userId, input.userId)));
  return owned ? "in-use" : "not-found";
};

const matchingCurrentVersion = async (
  db: V2Db,
  input: CharacterUpdateInput,
  hash: string,
): Promise<{ revision: number; versionId: string } | null> => {
  const [current] = await db
    .select({
      revision: characterTable.revision,
      currentVersionId: characterTable.currentVersionId,
    })
    .from(characterTable)
    .innerJoin(
      characterVersionTable,
      and(
        eq(characterVersionTable.id, characterTable.currentVersionId),
        eq(characterVersionTable.characterId, characterTable.id),
        eq(characterVersionTable.ownerUserId, input.userId),
        eq(characterVersionTable.contentHash, hash),
      ),
    )
    .where(
      and(
        eq(characterTable.id, input.id),
        eq(characterTable.userId, input.userId),
        eq(characterTable.revision, input.expectedRevision),
      ),
    );
  return current?.currentVersionId
    ? { revision: current.revision, versionId: current.currentVersionId }
    : null;
};

const findCharacterVersionId = async (
  db: V2Db,
  characterId: string,
  hash: string,
): Promise<string | null> => {
  const [existing] = await db
    .select({ id: characterVersionTable.id })
    .from(characterVersionTable)
    .where(
      and(
        eq(characterVersionTable.characterId, characterId),
        eq(characterVersionTable.contentHash, hash),
      ),
    );
  return existing?.id ?? null;
};

const insertCharacterVersion = (
  db: V2Db,
  input: CharacterUpdateInput,
  versionId: string,
  hash: string,
  now: number,
) =>
  db
    .insert(characterVersionTable)
    .select(
      db
        .select({
          id: sql<string>`${versionId}`.as("id"),
          characterId: characterTable.id,
          ownerUserId: characterTable.userId,
          version: sql<number>`(
            select coalesce(max(version), 0) + 1
            from character_version where character_id = ${input.id}
          )`.as("version"),
          schemaVersion: sql<number>`${CHARACTER_CONTENT_SCHEMA_VERSION}`.as("schemaVersion"),
          contentJson: sql<string>`${canonicalContentJson(input.content)}`.as("contentJson"),
          contentHash: sql<string>`${hash}`.as("contentHash"),
          createdAt: sql<number>`${now}`.as("createdAt"),
        })
        .from(characterTable)
        .where(
          and(
            eq(characterTable.id, input.id),
            eq(characterTable.userId, input.userId),
            eq(characterTable.revision, input.expectedRevision),
          ),
        ),
    )
    .onConflictDoNothing({
      target: [characterVersionTable.characterId, characterVersionTable.contentHash],
    });

const commitCharacterUpdate = async (
  db: V2Db,
  input: CharacterUpdateInput,
  versionId: string,
  hash: string,
  existingVersionId: string | null,
  now: number,
): Promise<{ revision: number; versionId: string } | null> => {
  const insert = existingVersionId ? null : insertCharacterVersion(db, input, versionId, hash, now);
  const update = db
    .update(characterTable)
    .set({
      ...mirrorColumns(input.content),
      revision: sql`${characterTable.revision} + 1`,
      currentVersionId: sql`(
        select id from character_version
        where character_id = ${input.id} and content_hash = ${hash}
        limit 1
      )`,
    })
    .where(
      and(
        eq(characterTable.id, input.id),
        eq(characterTable.userId, input.userId),
        eq(characterTable.revision, input.expectedRevision),
      ),
    )
    .returning({
      revision: characterTable.revision,
      currentVersionId: characterTable.currentVersionId,
    });
  const result = insert
    ? await db.batch([insert, update, updateHistoryInsert(db, { ...input, action: "update", now })])
    : await db.batch([update, updateHistoryInsert(db, { ...input, action: "update", now })]);
  return returnedCharacterPointer(result[insert ? 1 : 0]);
};

export const updateCharacterWithVersion = async (
  db: V2Db,
  input: CharacterUpdateInput,
): Promise<{ revision: number; versionId: string; changed: boolean } | null> => {
  if (!(await ownedCharacter(db, input.id, input.userId))) return null;
  if (!(await ensureCurrentVersion(db, input.id, input.userId))) return null;
  const row = await ownedCharacter(db, input.id, input.userId);
  if (!row) return null;
  if (row.revision !== input.expectedRevision) throw new CharacterConflictError();
  const hash = await characterContentHash(input.content);
  const unchanged = await matchingCurrentVersion(db, input, hash);
  if (unchanged) {
    return { ...unchanged, changed: false };
  }
  const existingVersionId = await findCharacterVersionId(db, input.id, hash);
  const versionId = existingVersionId ?? crypto.randomUUID();
  const updated = await commitCharacterUpdate(
    db,
    input,
    versionId,
    hash,
    existingVersionId,
    Date.now(),
  );
  if (!updated) throw new CharacterConflictError();
  return { ...updated, changed: true };
};

export const restoreCharacterVersion = async (
  db: V2Db,
  input: { id: string; userId: string; versionId: string; expectedRevision: number },
): Promise<{ revision: number; versionId: string }> => {
  if (!(await ownedCharacter(db, input.id, input.userId))) {
    throw new CharacterVersionNotFoundError();
  }
  if (!(await ensureCurrentVersion(db, input.id, input.userId))) {
    throw new CharacterVersionNotFoundError();
  }
  const [current] = await db
    .select({
      revision: characterTable.revision,
      currentVersionId: characterTable.currentVersionId,
      contentJson: characterVersionTable.contentJson,
    })
    .from(characterTable)
    .innerJoin(
      characterVersionTable,
      and(
        eq(characterVersionTable.id, input.versionId),
        eq(characterVersionTable.characterId, characterTable.id),
        eq(characterVersionTable.ownerUserId, input.userId),
      ),
    )
    .where(and(eq(characterTable.id, input.id), eq(characterTable.userId, input.userId)));
  if (!current) throw new CharacterVersionNotFoundError();
  if (current.revision !== input.expectedRevision) throw new CharacterConflictError();
  if (current.currentVersionId === input.versionId) {
    return { revision: current.revision, versionId: input.versionId };
  }
  const content = storedCharacterContentSchema.parse(JSON.parse(current.contentJson));
  const now = Date.now();
  const update = db
    .update(characterTable)
    .set({
      ...mirrorColumns(content),
      revision: sql`${characterTable.revision} + 1`,
      currentVersionId: input.versionId,
    })
    .where(
      and(
        eq(characterTable.id, input.id),
        eq(characterTable.userId, input.userId),
        eq(characterTable.revision, input.expectedRevision),
      ),
    )
    .returning({
      revision: characterTable.revision,
      currentVersionId: characterTable.currentVersionId,
    });
  const result = await db.batch([
    update,
    updateHistoryInsert(db, { ...input, action: "restore", now }),
  ]);
  const updated = returnedCharacterPointer(result[0]);
  if (!updated) throw new CharacterConflictError();
  return updated;
};

export const listCharacterVersions = async (
  db: V2Db,
  id: string,
  userId: string,
): Promise<{
  currentVersionId: string | null;
  versions: CharacterVersionRow[];
  history: CharacterHistoryRow[];
} | null> => {
  if (!(await ownedCharacter(db, id, userId))) return null;
  const ensured = await ensureCurrentVersion(db, id, userId);
  if (!ensured) return null;
  const versions = await db
    .select({
      id: characterVersionTable.id,
      version: characterVersionTable.version,
      createdAt: characterVersionTable.createdAt,
    })
    .from(characterVersionTable)
    .where(eq(characterVersionTable.characterId, id))
    .orderBy(desc(characterVersionTable.version));
  return { currentVersionId: ensured.versionId, versions, history: await historyFor(db, id) };
};

export type CharacterDetail = {
  id: string;
  revision: number;
  currentVersionId: string | null;
  ownerUserId: string;
  content: CharacterContent;
};

export const readCharacterDetail = async (
  db: V2Db,
  id: string,
  userId: string,
): Promise<CharacterDetail | null> => {
  if (!(await ownedCharacter(db, id, userId))) return null;
  const ensured = await ensureCurrentVersion(db, id, userId);
  if (!ensured) return null;
  const [row] = await db
    .select({
      id: characterTable.id,
      revision: characterTable.revision,
      currentVersionId: characterTable.currentVersionId,
      ownerUserId: characterTable.userId,
      contentJson: characterVersionTable.contentJson,
    })
    .from(characterTable)
    .innerJoin(
      characterVersionTable,
      and(
        eq(characterVersionTable.id, characterTable.currentVersionId),
        eq(characterVersionTable.characterId, characterTable.id),
        eq(characterVersionTable.ownerUserId, userId),
      ),
    )
    .where(and(eq(characterTable.id, id), eq(characterTable.userId, userId)));
  if (!row?.currentVersionId) throw new CharacterVersionNotFoundError();
  return {
    id: row.id,
    revision: row.revision,
    currentVersionId: row.currentVersionId,
    ownerUserId: row.ownerUserId,
    content: storedCharacterContentSchema.parse(JSON.parse(row.contentJson)),
  };
};

export const readCharacterVersion = async (
  db: V2Db,
  input: { characterId: string; versionId: string; userId: string },
): Promise<{
  id: string;
  version: number;
  content: CharacterContent;
  createdAt: number;
} | null> => {
  const [row] = await db
    .select({
      id: characterVersionTable.id,
      version: characterVersionTable.version,
      contentJson: characterVersionTable.contentJson,
      createdAt: characterVersionTable.createdAt,
    })
    .from(characterVersionTable)
    .innerJoin(characterTable, eq(characterVersionTable.characterId, characterTable.id))
    .where(
      and(
        eq(characterVersionTable.id, input.versionId),
        eq(characterVersionTable.characterId, input.characterId),
        eq(characterVersionTable.ownerUserId, input.userId),
        eq(characterVersionTable.ownerUserId, characterTable.userId),
        eq(characterTable.userId, input.userId),
      ),
    );
  if (!row) return null;
  return {
    id: row.id,
    version: row.version,
    content: storedCharacterContentSchema.parse(JSON.parse(row.contentJson)),
    createdAt: row.createdAt,
  };
};

export const loadVersionedCharacter = async (
  db: V2Db,
  input: { versionId: string; characterId: string; userId: string },
): Promise<{ characterId: string; content: CharacterContent } | null> => {
  const [row] = await db
    .select({
      characterId: characterVersionTable.characterId,
      contentJson: characterVersionTable.contentJson,
    })
    .from(characterVersionTable)
    .innerJoin(characterTable, eq(characterVersionTable.characterId, characterTable.id))
    .where(
      and(
        eq(characterVersionTable.id, input.versionId),
        eq(characterVersionTable.characterId, input.characterId),
        eq(characterVersionTable.ownerUserId, characterTable.userId),
        or(eq(characterTable.userId, input.userId), eq(characterTable.isOfficial, true)),
      ),
    );
  if (!row) return null;
  return {
    characterId: row.characterId,
    content: storedCharacterContentSchema.parse(JSON.parse(row.contentJson)),
  };
};
