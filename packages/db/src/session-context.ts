import { and, eq, or, sql } from "drizzle-orm";

import { characterTable } from "../../../src/schema/character";

import { characterSheetSchema, loadCharacter, type CharacterSheet } from "./character";
import { v2SessionContextTable } from "./session-context-schema";
import { ConversationAccessError } from "./turn-store";
import { v2ConversationTable } from "./v2-schema";

import type { V2Db } from "./client";

export type SessionContext = {
  conversationId: string;
  ownerUserId: string;
  characterId: string;
  worldlineId: string;
  characterVersionId: string;
  sourceStartTurn: number;
  character: CharacterSheet;
};

type Scope = { ownerUserId: string; characterId: string; conversationId: string };
const accessibleCharacter = (ownerUserId: string) =>
  or(eq(characterTable.userId, ownerUserId), eq(characterTable.isOfficial, true));
const conversationOwner = (scope: Scope) =>
  and(
    eq(v2ConversationTable.id, scope.conversationId),
    eq(v2ConversationTable.userId, scope.ownerUserId),
    eq(v2ConversationTable.characterId, scope.characterId),
  );

export const readSessionContext = async (
  db: V2Db,
  scope: Scope,
): Promise<SessionContext | null> => {
  const [row] = await db
    .select({ session: v2SessionContextTable })
    .from(v2SessionContextTable)
    .innerJoin(
      v2ConversationTable,
      eq(v2ConversationTable.id, v2SessionContextTable.conversationId),
    )
    .where(
      and(
        conversationOwner(scope),
        eq(v2SessionContextTable.ownerUserId, scope.ownerUserId),
        eq(v2SessionContextTable.characterId, scope.characterId),
      ),
    );
  if (!row) return null;
  const character = characterSheetSchema.strict().parse(JSON.parse(row.session.characterSnapshot));
  if (character.id !== scope.characterId) throw new ConversationAccessError();
  return {
    ...scope,
    worldlineId: row.session.worldlineId,
    characterVersionId: row.session.characterVersionId,
    sourceStartTurn: row.session.sourceStartTurn,
    character,
  };
};

// 再開時の人格と記憶境界を、現在の公開キャラ版へ暗黙に付け替えない。
export const ensureSessionContext = async (
  db: V2Db,
  scope: Scope,
  promptVersion: string,
): Promise<SessionContext> => {
  const [metadata] = await db
    .select({ revision: characterTable.profileRevision, versionId: characterTable.activeVersionId })
    .from(characterTable)
    .where(and(eq(characterTable.id, scope.characterId), accessibleCharacter(scope.ownerUserId)));
  if (!metadata) throw new ConversationAccessError();
  const existing = await readSessionContext(db, scope);
  if (existing) return existing;
  const { ok: character } = await loadCharacter(db, scope.characterId);
  if (!character) throw new ConversationAccessError();
  const now = Date.now();
  // キャラ編集がsnapshot読取と競合したらinsertを成立させず、混合版を固定しない。
  const versionCondition =
    metadata.versionId === null
      ? sql`${characterTable.activeVersionId} is null`
      : eq(characterTable.activeVersionId, metadata.versionId);
  const characterVersionId = `${scope.characterId}:${metadata.versionId ?? `revision-${metadata.revision || "legacy"}`}`;
  await db.batch([
    db
      .insert(v2ConversationTable)
      .values({
        id: scope.conversationId,
        userId: scope.ownerUserId,
        characterId: scope.characterId,
        threadId: scope.conversationId,
        promptVersion,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing(),
    db
      .insert(v2SessionContextTable)
      .select(
        db
          .select({
            conversationId: sql<string>`${scope.conversationId}`.as("conversation_id"),
            ownerUserId: sql<string>`${scope.ownerUserId}`.as("owner_user_id"),
            characterId: sql<string>`${scope.characterId}`.as("character_id"),
            worldlineId: sql<string>`${crypto.randomUUID()}`.as("worldline_id"),
            characterVersionId: sql<string>`${characterVersionId}`.as("character_version_id"),
            characterSnapshot: sql<string>`${JSON.stringify(character)}`.as("character_snapshot"),
            sourceStartTurn:
              sql<number>`coalesce((select max(turn) from v2_message where conversation_id = ${scope.conversationId}), 0) + 1`.as(
                "source_start_turn",
              ),
            createdAt: sql<number>`${now}`.as("created_at"),
          })
          .from(v2ConversationTable)
          .innerJoin(characterTable, eq(characterTable.id, v2ConversationTable.characterId))
          .where(
            and(
              conversationOwner(scope),
              accessibleCharacter(scope.ownerUserId),
              eq(characterTable.profileRevision, metadata.revision),
              versionCondition,
            ),
          ),
      )
      .onConflictDoNothing(),
  ]);
  const context = await readSessionContext(db, scope);
  if (!context) throw new ConversationAccessError();
  return context;
};
