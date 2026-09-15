import { zValidator } from "@hono/zod-validator";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { z } from "zod/v4";

import { imageReviewTable, reviewImageRatingTable } from "../../../src/schema";
import { getUserEmail, type Bindings } from "../lib/route-context";

const adminRatingSchema = z.object({
  r2Key: z.string().min(1).max(500),
  verdict: z.enum(["nuketa", "microm", "dame"]),
  note: z.string().max(2_000).optional(),
});

const adminDedupDeleteSchema = z.object({
  reviewKeys: z.array(z.string().min(1).max(500)).min(1),
});

// list etag が空の場合 head() で補完し、プレーン MD5 のみ返す (U2)
async function resolveR2Etag(
  bucket: R2Bucket,
  key: string,
  raw: string | undefined,
): Promise<string | undefined> {
  if (raw && !raw.includes("-")) return raw;
  if (raw !== undefined) return undefined; // multipart, 除外
  const head = await bucket.head(key);
  const headEtag = head?.httpEtag?.replace(/^"|"$/g, "");
  return headEtag && !headEtag.includes("-") ? headEtag : undefined;
}

// sub/ 全件走査: etag → key マップを構築
async function buildSubEtagMap(bucket: R2Bucket): Promise<Map<string, string>> {
  const etagMap = new Map<string, string>();
  let cursor: string | undefined;
  do {
    const list = await bucket.list({ prefix: "sub/", limit: 1000, cursor });
    for (const obj of list.objects) {
      const etag = await resolveR2Etag(bucket, obj.key, obj.etag?.replace(/^"|"$/g, ""));
      if (etag) etagMap.set(etag, obj.key);
    }
    cursor = list.truncated ? list.cursor : undefined;
  } while (cursor);
  return etagMap;
}

