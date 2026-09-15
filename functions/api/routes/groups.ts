import { zValidator } from "@hono/zod-validator";
import { and, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";

import { groupMessageTable, groupTable } from "../../../src/schema";
import {
  checkContentFilter,
  CLAUDE_SESSION_EXPIRED,
  compositeCursorFilter,
  createGroupReply,
  decodeCompositeCursor,
  encodeCompositeCursor,
  ensureUniqueGroupCharacterIds,
  ensureUser,
  enforceRateLimit,
  fetchGroupRow,
  getUserEmail,
  groupCreateSchema,
  groupListSchema,
  groupMessageListSchema,
  groupMessageSendSchema,
  idSchema,
  logUsage,
  rejectAndRelease,
  replayChunksWithMetaAsStream,
  respondClaudeSessionExpired,
  toGroupResponse,
  validateGroupCharacters,
  type Bindings,
} from "../lib/route-context";

export const groupRoutes = new Hono<{ Bindings: Bindings }>()
  .post("/", zValidator("json", groupCreateSchema), async (c) => {
    const userEmail = await getUserEmail(c);
    if (!userEmail) return c.json({ error: "unauthorized" }, 401);

    const payload = c.req.valid("json");
    const uniqueCharacterIds = ensureUniqueGroupCharacterIds(payload.characterIds);
    if (!uniqueCharacterIds) return c.json({ error: "duplicate character ids" }, 400);

    const filterResult = checkContentFilter([payload.name, payload.scenario ?? ""].join("\n"));
    if (filterResult.blocked) {
      return c.json({ error: `content_blocked: ${filterResult.reason}` }, 403);
    }

    const database = drizzle(c.env.DB);
    const userId = await ensureUser(database, userEmail);
    const now = Date.now();

    const validCharacters = await validateGroupCharacters(database, uniqueCharacterIds, userId);
    if (!validCharacters) return c.json({ error: "character not found" }, 404);

    const group = {
      id: crypto.randomUUID(),
      userId,
      name: payload.name,
      characterIds: uniqueCharacterIds,
      scenario: payload.scenario || null,
      createdAt: now,
    };
    await database.insert(groupTable).values(group);

    return c.json({ group: await toGroupResponse(database, group, userId) }, 201);
  })
  .get("/", zValidator("query", groupListSchema), async (c) => {
    const userEmail = await getUserEmail(c);
    if (!userEmail) return c.json({ error: "unauthorized" }, 401);

    const { limit, cursor } = c.req.valid("query");
    const parsedCursor = cursor ? decodeCompositeCursor(cursor) : null;
    if (cursor && !parsedCursor) {
      return c.json({ error: "invalid cursor" }, 400);
    }

    const database = drizzle(c.env.DB);
    const userId = await ensureUser(database, userEmail);

    const rows = await database
      .select()
      .from(groupTable)
      .where(
        and(
          eq(groupTable.userId, userId),
          parsedCursor
            ? compositeCursorFilter(groupTable.createdAt, groupTable.id, parsedCursor)
            : undefined,
        ),
      )
      .orderBy(desc(groupTable.createdAt), desc(groupTable.id))
      .limit(limit + 1);

    const page = rows.slice(0, limit);
    const last = page.at(-1);
    const nextCursor =
      rows.length > limit && last
        ? encodeCompositeCursor({ createdAt: last.createdAt, id: last.id })
        : null;

    const groups = await Promise.all(page.map((group) => toGroupResponse(database, group, userId)));
    return c.json({ groups, nextCursor });
  })
  .get("/:id", async (c) => {
    const userEmail = await getUserEmail(c);
    if (!userEmail) return c.json({ error: "unauthorized" }, 401);

    const groupId = c.req.param("id");
    if (!idSchema.safeParse(groupId).success) return c.json({ error: "invalid group id" }, 400);

    const database = drizzle(c.env.DB);
    const userId = await ensureUser(database, userEmail);

    const group = await fetchGroupRow(database, groupId, userId);
    if (!group) return c.json({ error: "group not found" }, 404);

    return c.json({ group: await toGroupResponse(database, group, userId) });
  })
  .delete("/:id", async (c) => {
    const userEmail = await getUserEmail(c);
    if (!userEmail) return c.json({ error: "unauthorized" }, 401);

    const groupId = c.req.param("id");
    if (!idSchema.safeParse(groupId).success) return c.json({ error: "invalid group id" }, 400);

    const database = drizzle(c.env.DB);
    const userId = await ensureUser(database, userEmail);

    const existing = await fetchGroupRow(database, groupId, userId);
    if (!existing) return c.json({ error: "group not found" }, 404);

    await database
      .delete(groupMessageTable)
      .where(and(eq(groupMessageTable.groupId, groupId), eq(groupMessageTable.userId, userId)));
    await database
      .delete(groupTable)
      .where(and(eq(groupTable.id, groupId), eq(groupTable.userId, userId)));

    return c.json({ ok: true });
  })
  .post("/:id/messages", zValidator("json", groupMessageSendSchema), async (c) => {
    const userEmail = await getUserEmail(c);
    if (!userEmail) return c.json({ error: "unauthorized" }, 401);

    const groupId = c.req.param("id");
    if (!idSchema.safeParse(groupId).success) return c.json({ error: "invalid group id" }, 400);

    const payload = c.req.valid("json");
    const filterResult = checkContentFilter([payload.content, payload.imageHint ?? ""].join("\n"));
    if (filterResult.blocked) {
      return c.json({ error: `content_blocked: ${filterResult.reason}` }, 403);
    }

    const rl = await enforceRateLimit(c, drizzle(c.env.DB), userEmail, "chat");
    if (!rl.ok) return c.json({ error: `rate_limited: ${rl.reason}` }, 429);

    const { database, userId } = rl.ctx;

    const group = await fetchGroupRow(database, groupId, userId);
    if (!group) {
      return rejectAndRelease(c, rl, "chat", { error: "group not found" }, 404);
    }

    const reply = await createGroupReply({
      env: c.env,
      database,
      userId,
      group,
      content: payload.content,
      imageHint: payload.imageHint,
      clientSignal: c.req.raw.signal,
    });
    if (!reply.ok && reply.error === CLAUDE_SESSION_EXPIRED) {
      return respondClaudeSessionExpired(c);
    }
    if (!reply.ok) return c.json({ error: reply.error }, 502);

    c.executionCtx.waitUntil(logUsage(database, userId, "chat", reply.usedModel));

    return new Response(replayChunksWithMetaAsStream(reply.chunks, []), {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "x-model-used": reply.usedModel,
        "x-quality-warning": "0",
      },
    });
  })
  .get("/:id/messages", zValidator("query", groupMessageListSchema), async (c) => {
    const userEmail = await getUserEmail(c);
    if (!userEmail) return c.json({ error: "unauthorized" }, 401);

    const groupId = c.req.param("id");
    if (!idSchema.safeParse(groupId).success) return c.json({ error: "invalid group id" }, 400);

    const query = c.req.valid("query");
    const database = drizzle(c.env.DB);
    const userId = await ensureUser(database, userEmail);
    const group = await fetchGroupRow(database, groupId, userId);
    if (!group) return c.json({ error: "group not found" }, 404);

    const parsedCursor = query.cursor ? decodeCompositeCursor(query.cursor) : null;
    if (query.cursor && !parsedCursor) {
      return c.json({ error: "invalid cursor" }, 400);
    }

    const rows = await database
      .select({
        id: groupMessageTable.id,
        groupId: groupMessageTable.groupId,
        role: groupMessageTable.role,
        speakerCharacterId: groupMessageTable.speakerCharacterId,
        content: groupMessageTable.content,
        imageUrl: groupMessageTable.imageUrl,
        imageKey: groupMessageTable.imageKey,
        createdAt: groupMessageTable.createdAt,
      })
      .from(groupMessageTable)
      .where(
        and(
          eq(groupMessageTable.groupId, groupId),
          eq(groupMessageTable.userId, userId),
          parsedCursor
            ? compositeCursorFilter(groupMessageTable.createdAt, groupMessageTable.id, parsedCursor)
            : undefined,
        ),
      )
      .orderBy(desc(groupMessageTable.createdAt), desc(groupMessageTable.id))
      .limit(query.limit + 1);

    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    const nextCursor =
      rows.length > query.limit && last
        ? encodeCompositeCursor({ createdAt: last.createdAt, id: last.id })
        : null;

    return c.json({ messages: page.reverse(), nextCursor });
  });
