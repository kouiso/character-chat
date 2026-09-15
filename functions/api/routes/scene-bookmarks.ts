import { zValidator } from "@hono/zod-validator";
import { and, desc, eq, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";

import { conversationTable, messageTable, sceneBookmarkTable } from "../../../src/schema";
import {
  compositeCursorFilter,
  decodeCompositeCursor,
  encodeCompositeCursor,
  ensureUser,
  escapeSqlLikePattern,
  getUserEmail,
  idSchema,
  sceneBookmarkCreateSchema,
  sceneBookmarkListSchema,
  sceneBookmarkUpdateSchema,
  validateCharacterOwnership,
  type Bindings,
} from "../lib/route-context";

export const sceneBookmarkRoutes = new Hono<{ Bindings: Bindings }>()
  .get("/", zValidator("query", sceneBookmarkListSchema), async (c) => {
    const userEmail = await getUserEmail(c);
    if (!userEmail) return c.json({ error: "unauthorized" }, 401);

    const { characterId, q, limit, cursor } = c.req.valid("query");
    const parsedCursor = cursor ? decodeCompositeCursor(cursor) : null;
    if (cursor && !parsedCursor) {
      return c.json({ error: "invalid cursor" }, 400);
    }

    const database = drizzle(c.env.DB);
    const userId = await ensureUser(database, userEmail);
    const normalizedQuery = q?.toLowerCase();
    const likePattern = normalizedQuery ? `%${escapeSqlLikePattern(normalizedQuery)}%` : undefined;
    const searchClause = likePattern
      ? or(
          sql`lower(${sceneBookmarkTable.title}) LIKE ${likePattern} ESCAPE '\\'`,
          sql`lower(${sceneBookmarkTable.snippet}) LIKE ${likePattern} ESCAPE '\\'`,
        )
      : undefined;

    const rows = await database
      .select({
        id: sceneBookmarkTable.id,
        conversationId: sceneBookmarkTable.conversationId,
        messageId: sceneBookmarkTable.messageId,
        title: sceneBookmarkTable.title,
        snippet: sceneBookmarkTable.snippet,
        characterName: sceneBookmarkTable.characterName,
        characterId: sceneBookmarkTable.characterId,
        createdAt: sceneBookmarkTable.createdAt,
      })
      .from(sceneBookmarkTable)
      .where(
        and(
          eq(sceneBookmarkTable.userId, userId),
          characterId ? eq(sceneBookmarkTable.characterId, characterId) : undefined,
          parsedCursor
            ? compositeCursorFilter(
                sceneBookmarkTable.createdAt,
                sceneBookmarkTable.id,
                parsedCursor,
              )
            : undefined,
          searchClause,
        ),
      )
      .orderBy(desc(sceneBookmarkTable.createdAt), desc(sceneBookmarkTable.id))
      .limit(limit + 1);
    const items = rows.slice(0, limit);
    const last = items.at(-1);
    const nextCursor =
      rows.length > limit && last
        ? encodeCompositeCursor({ createdAt: last.createdAt, id: last.id })
        : null;

    return c.json({ items, nextCursor });
  })
  .post("/", zValidator("json", sceneBookmarkCreateSchema), async (c) => {
    const userEmail = await getUserEmail(c);
    if (!userEmail) return c.json({ error: "unauthorized" }, 401);

    const payload = c.req.valid("json");
    const database = drizzle(c.env.DB);
    const userId = await ensureUser(database, userEmail);
    const bookmarkId = payload.id ?? crypto.randomUUID();

    if (payload.id) {
      const existing = await database
        .select({
          id: sceneBookmarkTable.id,
          conversationId: sceneBookmarkTable.conversationId,
          messageId: sceneBookmarkTable.messageId,
          title: sceneBookmarkTable.title,
          snippet: sceneBookmarkTable.snippet,
          characterName: sceneBookmarkTable.characterName,
          characterId: sceneBookmarkTable.characterId,
          createdAt: sceneBookmarkTable.createdAt,
        })
        .from(sceneBookmarkTable)
        .where(and(eq(sceneBookmarkTable.id, payload.id), eq(sceneBookmarkTable.userId, userId)))
        .limit(1);
      if (existing[0]) return c.json({ bookmark: existing[0] });
    }

    const conversationRows = await database
      .select({ id: conversationTable.id })
      .from(conversationTable)
      .where(
        and(eq(conversationTable.id, payload.conversationId), eq(conversationTable.userId, userId)),
      )
      .limit(1);
    if (!conversationRows[0]) return c.json({ error: "conversation not found" }, 404);

    const messageRows = await database
      .select({ id: messageTable.id })
      .from(messageTable)
      .where(
        and(
          eq(messageTable.id, payload.messageId),
          eq(messageTable.conversationId, payload.conversationId),
          eq(messageTable.userId, userId),
        ),
      )
      .limit(1);
    if (!messageRows[0]) return c.json({ error: "message not found" }, 404);

    if (payload.characterId) {
      const owned = await validateCharacterOwnership(database, payload.characterId, userId);
      if (!owned) return c.json({ error: "character not found" }, 404);
    }

    const bookmark = {
      id: bookmarkId,
      userId,
      conversationId: payload.conversationId,
      messageId: payload.messageId,
      title: payload.title,
      snippet: payload.snippet,
      characterName: payload.characterName,
      characterId: payload.characterId ?? null,
      createdAt: Date.now(),
    };
    await database.insert(sceneBookmarkTable).values(bookmark);

    return c.json(
      {
        bookmark: {
          id: bookmark.id,
          conversationId: bookmark.conversationId,
          messageId: bookmark.messageId,
          title: bookmark.title,
          snippet: bookmark.snippet,
          characterName: bookmark.characterName,
          characterId: bookmark.characterId,
          createdAt: bookmark.createdAt,
        },
      },
      201,
    );
  })
  .patch("/:id", zValidator("json", sceneBookmarkUpdateSchema), async (c) => {
    const userEmail = await getUserEmail(c);
    if (!userEmail) return c.json({ error: "unauthorized" }, 401);

    const bookmarkId = c.req.param("id");
    if (!idSchema.safeParse(bookmarkId).success) {
      return c.json({ error: "invalid bookmark id" }, 400);
    }

    const { title } = c.req.valid("json");
    const database = drizzle(c.env.DB);
    const userId = await ensureUser(database, userEmail);
    const existing = await database
      .select({ id: sceneBookmarkTable.id })
      .from(sceneBookmarkTable)
      .where(and(eq(sceneBookmarkTable.id, bookmarkId), eq(sceneBookmarkTable.userId, userId)))
      .limit(1);
    if (!existing[0]) return c.json({ error: "bookmark not found" }, 404);

    await database
      .update(sceneBookmarkTable)
      .set({ title })
      .where(and(eq(sceneBookmarkTable.id, bookmarkId), eq(sceneBookmarkTable.userId, userId)));

    const rows = await database
      .select({
        id: sceneBookmarkTable.id,
        conversationId: sceneBookmarkTable.conversationId,
        messageId: sceneBookmarkTable.messageId,
        title: sceneBookmarkTable.title,
        snippet: sceneBookmarkTable.snippet,
        characterName: sceneBookmarkTable.characterName,
        characterId: sceneBookmarkTable.characterId,
        createdAt: sceneBookmarkTable.createdAt,
      })
      .from(sceneBookmarkTable)
      .where(and(eq(sceneBookmarkTable.id, bookmarkId), eq(sceneBookmarkTable.userId, userId)))
      .limit(1);

    return c.json({ bookmark: rows[0] });
  })
  .delete("/:id", async (c) => {
    const userEmail = await getUserEmail(c);
    if (!userEmail) return c.json({ error: "unauthorized" }, 401);

    const bookmarkId = c.req.param("id");
    if (!idSchema.safeParse(bookmarkId).success) {
      return c.json({ error: "invalid bookmark id" }, 400);
    }

    const database = drizzle(c.env.DB);
    const userId = await ensureUser(database, userEmail);
    const existing = await database
      .select({ id: sceneBookmarkTable.id })
      .from(sceneBookmarkTable)
      .where(and(eq(sceneBookmarkTable.id, bookmarkId), eq(sceneBookmarkTable.userId, userId)))
      .limit(1);
    if (!existing[0]) return c.json({ error: "bookmark not found" }, 404);

    await database
      .delete(sceneBookmarkTable)
      .where(and(eq(sceneBookmarkTable.id, bookmarkId), eq(sceneBookmarkTable.userId, userId)));

    return c.json({ ok: true });
  });
