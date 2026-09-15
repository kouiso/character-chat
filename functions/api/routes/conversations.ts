import { zValidator } from "@hono/zod-validator";
import { and, asc, desc, eq, gt, inArray, lt, ne, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { alias } from "drizzle-orm/sqlite-core";
import { Hono } from "hono";

import { buildMessageSearchSnippet } from "../../../src/lib/message-search";
import { stripInlineEmphasisMarkers, stripXmlTags } from "../../../src/lib/xml-response-parser";
import {
  characterTable,
  conversationTable,
  messageFeedbackTable,
  messageTable,
} from "../../../src/schema";
import { selectInChunks } from "../lib/db-chunk";
import {
  buildCharacterSystemPromptWithRelationship,
  buildConversationResponse,
  conversationCreateSchema,
  deleteConversationChildren,
  deleteUserConversationChildren,
  ensureUser,
  escapeSqlLikePattern,
  fetchCharacterForConversation,
  fetchMessageCountsByCharacter,
  fetchRecentMemoryNotes,
  getUserEmail,
  idSchema,
  messageFeedbackSchema,
  MESSAGE_SEARCH_SNIPPET_LENGTH,
  messageSearchSchema,
  messageUpdateImageSchema,
  validateCharacterOwnership,
  type Bindings,
} from "../lib/route-context";

export const conversationRoutes = new Hono<{ Bindings: Bindings }>()
  // ── 会話一覧（キャラクター情報をJOINして返す） ──────────────────────────
  .get("/conversations", async (c) => {
    const userEmail = await getUserEmail(c);
    if (!userEmail) {
      return c.json({ error: "unauthorized" }, 401);
    }

    const database = drizzle(c.env.DB);
    const userId = await ensureUser(database, userEmail);
    const parentConversation = alias(conversationTable, "parent_conversation");
    const rows = await database
      .select({
        id: conversationTable.id,
        title: conversationTable.title,
        characterId: conversationTable.characterId,
        parentConversationId: conversationTable.parentConversationId,
        branchedFromMessageId: conversationTable.branchedFromMessageId,
        parentTitle: parentConversation.title,
        characterName: characterTable.name,
        updatedAt: conversationTable.updatedAt,
        createdAt: conversationTable.createdAt,
        characterGreeting: characterTable.greeting,
        characterSystemPrompt: characterTable.systemPrompt,
        characterAvatar: characterTable.avatar,
      })
      .from(conversationTable)
      .leftJoin(characterTable, eq(conversationTable.characterId, characterTable.id))
      .leftJoin(
        parentConversation,
        eq(conversationTable.parentConversationId, parentConversation.id),
      )
      .where(eq(conversationTable.userId, userId))
      .orderBy(desc(conversationTable.updatedAt));

    // C1: 各会話の最新 assistant メッセージを取得（プレビュー用）
    const conversationIds = rows.map((r) => r.id);
    const lastMessageMap = new Map<string, string>();
    if (conversationIds.length > 0) {
      // D1 の bound parameter 上限（100）を超える会話数に対応するため chunk 化
      const lastMessages = await selectInChunks(conversationIds, (chunk) =>
        database
          .select({
            conversationId: messageTable.conversationId,
            content: messageTable.content,
          })
          .from(messageTable)
          .where(
            and(inArray(messageTable.conversationId, chunk), eq(messageTable.role, "assistant")),
          )
          .orderBy(desc(messageTable.createdAt)),
      );
      // 各会話の最初にヒットしたもの（最新）だけを保持
      for (const msg of lastMessages) {
        if (!lastMessageMap.has(msg.conversationId)) {
          // XML タグを取り除いて先頭50字。強調の * も落とす——強調を頼む位置が
          // 段落の頭なので、何もせんとプレビューの先頭50字に一番出る。
          const stripped = stripInlineEmphasisMarkers(msg.content)
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 50);
          lastMessageMap.set(msg.conversationId, stripped);
        }
      }
    }

    const messageCountsByCharacter = await fetchMessageCountsByCharacter(database, userId, [
      ...new Set(rows.map((row) => row.characterId)),
    ]);

    const conversations = rows.map((r) => ({
      id: r.id,
      title: r.title,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      characterId: r.characterId,
      characterName: r.characterName ?? "AI",
      characterGreeting: r.characterGreeting ?? "",
      characterSystemPrompt:
        r.characterSystemPrompt && r.characterName
          ? buildCharacterSystemPromptWithRelationship(
              r.characterSystemPrompt,
              r.characterName,
              [],
              messageCountsByCharacter.get(r.characterId) ?? 0,
            )
          : (r.characterSystemPrompt ?? ""),
      characterAvatar: r.characterAvatar ?? null,
      parentConversationId: r.parentConversationId,
      branchedFromMessageId: r.branchedFromMessageId,
      parentTitle: r.parentTitle,
      lastAssistantMessage: lastMessageMap.get(r.id),
    }));

    return c.json({ conversations });
  })

  .post("/conversations", zValidator("json", conversationCreateSchema), async (c) => {
    const userEmail = await getUserEmail(c);
    if (!userEmail) {
      return c.json({ error: "unauthorized" }, 401);
    }

    const { title, characterId } = c.req.valid("json");
    const database = drizzle(c.env.DB);
    const userId = await ensureUser(database, userEmail);
    const now = Date.now();
    const conversationId = crypto.randomUUID();

    const fallbackCharacterId = (
      await database
        .select({ id: characterTable.id })
        .from(characterTable)
        .where(eq(characterTable.userId, userId))
        .orderBy(asc(characterTable.displayOrder), desc(characterTable.createdAt))
        .limit(1)
    )[0]?.id;

    if (characterId) {
      const owned = await validateCharacterOwnership(database, characterId, userId);
      if (!owned) return c.json({ error: "character not found" }, 404);
    }

    if (!characterId && !fallbackCharacterId) {
      return c.json(
        {
          error: "character required",
          message: "Please create your first character before starting a conversation.",
        },
        400,
      );
    }

    const resolvedCharacterId = characterId ?? fallbackCharacterId;
    if (!resolvedCharacterId) {
      return c.json({ error: "no_character" }, 400);
    }

    await database
      .insert(conversationTable)
      .values({
        id: conversationId,
        userId,
        characterId: resolvedCharacterId,
        title: title ?? "新しい会話",
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing();

    // greeting を D1 に永続化し、以降の LLM コンテキストに含める
    const ch = await fetchCharacterForConversation(database, userId, resolvedCharacterId);
    let greetingMessageId: string | null = null;
    if (ch?.greeting?.trim()) {
      greetingMessageId = `greeting-${conversationId}`;
      try {
        await database.insert(messageTable).values({
          id: greetingMessageId,
          userId,
          conversationId,
          characterId: resolvedCharacterId,
          role: "assistant",
          content: ch.greeting,
          createdAt: now,
        });
      } catch (error) {
        // D1 にトランザクションが無いため、失敗した会話行は自分で戻す。
        // 残すとクライアントが id を持たんまま作り直し、空の「新しい会話」が溜まる。
        console.error("failed to insert greeting message", error);
        await database
          .delete(conversationTable)
          .where(
            and(eq(conversationTable.id, conversationId), eq(conversationTable.userId, userId)),
          );
        return c.json({ error: "failed to create conversation" }, 500);
      }
    }

    const messageCountsByCharacter = await fetchMessageCountsByCharacter(database, userId, [
      resolvedCharacterId,
    ]);
    const memoryNotes = await fetchRecentMemoryNotes(database, userId, resolvedCharacterId);
    const characterSystemPrompt = ch?.systemPrompt
      ? buildCharacterSystemPromptWithRelationship(
          ch.systemPrompt,
          ch.name,
          memoryNotes.map((note) => note.content),
          messageCountsByCharacter.get(resolvedCharacterId) ?? 0,
        )
      : (ch?.systemPrompt ?? "");

    const conversation = {
      ...buildConversationResponse(
        conversationId,
        title,
        now,
        resolvedCharacterId,
        ch ? { ...ch, systemPrompt: characterSystemPrompt } : ch,
      ),
      greetingMessageId,
    };

    return c.json({ conversation }, 201);
  })

  .get("/conversations/:conversationId/branches", async (c) => {
    const userEmail = await getUserEmail(c);
    if (!userEmail) return c.json({ error: "unauthorized" }, 401);

    const conversationId = c.req.param("conversationId");
    if (!idSchema.safeParse(conversationId).success) {
      return c.json({ error: "invalid conversation id" }, 400);
    }

    const database = drizzle(c.env.DB);
    const userId = await ensureUser(database, userEmail);

    const sourceRows = await database
      .select({ id: conversationTable.id })
      .from(conversationTable)
      .where(and(eq(conversationTable.id, conversationId), eq(conversationTable.userId, userId)))
      .limit(1);
    if (!sourceRows[0]) return c.json({ error: "conversation not found" }, 404);

    const parentConversation = alias(conversationTable, "parent_conversation");
    const rows = await database
      .select({
        id: conversationTable.id,
        title: conversationTable.title,
        characterId: conversationTable.characterId,
        parentConversationId: conversationTable.parentConversationId,
        branchedFromMessageId: conversationTable.branchedFromMessageId,
        parentTitle: parentConversation.title,
        characterName: characterTable.name,
        updatedAt: conversationTable.updatedAt,
        createdAt: conversationTable.createdAt,
        characterGreeting: characterTable.greeting,
        characterSystemPrompt: characterTable.systemPrompt,
        characterAvatar: characterTable.avatar,
      })
      .from(conversationTable)
      .leftJoin(characterTable, eq(conversationTable.characterId, characterTable.id))
      .leftJoin(
        parentConversation,
        eq(conversationTable.parentConversationId, parentConversation.id),
      )
      .where(
        and(
          eq(conversationTable.userId, userId),
          eq(conversationTable.parentConversationId, conversationId),
        ),
      )
      .orderBy(desc(conversationTable.updatedAt));

    const messageCountsByCharacter = await fetchMessageCountsByCharacter(database, userId, [
      ...new Set(rows.map((row) => row.characterId)),
    ]);

    const conversations = rows.map((r) => ({
      id: r.id,
      title: r.title,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      characterId: r.characterId,
      characterName: r.characterName ?? "AI",
      characterGreeting: r.characterGreeting ?? "",
      characterSystemPrompt:
        r.characterSystemPrompt && r.characterName
          ? buildCharacterSystemPromptWithRelationship(
              r.characterSystemPrompt,
              r.characterName,
              [],
              messageCountsByCharacter.get(r.characterId) ?? 0,
            )
          : (r.characterSystemPrompt ?? ""),
      characterAvatar: r.characterAvatar ?? null,
      parentConversationId: r.parentConversationId,
      branchedFromMessageId: r.branchedFromMessageId,
      parentTitle: r.parentTitle,
    }));

    return c.json({ conversations });
  })

  // ── 全会話一括削除 ─────────────────────────────────────────────────────
  .delete("/conversations", async (c) => {
    const userEmail = await getUserEmail(c);
    if (!userEmail) return c.json({ error: "unauthorized" }, 401);

    const database = drizzle(c.env.DB);
    const userId = await ensureUser(database, userEmail);

    await deleteUserConversationChildren(database, userId);
    await database.delete(messageTable).where(eq(messageTable.userId, userId));
    await database.delete(conversationTable).where(eq(conversationTable.userId, userId));

    return c.json({ ok: true });
  })

  // ── 会話削除（メッセージも一緒に削除） ─────────────────────────────────
  .delete("/conversations/:conversationId", async (c) => {
    const userEmail = await getUserEmail(c);
    if (!userEmail) return c.json({ error: "unauthorized" }, 401);

    const conversationId = c.req.param("conversationId");
    if (!idSchema.safeParse(conversationId).success) {
      return c.json({ error: "invalid conversation id" }, 400);
    }

    const database = drizzle(c.env.DB);
    const userId = await ensureUser(database, userEmail);

    const conversationRows = await database
      .select({ id: conversationTable.id })
      .from(conversationTable)
      .where(and(eq(conversationTable.id, conversationId), eq(conversationTable.userId, userId)))
      .limit(1);
    if (!conversationRows[0]) return c.json({ error: "conversation not found" }, 404);

    await deleteConversationChildren(database, userId, conversationId);
    await database
      .delete(messageTable)
      .where(and(eq(messageTable.conversationId, conversationId), eq(messageTable.userId, userId)));

    await database
      .delete(conversationTable)
      .where(and(eq(conversationTable.id, conversationId), eq(conversationTable.userId, userId)));

    return c.json({ ok: true });
  })

  .get("/conversations/search/messages", zValidator("query", messageSearchSchema), async (c) => {
    const userEmail = await getUserEmail(c);
    if (!userEmail) {
      return c.json({ error: "unauthorized" }, 401);
    }

    const { q, limit } = c.req.valid("query");
    const database = drizzle(c.env.DB);
    const userId = await ensureUser(database, userEmail);
    const normalizedQuery = q.toLowerCase();
    const likePattern = `%${escapeSqlLikePattern(normalizedQuery)}%`;

    const rows = await database
      .select({
        messageId: messageTable.id,
        conversationId: conversationTable.id,
        conversationTitle: conversationTable.title,
        role: messageTable.role,
        // 切り出しは SQL やのうて JS 側でやる。SQL の substr は生 XML の文字位置で切るので、
        // タグを剥がした後の本文と窓がずれ、ヒット語が窓から外れる。
        content: messageTable.content,
        createdAt: messageTable.createdAt,
        characterName: characterTable.name,
        characterAvatar: characterTable.avatar,
      })
      .from(messageTable)
      .innerJoin(conversationTable, eq(messageTable.conversationId, conversationTable.id))
      .leftJoin(characterTable, eq(conversationTable.characterId, characterTable.id))
      .where(
        and(
          eq(messageTable.userId, userId),
          eq(conversationTable.userId, userId),
          ne(messageTable.role, "system"),
          sql`lower(${messageTable.content}) LIKE ${likePattern} ESCAPE '\\'`,
        ),
      )
      .orderBy(desc(messageTable.createdAt))
      .limit(limit);

    return c.json({
      results: rows.map((row) => ({
        messageId: row.messageId,
        conversationId: row.conversationId,
        conversationTitle: row.conversationTitle,
        role: row.role,
        // 吹き出し・読み上げ・共有ページと同じ stripXmlTags を通す。ここだけ剥がさんかったら
        // 一覧に生タグ（</action> 等）がそのまま出る。
        snippet: buildMessageSearchSnippet(
          stripXmlTags(row.content),
          q,
          MESSAGE_SEARCH_SNIPPET_LENGTH,
        ),
        createdAt: row.createdAt,
        characterName: row.characterName ?? "AI",
        characterAvatar: row.characterAvatar ?? null,
      })),
    });
  })

  .get("/conversations/:conversationId/messages", async (c) => {
    const userEmail = await getUserEmail(c);
    if (!userEmail) {
      return c.json({ error: "unauthorized" }, 401);
    }

    const conversationId = c.req.param("conversationId");
    if (!idSchema.safeParse(conversationId).success) {
      return c.json({ error: "invalid conversation id" }, 400);
    }

    const database = drizzle(c.env.DB);
    const userId = await ensureUser(database, userEmail);

    const ownConversation = await database
      .select({ id: conversationTable.id })
      .from(conversationTable)
      .where(and(eq(conversationTable.id, conversationId), eq(conversationTable.userId, userId)))
      .limit(1);

    if (ownConversation.length === 0) {
      return c.json({ error: "conversation not found" }, 404);
    }

    const messages = await database
      .select({
        id: messageTable.id,
        role: messageTable.role,
        content: messageTable.content,
        imageUrl: messageTable.imageUrl,
        imageKey: messageTable.imageKey,
        imagePrompt: messageTable.imagePrompt,
        imageSeed: messageTable.imageSeed,
        imageLoraModel: messageTable.imageLoraModel,
        imageLoraWeight: messageTable.imageLoraWeight,
        imageLoraTriggerPrompt: messageTable.imageLoraTriggerPrompt,
        createdAt: messageTable.createdAt,
        // 実際に本文を生成したモデル。x-model-used ヘッダは1トークン目のモデルで固定され
        // 作り直しに追随せんため、計測はこの永続値を正とする。
        generationModel: messageTable.generationModel,
        generationPhase: messageTable.generationPhase,
        feedbackRating: messageFeedbackTable.rating,
      })
      .from(messageTable)
      .leftJoin(
        messageFeedbackTable,
        and(
          eq(messageFeedbackTable.messageId, messageTable.id),
          eq(messageFeedbackTable.userId, userId),
        ),
      )
      .where(and(eq(messageTable.conversationId, conversationId), eq(messageTable.userId, userId)))
      .orderBy(asc(messageTable.createdAt));

    return c.json({
      messages: messages.map((message) => ({
        ...message,
        feedbackRating: message.feedbackRating ?? null,
      })),
    });
  })

  .delete("/conversations/:conversationId/messages/:messageId", async (c) => {
    const userEmail = await getUserEmail(c);
    if (!userEmail) return c.json({ error: "unauthorized" }, 401);

    const conversationId = c.req.param("conversationId");
    const messageId = c.req.param("messageId");
    if (!idSchema.safeParse(conversationId).success || !idSchema.safeParse(messageId).success) {
      return c.json({ error: "invalid id" }, 400);
    }

    const database = drizzle(c.env.DB);
    const userId = await ensureUser(database, userEmail);

    const deleted = await database
      .delete(messageTable)
      .where(
        and(
          eq(messageTable.id, messageId),
          eq(messageTable.conversationId, conversationId),
          eq(messageTable.userId, userId),
        ),
      )
      .returning({ id: messageTable.id });

    if (deleted.length === 0) return c.json({ error: "message not found" }, 404);

    await database
      .update(conversationTable)
      .set({ updatedAt: Date.now() })
      .where(and(eq(conversationTable.id, conversationId), eq(conversationTable.userId, userId)));

    return c.json({ ok: true });
  })

  // ── メッセージ以降を全削除（再生成・編集に使う） ───────────────────────
  .delete("/conversations/:conversationId/messages-after/:messageId", async (c) => {
    const userEmail = await getUserEmail(c);
    if (!userEmail) return c.json({ error: "unauthorized" }, 401);

    const conversationId = c.req.param("conversationId");
    const messageId = c.req.param("messageId");
    if (!idSchema.safeParse(conversationId).success || !idSchema.safeParse(messageId).success) {
      return c.json({ error: "invalid id" }, 400);
    }

    const database = drizzle(c.env.DB);
    const userId = await ensureUser(database, userEmail);

    // 会話で絞らんと、別会話の messageId の createdAt を基準にこの会話の末尾が消える。
    const pivot = await database
      .select({ createdAt: messageTable.createdAt })
      .from(messageTable)
      .where(
        and(
          eq(messageTable.id, messageId),
          eq(messageTable.conversationId, conversationId),
          eq(messageTable.userId, userId),
        ),
      )
      .limit(1);

    if (pivot.length === 0) return c.json({ error: "message not found" }, 404);

    await database
      .delete(messageTable)
      .where(
        and(
          eq(messageTable.conversationId, conversationId),
          eq(messageTable.userId, userId),
          gt(messageTable.createdAt, pivot[0].createdAt),
        ),
      );

    return c.json({ ok: true });
  })

  .post("/messages/:messageId/feedback", zValidator("json", messageFeedbackSchema), async (c) => {
    const userEmail = await getUserEmail(c);
    if (!userEmail) return c.json({ error: "unauthorized" }, 401);

    const messageId = c.req.param("messageId");
    if (!idSchema.safeParse(messageId).success) {
      return c.json({ error: "invalid message id" }, 400);
    }

    const database = drizzle(c.env.DB);
    const userId = await ensureUser(database, userEmail);
    const payload = c.req.valid("json");

    const rows = await database
      .select({
        id: messageTable.id,
        conversationId: messageTable.conversationId,
        characterId: messageTable.characterId,
        content: messageTable.content,
        createdAt: messageTable.createdAt,
      })
      .from(messageTable)
      .where(and(eq(messageTable.id, messageId), eq(messageTable.userId, userId)))
      .limit(1);

    const message = rows[0];
    if (!message) return c.json({ error: "message not found" }, 404);

    const previousRows = await database
      .select({ content: messageTable.content })
      .from(messageTable)
      .where(
        and(
          eq(messageTable.conversationId, message.conversationId),
          eq(messageTable.userId, userId),
          eq(messageTable.role, "user"),
          lt(messageTable.createdAt, message.createdAt),
        ),
      )
      .orderBy(desc(messageTable.createdAt))
      .limit(1);

    const now = Date.now();
    await database
      .delete(messageFeedbackTable)
      .where(eq(messageFeedbackTable.messageId, messageId));
    await database.insert(messageFeedbackTable).values({
      messageId,
      userId,
      conversationId: message.conversationId,
      characterId: message.characterId,
      rating: payload.rating,
      reason: payload.rating === "bad" ? (payload.reason ?? null) : null,
      messageContent: message.content.slice(0, 4000),
      previousUserContent: previousRows[0]?.content.slice(0, 1000) ?? null,
      variantId: payload.variantId ?? null,
      createdAt: now,
      updatedAt: now,
    });

    return c.json({ ok: true });
  })

  .patch("/messages/:messageId/image", zValidator("json", messageUpdateImageSchema), async (c) => {
    const userEmail = await getUserEmail(c);
    if (!userEmail) {
      return c.json({ error: "unauthorized" }, 401);
    }

    const messageId = c.req.param("messageId");
    if (!idSchema.safeParse(messageId).success) {
      return c.json({ error: "invalid message id" }, 400);
    }

    const payload = c.req.valid("json");
    if (!payload.imageUrl && !payload.imageKey) {
      return c.json({ error: "imageUrl or imageKey is required" }, 400);
    }

    const database = drizzle(c.env.DB);
    const userId = await ensureUser(database, userEmail);

    await database
      .update(messageTable)
      .set({
        imageUrl: payload.imageUrl,
        imageKey: payload.imageKey,
        imagePrompt: payload.imagePrompt,
        imageSeed: payload.imageSeed,
        imageLoraModel: payload.imageLoraModel ?? null,
        imageLoraWeight: payload.imageLoraWeight ?? null,
        imageLoraTriggerPrompt: payload.imageLoraTriggerPrompt ?? null,
      })
      .where(and(eq(messageTable.id, messageId), eq(messageTable.userId, userId)));

    return c.json({ ok: true });
  });
