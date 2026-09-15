import { zValidator } from "@hono/zod-validator";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";

import {
  characterSubImageTable,
  characterTable,
  conversationTable,
  messageTable,
  visualMetaSchema,
  type VisualMeta,
} from "../../../src/schema";
import { generateCharacterImageSeed } from "../lib/image-identity-context";
import {
  assembleVisualMetaMap,
  buildCharacterUpdatesWithSlug,
  characterCreateSchema,
  characterGalleryQuerySchema,
  characterUpdateSchema,
  ensureUser,
  generateUniqueSlug,
  getUserEmail,
  idSchema,
  isUserAvatarKey,
  loadVisualMeta,
  MAX_R2_IMAGE_SIZE_BYTES,
  persistVisualMeta,
  resolveImageType,
  validateAllowedImageUrl,
  validateCharacterOwnership,
  type Bindings,
} from "../lib/route-context";

export const characterRoutes = new Hono<{ Bindings: Bindings }>()
  .get("/character/:id/gallery", zValidator("query", characterGalleryQuerySchema), async (c) => {
    const userEmail = await getUserEmail(c);
    if (!userEmail) return c.json({ error: "unauthorized" }, 401);

    const characterId = c.req.param("id");
    if (!idSchema.safeParse(characterId).success) {
      return c.json({ error: "invalid character id" }, 400);
    }

    const { limit, cursor } = c.req.valid("query");
    const database = drizzle(c.env.DB);
    const userId = await ensureUser(database, userEmail);
    const rows = await database
      .select({
        imageUrl: messageTable.imageUrl,
        createdAt: messageTable.createdAt,
        messageId: messageTable.id,
        conversationId: messageTable.conversationId,
      })
      .from(messageTable)
      .where(
        and(
          eq(messageTable.userId, userId),
          eq(messageTable.characterId, characterId),
          sql`${messageTable.imageUrl} IS NOT NULL`,
          cursor ? sql`${messageTable.createdAt} < ${cursor}` : sql`1 = 1`,
        ),
      )
      .orderBy(desc(messageTable.createdAt))
      .limit(limit + 1);

    const hasNext = rows.length > limit;
    const sliced = hasNext ? rows.slice(0, limit) : rows;
    const nextCursor = hasNext ? (sliced.at(-1)?.createdAt ?? null) : null;
    return c.json({
      items: sliced.map((row) => ({
        image_url: row.imageUrl,
        created_at: row.createdAt,
        message_id: row.messageId,
        conversation_id: row.conversationId,
      })),
      next_cursor: nextCursor,
    });
  })

  // ── キャラクターCRUD ──

  .get("/characters", async (c) => {
    const userEmail = await getUserEmail(c);
    if (!userEmail) {
      return c.json({ error: "unauthorized" }, 401);
    }

    const database = drizzle(c.env.DB);
    const userId = await ensureUser(database, userEmail);
    const characters = await database
      .select({
        id: characterTable.id,
        userId: characterTable.userId,
        name: characterTable.name,
        nameReading: characterTable.nameReading,
        avatar: characterTable.avatar,
        isOfficial: characterTable.isOfficial,
        slug: characterTable.slug,
        subAvatars: characterTable.subAvatars,
        gender: characterTable.gender,
        userPersonaName: characterTable.userPersonaName,
        userPersonaGender: characterTable.userPersonaGender,
        userPersonaPersonality: characterTable.userPersonaPersonality,
        systemPrompt: characterTable.systemPrompt,
        visualPrompt: characterTable.visualPrompt,
        greeting: characterTable.greeting,
        tags: characterTable.tags,
        loraModel: characterTable.loraModel,
        loraWeight: characterTable.loraWeight,
        loraTriggerPrompt: characterTable.loraTriggerPrompt,
        createdAt: characterTable.createdAt,
      })
      .from(characterTable)
      .where(eq(characterTable.userId, userId))
      // 元キャラ (display_order=0) を import-* (=100) より前に出し、同順位内は新しい順。
      .orderBy(asc(characterTable.displayOrder), desc(characterTable.createdAt));

    // visualMeta 組み立てが失敗しても一覧自体は返す（編集フォームの pre-fill は劣化するが落とさない）
    const visualMetaMap = await assembleVisualMetaMap(
      database,
      characters.map((character) => character.id),
    ).catch(() => new Map<string, VisualMeta>());

    return c.json({
      characters: characters.map((character) => ({
        ...character,
        visualMeta: visualMetaMap.get(character.id) ?? null,
      })),
    });
  })

  .get("/characters/:characterId", async (c) => {
    const userEmail = await getUserEmail(c);
    if (!userEmail) {
      return c.json({ error: "unauthorized" }, 401);
    }

    const characterId = c.req.param("characterId");
    if (!idSchema.safeParse(characterId).success) {
      return c.json({ error: "invalid character id" }, 400);
    }

    const database = drizzle(c.env.DB);
    const userId = await ensureUser(database, userEmail);
    const rows = await database
      .select({
        id: characterTable.id,
        name: characterTable.name,
        nameReading: characterTable.nameReading,
        avatar: characterTable.avatar,
        isOfficial: characterTable.isOfficial,
        slug: characterTable.slug,
        subAvatars: characterTable.subAvatars,
        gender: characterTable.gender,
        userPersonaName: characterTable.userPersonaName,
        userPersonaGender: characterTable.userPersonaGender,
        userPersonaPersonality: characterTable.userPersonaPersonality,
        systemPrompt: characterTable.systemPrompt,
        visualPrompt: characterTable.visualPrompt,
        greeting: characterTable.greeting,
        tags: characterTable.tags,
        loraModel: characterTable.loraModel,
        loraWeight: characterTable.loraWeight,
        loraTriggerPrompt: characterTable.loraTriggerPrompt,
        createdAt: characterTable.createdAt,
      })
      .from(characterTable)
      .where(and(eq(characterTable.id, characterId), eq(characterTable.userId, userId)))
      .limit(1);

    if (rows.length === 0) {
      return c.json({ error: "character not found" }, 404);
    }

    const visualMeta = await loadVisualMeta(database, characterId);
    return c.json({ character: { ...rows[0], visualMeta } });
  })

  .post("/characters", zValidator("json", characterCreateSchema), async (c) => {
    const userEmail = await getUserEmail(c);
    if (!userEmail) {
      return c.json({ error: "unauthorized" }, 401);
    }

    const payload = c.req.valid("json");
    if (payload.avatar && !isUserAvatarKey(payload.avatar, userEmail)) {
      return c.json({ error: "invalid_avatar" }, 400);
    }

    const database = drizzle(c.env.DB);
    const userId = await ensureUser(database, userEmail);
    const characterId = crypto.randomUUID();
    const now = Date.now();
    const slug = await generateUniqueSlug(database, payload.name);

    await database.insert(characterTable).values({
      id: characterId,
      userId,
      name: payload.name,
      avatar: payload.avatar ?? null,
      gender: payload.gender ?? null,
      systemPrompt: payload.systemPrompt,
      visualPrompt: payload.visualPrompt ?? null,
      greeting: payload.greeting,
      tags: payload.tags,
      seed: generateCharacterImageSeed(),
      slug,
      userPersonaName: payload.userPersona?.name ?? null,
      userPersonaGender: payload.userPersona?.gender ?? null,
      userPersonaPersonality: payload.userPersona?.personality ?? null,
      createdAt: now,
    });

    if (payload.visualMeta) {
      await persistVisualMeta(database, characterId, payload.visualMeta, now);
    }

    return c.json(
      {
        character: {
          id: characterId,
          userId,
          name: payload.name,
          avatar: payload.avatar ?? null,
          slug,
          gender: payload.gender ?? null,
          systemPrompt: payload.systemPrompt,
          visualPrompt: payload.visualPrompt ?? null,
          greeting: payload.greeting,
          tags: payload.tags,
          userPersonaName: payload.userPersona?.name ?? null,
          userPersonaGender: payload.userPersona?.gender ?? null,
          userPersonaPersonality: payload.userPersona?.personality ?? null,
          createdAt: now,
        },
      },
      201,
    );
  })

  .put("/characters/:characterId", zValidator("json", characterUpdateSchema), async (c) => {
    const userEmail = await getUserEmail(c);
    if (!userEmail) {
      return c.json({ error: "unauthorized" }, 401);
    }

    const characterId = c.req.param("characterId");
    if (!idSchema.safeParse(characterId).success) {
      return c.json({ error: "invalid character id" }, 400);
    }

    const payload = c.req.valid("json");
    const database = drizzle(c.env.DB);
    const userId = await ensureUser(database, userEmail);

    const existing = await database
      .select({ id: characterTable.id, slug: characterTable.slug, avatar: characterTable.avatar })
      .from(characterTable)
      .where(and(eq(characterTable.id, characterId), eq(characterTable.userId, userId)))
      .limit(1);

    if (existing.length === 0) {
      return c.json({ error: "character not found" }, 404);
    }

    if (
      payload.avatar !== undefined &&
      payload.avatar !== existing[0].avatar &&
      !isUserAvatarKey(payload.avatar, userEmail)
    ) {
      return c.json({ error: "invalid_avatar" }, 400);
    }

    const updates = await buildCharacterUpdatesWithSlug(database, payload, existing[0].slug);

    if (Object.keys(updates).length > 0) {
      await database
        .update(characterTable)
        .set(updates)
        .where(and(eq(characterTable.id, characterId), eq(characterTable.userId, userId)));
    }

    // 敵対レビュー #1236 指摘（6巡目）: userPersonaNameはsanitizeUserDisplayNameで
    // サーバ側が正規化しうるため、クライアントが送信した生の入力をそのままキャッシュへ
    // 書き込むと、表示値とD1の実値が乖離する（リロードまで気づかない）。
    // 更新が発生した場合は、サーバが実際に DB に反映した値を返してクライアントのキャッシュを上書きする。
    return Object.keys(updates).length > 0 ? c.json({ ok: true, updates }) : c.json({ ok: true });
  })

  .patch(
    "/characters/:characterId/visual-meta",
    zValidator("json", visualMetaSchema),
    async (c) => {
      const userEmail = await getUserEmail(c);
      if (!userEmail) {
        return c.json({ error: "unauthorized" }, 401);
      }

      const characterId = c.req.param("characterId");
      if (!idSchema.safeParse(characterId).success) {
        return c.json({ error: "invalid character id" }, 400);
      }

      const meta = c.req.valid("json");
      const database = drizzle(c.env.DB);
      const userId = await ensureUser(database, userEmail);

      const existing = await database
        .select({ id: characterTable.id })
        .from(characterTable)
        .where(and(eq(characterTable.id, characterId), eq(characterTable.userId, userId)))
        .limit(1);

      if (existing.length === 0) {
        return c.json({ error: "character not found" }, 404);
      }

      await persistVisualMeta(database, characterId, meta, Date.now());

      return c.json({ ok: true });
    },
  )

  .delete("/characters/:characterId", async (c) => {
    const userEmail = await getUserEmail(c);
    if (!userEmail) {
      return c.json({ error: "unauthorized" }, 401);
    }

    const characterId = c.req.param("characterId");
    if (!idSchema.safeParse(characterId).success) {
      return c.json({ error: "invalid character id" }, 400);
    }

    const database = drizzle(c.env.DB);
    const userId = await ensureUser(database, userEmail);

    // このキャラクターを使用中の会話があれば削除不可
    const inUse = await database
      .select({ id: conversationTable.id })
      .from(conversationTable)
      .where(
        and(eq(conversationTable.characterId, characterId), eq(conversationTable.userId, userId)),
      )
      .limit(1);

    if (inUse.length > 0) {
      return c.json({ error: "character is in use by conversations" }, 409);
    }

    await database
      .delete(characterTable)
      .where(and(eq(characterTable.id, characterId), eq(characterTable.userId, userId)));

    return c.json({ ok: true });
  })

  .post("/characters/:characterId/sub-avatars", async (c) => {
    const userEmail = await getUserEmail(c);
    if (!userEmail) return c.json({ error: "unauthorized" }, 401);

    const characterId = c.req.param("characterId");
    if (!idSchema.safeParse(characterId).success) {
      return c.json({ error: "invalid character id" }, 400);
    }

    const body = await c.req.json<{ imageUrl?: string }>();
    if (!body?.imageUrl || typeof body.imageUrl !== "string") {
      return c.json({ error: "imageUrl required" }, 400);
    }

    const imageSource = validateAllowedImageUrl(body.imageUrl, c.env);
    if (!imageSource.ok) {
      return c.json({ error: imageSource.error }, imageSource.status);
    }

    const database = drizzle(c.env.DB);
    const userId = await ensureUser(database, userEmail);

    const existing = await database
      .select({ id: characterTable.id, subAvatars: characterTable.subAvatars })
      .from(characterTable)
      .where(and(eq(characterTable.id, characterId), eq(characterTable.userId, userId)))
      .limit(1);

    if (existing.length === 0) return c.json({ error: "character not found" }, 404);

    const imageResponse = await fetch(body.imageUrl);
    if (!imageResponse.ok || !imageResponse.body) {
      return c.json({ error: "failed to fetch image" }, 502);
    }

    const rawContentType = imageResponse.headers.get("content-type") ?? "";
    const resolved = resolveImageType(rawContentType, imageSource.parsedUrl.pathname);
    if (!resolved) return c.json({ error: "unsupported content type" }, 400);

    const imageBuffer = await imageResponse.arrayBuffer();
    if (imageBuffer.byteLength > MAX_R2_IMAGE_SIZE_BYTES) {
      return c.json({ error: "image too large" }, 413);
    }
    const subKey = `sub/${characterId}/${crypto.randomUUID()}.${resolved.ext}`;
    await c.env.BUCKET.put(`avatars/${subKey}`, imageBuffer, {
      httpMetadata: { contentType: resolved.contentType },
    });

    // json_insert で atomic append — 並行アップロード時の race condition を防ぐ
    await database
      .update(characterTable)
      .set({
        subAvatars: sql`json_insert(COALESCE(${characterTable.subAvatars}, '[]'), '$[#]', ${subKey})`,
      })
      .where(and(eq(characterTable.id, characterId), eq(characterTable.userId, userId)));

    return c.json({ subKey });
  })

  // ── キャラクターサブ画像 ──

  .get("/characters/:characterId/sub-images", async (c) => {
    const userEmail = await getUserEmail(c);
    if (!userEmail) return c.json({ error: "unauthorized" }, 401);

    const characterId = c.req.param("characterId");
    if (!idSchema.safeParse(characterId).success) {
      return c.json({ error: "invalid character id" }, 400);
    }

    const database = drizzle(c.env.DB);
    const userId = await ensureUser(database, userEmail);
    // 他ユーザーのキャラクター由来のサブ画像一覧を読ませないため。
    const owned = await validateCharacterOwnership(database, characterId, userId);
    if (!owned) return c.json({ error: "character not found" }, 404);

    const rows = await database
      .select({ r2Key: characterSubImageTable.r2Key, ord: characterSubImageTable.ord })
      .from(characterSubImageTable)
      // アーカイブ済みはアルバムに出さない（行は残すので取り消せる）。
      .where(
        and(
          eq(characterSubImageTable.characterId, characterId),
          isNull(characterSubImageTable.archivedAt),
        ),
      )
      .orderBy(asc(characterSubImageTable.ord));

    return c.json({
      images: rows.map((row) => ({
        url: `/api/image/r2/${row.r2Key}`,
        r2Key: row.r2Key,
        ord: row.ord,
      })),
    });
  });
