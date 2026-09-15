import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";

import { characterTable } from "../../../src/schema";
import {
  getAvatarObject,
  getBundledAvatarResponse,
  getImageViewerEmail,
  getUserEmail,
  isImageKeyOwnedByUser,
  isUserAvatarKey,
  resolveAvatarMime,
  type Bindings,
} from "../lib/route-context";

// プライベートアバターの所有権は character.avatar との一致で見るが、そのカラムは
// 本人が任意の文字列を書ける。他人のアバター名を入れられると、同じ平らな名前空間内で
// 画像が読めてしまう。IDOR 対策として、書き込み時にユーザー別プレフィックスを強制し、
// 読み取り側も同じプレフィックスか、既存の `sub/` 形式・素のファイル名（旧 key）のみ
// 許可する。sub/ 形式の所有権は character_sub_image テーブルで判定する。
const isPrivateAvatarKey = (key: string, userEmail: string): boolean =>
  !key.includes("/") || key.startsWith("sub/") || isUserAvatarKey(key, userEmail);

export const avatarRoutes = new Hono<{ Bindings: Bindings }>()
  // アップロードしたアバター画像を R2 に保存する。フロントは data URL を JSON で送る。
  .post("/avatar/upload", async (c) => {
    const userEmail = await getUserEmail(c);
    if (!userEmail) return c.json({ error: "unauthorized" }, 401);

    const body: { data?: string; mimeType?: string } = await c.req.json().catch(() => ({}));
    const VALID_MIME = ["image/jpeg", "image/png", "image/webp"] as const;
    if (
      typeof body.data !== "string" ||
      !body.mimeType ||
      !(VALID_MIME as readonly string[]).includes(body.mimeType)
    ) {
      return c.json({ error: "invalid_input" }, 400);
    }

    // data URL プレフィックスを除去してバイト列に変換
    const base64 = body.data.replace(/^data:[^;]+;base64,/, "");
    let bytes: Uint8Array;
    try {
      const binaryStr = atob(base64);
      bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }
    } catch {
      return c.json({ error: "invalid_base64" }, 400);
    }

    // 5 MB 上限
    if (bytes.length > 5 * 1024 * 1024) {
      return c.json({ error: "file_too_large" }, 400);
    }

    const extMap: Record<string, string> = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
    };
    const ext = extMap[body.mimeType] ?? "jpg";
    const avatarKey = `${userEmail}/${crypto.randomUUID()}.${ext}`;

    await c.env.BUCKET.put(`avatars/${avatarKey}`, bytes, {
      httpMetadata: { contentType: body.mimeType },
    });

    return c.json({ avatarKey });
  })

  // アバター画像を配信するエンドポイント。公式キャラは認証不要、プライベートは所有者のみ。
  .get("/avatar/:key{.+}", async (c) => {
    const key = c.req.param("key");
    if (key.includes("..") || key.startsWith("/") || key.endsWith("/") || key.includes("\0")) {
      return c.json({ error: "invalid key format" }, 400);
    }

    const database = drizzle(c.env.DB);

    // 公式キャラのメインアバターは認証不要で公開配信（既存ロジック）
    const officialByAvatar = await database
      .select({ id: characterTable.id })
      .from(characterTable)
      .where(and(eq(characterTable.isOfficial, true), eq(characterTable.avatar, key)))
      .limit(1);

    // sub/ キーの場合は公式キャラの sub_avatars にも含まれるか確認
    let isOfficialKey = officialByAvatar.length > 0;
    if (!isOfficialKey && key.startsWith("sub/")) {
      const charId = key.split("/")[1];
      if (charId) {
        const officialSub = await database
          .select({ id: characterTable.id, subAvatars: characterTable.subAvatars })
          .from(characterTable)
          .where(and(eq(characterTable.id, charId), eq(characterTable.isOfficial, true)))
          .limit(1);
        if (officialSub.length > 0) {
          isOfficialKey = (officialSub[0].subAvatars ?? []).includes(key);
        }
      }
    }

    if (isOfficialKey) {
      const object = await getAvatarObject(c.env.BUCKET, key, "root");
      if (!object) {
        const bundled = await getBundledAvatarResponse(c.env, c.req.url, key);
        if (!bundled) return c.json({ error: "not_found" }, 404);
        return new Response(bundled.body, {
          headers: {
            "Content-Type": bundled.headers.get("Content-Type") ?? resolveAvatarMime(key),
            "Cache-Control": "public, max-age=86400",
          },
        });
      }
      return new Response(object.body, {
        headers: {
          "Content-Type": object.httpMetadata?.contentType ?? resolveAvatarMime(key),
          "Cache-Control": "public, max-age=86400",
        },
      });
    }

    // プライベートアバター: 認証必須（<img> サブリクエストのため Basic セッションも許可）
    const userEmail = await getImageViewerEmail(c);
    if (!userEmail) return c.json({ error: "unauthorized" }, 401);

    if (!isPrivateAvatarKey(key, userEmail)) return c.json({ error: "not_found" }, 404);

    // avatar カラム一致による所有権確認
    const ownedByAvatar = await database
      .select({ id: characterTable.id })
      .from(characterTable)
      .where(and(eq(characterTable.userId, userEmail), eq(characterTable.avatar, key)))
      .limit(1);

    let authorized = ownedByAvatar.length > 0;

    // sub/ キーの所有権は character_sub_image テーブル (r2_key → character_id) で判定する。
    // キーのパスセグメント (`sub/<seg>/...` の <seg>) は character.id と一致しない
    // フォルダ名にすぎず、それを char_id とみなすと所有者でも 404 になる
    // (本番 59 件中 47 件でセグメント≠character_id)。/api/image/r2 と同じ
    // isImageKeyOwnedByUser で正しく突合する。
    if (!authorized && key.startsWith("sub/")) {
      authorized = await isImageKeyOwnedByUser(database, key, userEmail);
    }

    if (!authorized) return c.json({ error: "not_found" }, 404);

    const object = await getAvatarObject(c.env.BUCKET, key, "avatars");
    if (!object) {
      const bundled = await getBundledAvatarResponse(c.env, c.req.url, key);
      if (!bundled) return c.json({ error: "not_found" }, 404);
      return new Response(bundled.body, {
        headers: {
          "Content-Type": bundled.headers.get("Content-Type") ?? resolveAvatarMime(key),
          "Cache-Control": "private, max-age=86400, must-revalidate",
        },
      });
    }
    return new Response(object.body, {
      headers: {
        "Content-Type": object.httpMetadata?.contentType ?? resolveAvatarMime(key),
        "Cache-Control": "private, max-age=86400, must-revalidate",
      },
    });
  });
