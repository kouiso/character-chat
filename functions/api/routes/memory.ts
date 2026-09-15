import { zValidator } from "@hono/zod-validator";
import { and, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";

import { characterTable, memoryNoteTable } from "../../../src/schema";
import {
  checkContentFilter,
  ensureUser,
  getUserEmail,
  idSchema,
  memoryNoteCreateSchema,
  memoryNoteUpdateSchema,
  validateCharacterOwnership,
  type Bindings,
} from "../lib/route-context";

export const memoryRoutes = new Hono<{ Bindings: Bindings }>()
  .get("/", async (c) => {
    const userEmail = await getUserEmail(c);
    if (!userEmail) return c.json({ error: "unauthorized" }, 401);

    const characterId = c.req.query("characterId");
    const database = drizzle(c.env.DB);
    const userId = await ensureUser(database, userEmail);

    const whereClause = characterId
      ? and(eq(memoryNoteTable.userId, userId), eq(memoryNoteTable.characterId, characterId))
      : eq(memoryNoteTable.userId, userId);

    const notes = await database
      .select({
        id: memoryNoteTable.id,
        characterId: memoryNoteTable.characterId,
        content: memoryNoteTable.content,
        sourceMessageId: memoryNoteTable.sourceMessageId,
        createdAt: memoryNoteTable.createdAt,
        lastUsedAt: memoryNoteTable.lastUsedAt,
        usageCount: memoryNoteTable.usageCount,
        characterName: characterTable.name,
        characterAvatar: characterTable.avatar,
      })
      .from(memoryNoteTable)
      .leftJoin(characterTable, eq(memoryNoteTable.characterId, characterTable.id))
      .where(whereClause)
      .orderBy(desc(memoryNoteTable.createdAt))
      .limit(200);

    return c.json({
      notes: notes.map((note) => ({
        ...note,
        characterName: note.characterName ?? "AI",
        characterAvatar: note.characterAvatar ?? null,
      })),
    });
  })

  .post("/", zValidator("json", memoryNoteCreateSchema), async (c) => {
    const userEmail = await getUserEmail(c);
    if (!userEmail) return c.json({ error: "unauthorized" }, 401);

    const payload = c.req.valid("json");
    const filterResult = checkContentFilter(payload.content);
    if (filterResult.blocked) {
      return c.json({ error: `content_blocked: ${filterResult.reason}` }, 403);
    }

    const database = drizzle(c.env.DB);
    const userId = await ensureUser(database, userEmail);
    const owned = await validateCharacterOwnership(database, payload.characterId, userId);
    if (!owned) return c.json({ error: "character not found" }, 404);

    const now = Date.now();
    const note = {
      id: crypto.randomUUID(),
      userId,
      characterId: payload.characterId,
      content: payload.content,
      sourceMessageId: null,
      createdAt: now,
      lastUsedAt: null,
      usageCount: 0,
    };
    await database.insert(memoryNoteTable).values(note);

    return c.json({ note: { ...note, characterName: null, characterAvatar: null } }, 201);
  })

  .patch("/:noteId", zValidator("json", memoryNoteUpdateSchema), async (c) => {
    const userEmail = await getUserEmail(c);
    if (!userEmail) return c.json({ error: "unauthorized" }, 401);

    const noteId = c.req.param("noteId");
    if (!idSchema.safeParse(noteId).success) return c.json({ error: "invalid note id" }, 400);

    const { content } = c.req.valid("json");
    const filterResult = checkContentFilter(content);
    if (filterResult.blocked) {
      return c.json({ error: `content_blocked: ${filterResult.reason}` }, 403);
    }

    const database = drizzle(c.env.DB);
    const userId = await ensureUser(database, userEmail);
    // UPDATE 自体は userId で絞れとるので他人の行は書き換わらんが、一致が0件でも
    // {ok:true} を返しとった。クライアントは response.ok しか見んので、保存でけてへん
    // 編集を保存済みとして表示してまう。兄弟の PATCH /scene-bookmarks/:id と同じ形にする。
    const existing = await database
      .select({ id: memoryNoteTable.id })
      .from(memoryNoteTable)
      .where(and(eq(memoryNoteTable.id, noteId), eq(memoryNoteTable.userId, userId)))
      .limit(1);
    if (!existing[0]) return c.json({ error: "memory note not found" }, 404);

    await database
      .update(memoryNoteTable)
      .set({
        content,
        // 手編集したノートは元メッセージから切り離す。そうしないと会話削除／再生成／
        // メッセージ削除で CASCADE or 再挿入によって巻き戻ってしまう。
        editedAt: Date.now(),
        sourceMessageId: null,
      })
      .where(and(eq(memoryNoteTable.id, noteId), eq(memoryNoteTable.userId, userId)));

    return c.json({ ok: true });
  })

  .delete("/:noteId", async (c) => {
    const userEmail = await getUserEmail(c);
    if (!userEmail) return c.json({ error: "unauthorized" }, 401);

    const noteId = c.req.param("noteId");
    if (!idSchema.safeParse(noteId).success) return c.json({ error: "invalid note id" }, 400);

    const database = drizzle(c.env.DB);
    const userId = await ensureUser(database, userEmail);
    const existing = await database
      .select({ id: memoryNoteTable.id })
      .from(memoryNoteTable)
      .where(and(eq(memoryNoteTable.id, noteId), eq(memoryNoteTable.userId, userId)))
      .limit(1);
    if (!existing[0]) return c.json({ error: "note not found" }, 404);

    await database
      .delete(memoryNoteTable)
      .where(and(eq(memoryNoteTable.id, noteId), eq(memoryNoteTable.userId, userId)));

    return c.json({ ok: true });
  });