export const adminRoutes = new Hono<{ Bindings: Bindings }>()
  // Admin: R2 review/ 画像一覧 (カーソルページング)
  .get("/review-images", async (c) => {
    const userEmail = await getUserEmail(c);
    if (!userEmail) return c.json({ error: "unauthorized" }, 401);
    const cursor = c.req.query("cursor") ?? undefined;
    const result = await c.env.BUCKET.list({ prefix: "review/", limit: 1000, cursor });
    const items = result.objects.map((o) => ({ key: o.key, size: o.size }));
    const nextCursor: string | null = result.truncated ? (result.cursor ?? null) : null;
    return c.json({ items, cursor: nextCursor });
  })
  // Admin: review/ キーの画像バイト配信 (path-traversal ガード済み)
  .get("/review/:key{.+}", async (c) => {
    const userEmail = await getUserEmail(c);
    if (!userEmail) return c.json({ error: "unauthorized" }, 401);
    const key = c.req.param("key");
    if (!key.startsWith("review/") || key.includes("..")) {
      return c.json({ error: "bad_key" }, 400);
    }
    const object = await c.env.BUCKET.get(key);
    if (!object) return c.json({ error: "not_found" }, 404);
    return new Response(object.body, {
      headers: { "Content-Type": object.httpMetadata?.contentType ?? "image/png" },
    });
  })
  // Admin: 抜け判定記録一覧
  .get("/ratings", async (c) => {
    const userEmail = await getUserEmail(c);
    if (!userEmail) return c.json({ error: "unauthorized" }, 401);
    const database = drizzle(c.env.DB);
    const rows = await database.select().from(reviewImageRatingTable);
    return c.json(
      rows.map((r) => ({
        r2Key: r.r2Key,
        verdict: r.verdict,
        note: r.note,
        updatedAt: r.updatedAt,
      })),
    );
  })
  // Admin: 抜け判定を upsert
  .put("/rating", zValidator("json", adminRatingSchema), async (c) => {
    const userEmail = await getUserEmail(c);
    if (!userEmail) return c.json({ error: "unauthorized" }, 401);
    const body = c.req.valid("json");
    const database = drizzle(c.env.DB);
    await database
      .insert(reviewImageRatingTable)
      .values({
        r2Key: body.r2Key,
        verdict: body.verdict,
        note: body.note ?? "",
        raterEmail: userEmail,
        updatedAt: Date.now(),
      })
      .onConflictDoUpdate({
        target: reviewImageRatingTable.r2Key,
        set: {
          verdict: sql`excluded.verdict`,
          note: sql`excluded.note`,
          raterEmail: sql`excluded.rater_email`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
    return c.json({ ok: true });
  })
  // Admin: sub/ と etag 完全一致する review/ キーを重複候補として返す
  .get("/dedup-candidates", async (c) => {
    const userEmail = await getUserEmail(c);
    if (!userEmail) return c.json({ error: "unauthorized" }, 401);

    const subEtagMap = await buildSubEtagMap(c.env.BUCKET);

    // review/ 全件走査: sub と etag 一致するものを候補に
    const candidates: { reviewKey: string; subKey: string; size: number }[] = [];
    let reviewCursor: string | undefined;
    do {
      const list = await c.env.BUCKET.list({
        prefix: "review/",
        limit: 1000,
        cursor: reviewCursor,
      });
      for (const obj of list.objects) {
        const etag = obj.etag?.replace(/^"|"$/g, "");
        if (etag && !etag.includes("-") && subEtagMap.has(etag)) {
          candidates.push({ reviewKey: obj.key, subKey: subEtagMap.get(etag)!, size: obj.size });
        }
      }
      reviewCursor = list.truncated ? list.cursor : undefined;
    } while (reviewCursor);

    const note =
      candidates.length === 0
        ? "候補0件 — sub/ 採用が再エンコードを挟む場合は MD5 不一致になり候補が出ません (U1)"
        : undefined;
    return c.json({ candidates, ...(note ? { note } : {}) });
  })
  // Admin: review/ キーを削除 (削除直前 etag 再検証あり・sub/ 等は絶対弾く)
  // sub/ 走査は buildSubEtagMap で1回のみ実行し R2 list API 呼び出しを最小化する
  .post("/dedup-delete", zValidator("json", adminDedupDeleteSchema), async (c) => {
    const userEmail = await getUserEmail(c);
    if (!userEmail) return c.json({ error: "unauthorized" }, 401);
    const body = c.req.valid("json");
    const database = drizzle(c.env.DB);
    let deletedCount = 0;
    let freedBytes = 0;

    // 有効な review/ キーの head を並列取得
    const validKeys = body.reviewKeys.filter((k) => k.startsWith("review/") && !k.includes(".."));
    const headResults = await Promise.all(
      validKeys.map(async (key) => ({ key, head: await c.env.BUCKET.head(key) })),
    );

    // etag → { key, size } マップを構築（multipart は除外）
    const reviewEtagMap = new Map<string, { key: string; size: number }>();
    for (const { key, head } of headResults) {
      if (!head) continue;
      const etag = head.httpEtag?.replace(/^"|"$/g, "");
      if (!etag || etag.includes("-")) continue;
      reviewEtagMap.set(etag, { key, size: head.size ?? 0 });
    }
    if (reviewEtagMap.size === 0) return c.json({ deletedCount, freedBytes });

    // sub/ を1回だけ走査して一致する etag を特定
    const subEtagMap = await buildSubEtagMap(c.env.BUCKET);

    for (const [etag, { key, size }] of reviewEtagMap) {
      const matchedSubKey = subEtagMap.get(etag);
      if (!matchedSubKey) continue;

      // 判定レコードを sub_key 側に付け替え
      await database
        .insert(reviewImageRatingTable)
        .values({
          r2Key: matchedSubKey,
          verdict: "nuketa",
          note: `(review/ から移行: ${key})`,
          raterEmail: userEmail,
          updatedAt: Date.now(),
        })
        .onConflictDoUpdate({
          target: reviewImageRatingTable.r2Key,
          set: {
            note: sql`excluded.note`,
            updatedAt: sql`excluded.updated_at`,
          },
        });

      // 審査レコードも同一バイトの sub/ 側へ付け替える。付け替えずに消すと
      // image_review.r2_key が実体の無いキーを指す（PR #928 で潰した状態に戻る）。
      await database
        .update(imageReviewTable)
        .set({ r2Key: matchedSubKey })
        .where(eq(imageReviewTable.r2Key, key));

      await c.env.BUCKET.delete(key);
      deletedCount++;
      freedBytes += size;
    }

    return c.json({ deletedCount, freedBytes });
  });
