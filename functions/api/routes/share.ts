import { zValidator } from "@hono/zod-validator";
import { and, desc, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { z } from "zod/v4";

import {
  buildSharedPayload,
  isValidShareId,
  parseSharedPayload,
  serializeSharedPayload,
  type SharedPayload,
} from "../../../src/lib/conversation-share";
import {
  characterTable,
  conversationShareTable,
  conversationTable,
  messageTable,
} from "../../../src/schema";
import {
  checkShareBurstLimit,
  DEFAULT_SHARE_TTL_MS,
  ensureUser,
  getUserEmail,
  idSchema,
  SHARED_PAYLOAD_MESSAGE_LIMIT,
  type Bindings,
} from "../lib/route-context";

// ── 会話共有 (read-only snapshot) ─────────────────────────────────────────
// POST /api/share: 認証ユーザーが自分の会話を凍結し shareId を発行する。
// GET  /api/share/:shareId: 認証なしで snapshot を読める（URL 自体がトークン）。
export const shareRoutes = new Hono<{ Bindings: Bindings }>()
  .post(
    "/share",
    zValidator("json", z.object({ conversationId: z.string().min(1).max(128) })),
    async (c) => {
      const userEmail = await getUserEmail(c);
      if (!userEmail) {
        return c.json({ error: "unauthorized" }, 401);
      }

      const { conversationId } = c.req.valid("json");
      const database = drizzle(c.env.DB);
      const userId = await ensureUser(database, userEmail);

      // share の URL 自体がアクセストークンであるため、burst 連打で
      // shareId 推測対象を量産させない目的の burst レート制限を別軸で掛ける。
      // 既存の enforceRateLimit は日次・月次予算ベースで秒オーダーには対応しない。
      const burst = await checkShareBurstLimit(database, userId);
      if (!burst.ok) {
        return c.json({ error: "rate_limited", retryAfterSec: burst.retryAfterSec }, 429, {
          "Retry-After": String(burst.retryAfterSec),
        });
      }

      const ownConversation = await database
        .select({
          id: conversationTable.id,
          title: conversationTable.title,
          characterId: conversationTable.characterId,
          characterName: characterTable.name,
          characterAvatar: characterTable.avatar,
        })
        .from(conversationTable)
        .leftJoin(characterTable, eq(conversationTable.characterId, characterTable.id))
        .where(and(eq(conversationTable.id, conversationId), eq(conversationTable.userId, userId)))
        .limit(1);

      if (ownConversation.length === 0) {
        return c.json({ error: "conversation_not_found" }, 404);
      }

      const conv = ownConversation[0];
      // 共有 payload は D1 TEXT カラムの実質 1MB 上限に収める必要があるため、
      // 直近 500 件 (asc 取得後の最後 500) のみを凍結対象にする。
      // DESC で 500 件取得後に再昇順に並べ直すことで巨大スキャンを避ける。
      const recentDesc = await database
        .select({
          id: messageTable.id,
          role: messageTable.role,
          content: messageTable.content,
          imageUrl: messageTable.imageUrl,
          createdAt: messageTable.createdAt,
        })
        .from(messageTable)
        .where(
          and(eq(messageTable.conversationId, conversationId), eq(messageTable.userId, userId)),
        )
        .orderBy(desc(messageTable.createdAt), desc(sql<number>`rowid`))
        .limit(SHARED_PAYLOAD_MESSAGE_LIMIT);
      const messages = [...recentDesc].reverse();

      const now = Date.now();
      const basePayload = {
        conversationId: conv.id,
        title: conv.title,
        character: {
          id: conv.characterId,
          name: conv.characterName ?? "AI",
          avatar: conv.characterAvatar ?? null,
        },
        messages: messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          imageUrl: m.imageUrl,
          createdAt: m.createdAt,
        })),
        now,
      };

      // バイト上限に収まるよう、新しいメッセージから順に含める件数を減らして再試行する。
      let sharePayload: SharedPayload | null = null;
      let serialized: { ok: true; json: string; bytes: number } | null = null;
      for (let limit = messages.length; limit >= 0; limit -= 1) {
        const candidate = buildSharedPayload({
          ...basePayload,
          messages: messages.slice(-limit),
        });
        const result = serializeSharedPayload(candidate);
        if (result.ok) {
          sharePayload = candidate;
          serialized = result;
          break;
        }
      }
      if (!serialized || !sharePayload) {
        return c.json({ error: "payload_too_large", bytes: 0 }, 413);
      }

      // shareId は URL 自体がトークン化するため、Math.random フォールバック (src/lib/uuid)
      // ではなく Web Crypto の randomUUID を直接呼んでエントロピーを保証する。
      // Cloudflare Workers ランタイムでは crypto.randomUUID は常に利用可能。
      const shareId = crypto.randomUUID();
      const expiresAt = now + DEFAULT_SHARE_TTL_MS;
      await database.insert(conversationShareTable).values({
        id: shareId,
        conversationId: conv.id,
        userId,
        payload: serialized.json,
        createdAt: now,
        expiresAt,
      });

      return c.json({ shareId, createdAt: now, expiresAt });
    },
  )

  .get("/share/:shareId", async (c) => {
    const shareId = c.req.param("shareId");
    if (!isValidShareId(shareId)) {
      return c.json({ error: "not_found" }, 404);
    }

    const database = drizzle(c.env.DB);
    const rows = await database
      .select({
        payload: conversationShareTable.payload,
        createdAt: conversationShareTable.createdAt,
        expiresAt: conversationShareTable.expiresAt,
      })
      .from(conversationShareTable)
      .where(eq(conversationShareTable.id, shareId))
      .limit(1);

    if (rows.length === 0) {
      return c.json({ error: "not_found" }, 404);
    }

    if (rows[0].expiresAt !== null && Date.now() > rows[0].expiresAt) {
      return c.json({ error: "share_expired" }, 410);
    }

    const parsed = parseSharedPayload(rows[0].payload);
    if (!parsed.ok) {
      // payload が壊れている場合は 410 Gone でクライアントに「もう見れない」と伝える。
      return c.json({ error: "payload_corrupt" }, 410);
    }

    return c.json({
      shareId,
      createdAt: rows[0].createdAt,
      expiresAt: rows[0].expiresAt,
      payload: parsed.payload,
    });
  })

  .delete("/share/:shareId", async (c) => {
    const userEmail = await getUserEmail(c);
    if (!userEmail) {
      return c.json({ error: "unauthorized" }, 401);
    }

    const shareId = c.req.param("shareId");
    if (!isValidShareId(shareId) || !idSchema.safeParse(shareId).success) {
      return c.json({ error: "not_found" }, 404);
    }

    const database = drizzle(c.env.DB);
    const userId = await ensureUser(database, userEmail);

    const existing = await database
      .select({ id: conversationShareTable.id })
      .from(conversationShareTable)
      .where(and(eq(conversationShareTable.id, shareId), eq(conversationShareTable.userId, userId)))
      .limit(1);
    if (!existing[0]) return c.json({ error: "not_found" }, 404);

    await database
      .delete(conversationShareTable)
      .where(
        and(eq(conversationShareTable.id, shareId), eq(conversationShareTable.userId, userId)),
      );

    return c.json({ ok: true });
  });
