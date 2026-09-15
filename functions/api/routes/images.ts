import { zValidator } from "@hono/zod-validator";
import { and, desc, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";

import { characterTable, conversationTable, messageTable } from "../../../src/schema";
import {
  ensureUser,
  getD1Changes,
  getImageViewerEmail,
  getUserEmail,
  imagePersistSchema,
  isImageKeyOwnedByUser,
  MAX_R2_IMAGE_SIZE_BYTES,
  R2_KEY_PATTERN,
  resolveImageType,
  validateAllowedImageUrl,
  type Bindings,
} from "../lib/route-context";

export const imageRoutes = new Hono<{ Bindings: Bindings }>()
  .get("/gallery/images", async (c) => {
    const userEmail = await getUserEmail(c);
    if (!userEmail) return c.json({ error: "unauthorized" }, 401);

    const database = drizzle(c.env.DB);
    const userId = await ensureUser(database, userEmail);
    const images = await database
      .select({
        messageId: messageTable.id,
        conversationId: conversationTable.id,
        conversationTitle: conversationTable.title,
        characterId: conversationTable.characterId,
        characterName: characterTable.name,
        characterAvatar: characterTable.avatar,
        imageUrl: messageTable.imageUrl,
        imageKey: messageTable.imageKey,
        content: messageTable.content,
        createdAt: messageTable.createdAt,
      })
      .from(messageTable)
      .innerJoin(conversationTable, eq(messageTable.conversationId, conversationTable.id))
      .leftJoin(characterTable, eq(conversationTable.characterId, characterTable.id))
      .where(
        and(
          eq(messageTable.userId, userId),
          eq(conversationTable.userId, userId),
          sql`${messageTable.imageUrl} IS NOT NULL`,
        ),
      )
      .orderBy(desc(messageTable.createdAt))
      .limit(200);

    return c.json({
      images: images.map((image) => ({
        ...image,
        characterName: image.characterName ?? "AI",
        characterAvatar: image.characterAvatar ?? null,
      })),
    });
  })

  .get("/image/providers", async (c) => {
    const userEmail = await getUserEmail(c);
    if (!userEmail) return c.json({ error: "unauthorized" }, 401);

    return c.json({
      novita: Boolean(c.env.NOVITA_API_KEY),
      runware: Boolean(c.env.RUNWARE_API_KEY),
    });
  })

  // ── R2画像永続化 ──

  .post("/image/persist", zValidator("json", imagePersistSchema), async (c) => {
    const userEmail = await getUserEmail(c);
    if (!userEmail) {
      return c.json({ error: "unauthorized" }, 401);
    }

    const { imageUrl, messageId } = c.req.valid("json");
    const imageSource = validateAllowedImageUrl(imageUrl, c.env);
    if (!imageSource.ok) {
      return c.json({ error: imageSource.error }, imageSource.status);
    }

    const database = drizzle(c.env.DB);
    const userId = await ensureUser(database, userEmail);

    // Novitaドメイン以外からのfetchを拒否（SSRF防御）
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok || !imageResponse.body) {
      return c.json({ error: "failed to fetch image" }, 502);
    }

    const rawContentType = imageResponse.headers.get("content-type") ?? "";
    const resolved = resolveImageType(rawContentType, imageSource.parsedUrl.pathname);
    if (!resolved) {
      return c.json({ error: "unsupported content type" }, 400);
    }
    const imageBuffer = await imageResponse.arrayBuffer();
    if (imageBuffer.byteLength > MAX_R2_IMAGE_SIZE_BYTES) {
      return c.json({ error: "image too large" }, 413);
    }
    const key = `images/${crypto.randomUUID()}.${resolved.ext}`;

    await c.env.BUCKET.put(key, imageBuffer, {
      httpMetadata: { contentType: resolved.contentType },
    });

    const updateResult = await database
      .update(messageTable)
      .set({ imageKey: key })
      .where(and(eq(messageTable.id, messageId), eq(messageTable.userId, userId)));

    if (getD1Changes(updateResult) === 0) {
      await c.env.BUCKET.delete(key);
      return c.json({ error: "message not found or already updated" }, 404);
    }

    return c.json({ imageKey: key });
  })

  .get("/image/r2/:key{.+}", async (c) => {
    const userEmail = await getImageViewerEmail(c);
    if (!userEmail) return c.json({ error: "unauthorized" }, 401);
    const key = c.req.param("key");

    if (!R2_KEY_PATTERN.test(key)) {
      return c.json({ error: "invalid key format" }, 400);
    }

    // IDOR 防止: 認証だけでなく、このキーが本人の所有物であることを確認する。
    // 非所有は存在を隠すため 404（403 だと他人のキーの存在を漏らす）。
    const ownershipDb = drizzle(c.env.DB);
    const owned = await isImageKeyOwnedByUser(ownershipDb, key, userEmail);
    if (!owned) {
      return c.json({ error: "not found" }, 404);
    }

    const object = await c.env.BUCKET.get(key);

    if (!object) {
      return c.json({ error: "not found" }, 404);
    }

    return new Response(object.body, {
      headers: {
        "Content-Type": object.httpMetadata?.contentType ?? "image/png",
        "Cache-Control": "private, no-store",
      },
    });
  });
