import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";

import { userTable } from "../../../src/schema";
import { verifyBasicAuth } from "../lib/basic-auth";
import {
  APP_AUTH_COOKIE,
  ensureUser,
  fetchAccountDisplayName,
  getUserEmail,
  LOCAL_USER_EMAIL,
  signAppJwt,
  userDisplayNameUpdateSchema,
  type Bindings,
} from "../lib/route-context";
import { sanitizeUserDisplayName } from "../lib/sanitize-injection";

const encodeBasicCredentials = (username: string, password: string): string | null => {
  try {
    return `Basic ${btoa(`${username}:${password}`)}`;
  } catch {
    return null;
  }
};

export const authRoutes = new Hono<{ Bindings: Bindings }>()
  .get("/me", async (c) => {
    const userEmail = await getUserEmail(c);
    if (!userEmail) {
      return c.json({ error: "unauthorized" }, 401);
    }

    const isLocal = userEmail === LOCAL_USER_EMAIL || userEmail === "token-auth@adult-ai-app.local";
    // ユニットテスト等で D1 が未設定の場合も /api/me は認証情報だけ返す。
    // displayName は D1 が有効な時だけ解決し、クライアントは null で未設定を判別する。
    const isD1Like = typeof c.env.DB === "object" && c.env.DB !== null && "prepare" in c.env.DB;
    const response: {
      email: string;
      logoutUrl: null;
      isLocal: boolean;
      displayName?: string | null;
    } = {
      email: userEmail,
      logoutUrl: null,
      isLocal,
    };
    if (isD1Like) {
      const database = drizzle(c.env.DB);
      const userId = await ensureUser(database, userEmail);
      response.displayName = (await fetchAccountDisplayName(database, userId)) ?? null;
    }
    return c.json(response);
  })

  .patch("/me", zValidator("json", userDisplayNameUpdateSchema), async (c) => {
    const userEmail = await getUserEmail(c);
    if (!userEmail) {
      return c.json({ error: "unauthorized" }, 401);
    }

    const { displayName } = c.req.valid("json");
    const sanitized = sanitizeUserDisplayName(displayName);

    const database = drizzle(c.env.DB);
    const userId = await ensureUser(database, userEmail);
    try {
      await database
        .update(userTable)
        .set({ displayName: sanitized.length > 0 ? sanitized : null })
        .where(eq(userTable.id, userId));
    } catch (error) {
      if (String(error).includes("display_name")) {
        return c.json({ error: "display_name column not migrated yet" }, 503);
      }
      throw error;
    }

    return c.json({ displayName: sanitized.length > 0 ? sanitized : null });
  })

  .post("/auth/basic-login", async (c) => {
    const body: Record<string, string | File> = await c.req.parseBody().catch(() => ({}));
    const username = typeof body.username === "string" ? body.username : "";
    const password = typeof body.password === "string" ? body.password : "";
    // btoa は U+00FF を超える文字で throw する。素通しにすると未認証のまま 500 を返せてまい、
    // 5xx ごとに Slack へ飛ぶ通知を匿名で叩ける。この方式で往復でけん資格情報は
    // どのみち一致せんので、他の資格情報エラーと同じ 401 へ落とす。
    const authorization = encodeBasicCredentials(username, password);

    if (!verifyBasicAuth(authorization, c.env)) {
      return c.html(
        '<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><p>Login failed</p><p><a href="/">Back</a></p>',
        401,
        { "Cache-Control": "no-store" },
      );
    }

    const signingKey = c.env.AUTH_SIGNING_KEY?.trim();
    if (!signingKey) {
      return c.text("signing_key_not_configured", 503);
    }

    const token = await signAppJwt(LOCAL_USER_EMAIL, signingKey);
    const maxAge = 90 * 24 * 60 * 60;
    const cookieHeader = `${APP_AUTH_COOKIE}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;

    // JS fetch（モバイルPWA対応）: JSON でトークンを返してlocalStorageに格納させる
    if (c.req.header("Accept")?.includes("application/json")) {
      return c.json({ token, email: LOCAL_USER_EMAIL }, 200, {
        "Set-Cookie": cookieHeader,
        "Cache-Control": "no-store",
      });
    }

    return new Response(null, {
      status: 303,
      headers: {
        Location: "/",
        "Cache-Control": "no-store",
        "Set-Cookie": cookieHeader,
      },
    });
  })

  // Cookie が残っている既存セッションから 90 日有効のアプリ JWT を再発行する。
  .post("/auth/session", async (c) => {
    const userEmail = await getUserEmail(c);
    if (!userEmail) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const signingKey = c.env.AUTH_SIGNING_KEY?.trim();
    if (!signingKey) {
      return c.json({ error: "signing_key_not_configured" }, 503);
    }
    const token = await signAppJwt(userEmail, signingKey);
    const expiresAt = Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60;
    return c.json({ token, expiresAt });
  });
