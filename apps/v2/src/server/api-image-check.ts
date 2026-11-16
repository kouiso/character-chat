// GET /api/admin/image-check — 持ち主の会話の中の画像全件を 1 件ずつ検査して返す。
// 鍵が指す R2 オブジェクトの実在だけを見る（head のみ）。書き換えはしない。
import { z } from "zod";

import { LOCAL_USER_ID } from "./identity";
import { R2_KEY_PATTERN } from "./media";
import { getPlatform } from "./platform";

const querySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(25).optional(),
});

const DEFAULT_LIMIT = 10;

export type ImageCheckStatus = "ok" | "bad_key" | "missing" | "empty";

export type ImageCheckItem = {
  messageId: string;
  conversationId: string;
  status: ImageCheckStatus;
};

const json = (body: unknown, status = 200): Response => Response.json(body, { status });

const classifyImageKey = async (
  env: { BUCKET: Pick<R2Bucket, "head"> },
  key: string,
): Promise<ImageCheckStatus> => {
  if (!R2_KEY_PATTERN.test(key)) return "bad_key";
  const head = await env.BUCKET.head(key);
  if (!head) return "missing";
  return head.size <= 1 ? "empty" : "ok";
};

// 1 件の読みに失敗したら「その id で 502」を返せるよう、失敗した行の id を返す。
const checkImageItems = async (
  env: { BUCKET: Pick<R2Bucket, "head"> },
  rows: { messageId: string; conversationId: string; key: string }[],
): Promise<{ ok: true; items: ImageCheckItem[] } | { ok: false; failedId: string }> => {
  const items: ImageCheckItem[] = [];
  for (const row of rows) {
    try {
      const status = await classifyImageKey(env, row.key);
      items.push({ messageId: row.messageId, conversationId: row.conversationId, status });
    } catch {
      return { ok: false, failedId: row.messageId };
    }
  }
  return { ok: true, items };
};

// 対象: local の会話に属し、v2・旧どちらかの image_key が在る発言全部（眠っている枝も）。
// apps/v2 から drizzle を直接 import すると @v2/db 側と別インスタンスの型が衝突するので生 D1 で読む。
const TARGET_FROM = `FROM v2_message m
  INNER JOIN v2_conversation c ON c.id = m.conversation_id
  LEFT JOIN message lm ON lm.id = m.id
  WHERE c.user_id = ? AND coalesce(m.image_key, lm.image_key) IS NOT NULL`;

const countTargets = (env: { DB: D1Database }, extra = "") =>
  env.DB.prepare(`SELECT count(*) AS n ${TARGET_FROM} ${extra}`)
    .bind(LOCAL_USER_ID)
    .first<{ n: number }>();

const listImagePage = (env: { DB: D1Database }, cursor: string | undefined, limit: number) =>
  env.DB.prepare(
    `SELECT m.id AS messageId, m.conversation_id AS conversationId,
            coalesce(m.image_key, lm.image_key) AS key
     ${TARGET_FROM} ${cursor ? "AND m.id > ?" : ""}
     ORDER BY m.id ASC LIMIT ?`,
  )
    .bind(LOCAL_USER_ID, ...(cursor ? [cursor] : []), limit + 1)
    .all<{ messageId: string; conversationId: string; key: string }>();

const runImageCheck = async (
  env: { DB: D1Database; BUCKET: Pick<R2Bucket, "head"> },
  cursor: string | undefined,
  limit: number,
): Promise<Response> => {
  try {
    const total = await countTargets(env);
    const created = await countTargets(env, "AND lm.id IS NULL AND m.image_key IS NOT NULL");
    const { results: rows } = await listImagePage(env, cursor, limit);

    const page = rows.slice(0, limit);
    const checked = await checkImageItems(env, page);
    if (!checked.ok) return json({ code: "storage_failed", id: checked.failedId }, 502);

    return json({
      total: total?.n ?? 0,
      createdInV2: created?.n ?? 0,
      items: checked.items,
      nextCursor: rows.length > limit ? (page.at(-1)?.messageId ?? null) : null,
    });
  } catch {
    return json({ code: "db_failed" }, 500);
  }
};

export const handleImageCheck = async (request: Request): Promise<Response> => {
  if (request.method !== "GET") return json({ code: "method_not_allowed" }, 405);
  const parsed = querySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams.entries()),
  );
  if (!parsed.success) return json({ code: "bad_request" }, 400);

  const { env } = await getPlatform();
  return runImageCheck(
    env as { DB: D1Database; BUCKET: Pick<R2Bucket, "head"> },
    parsed.data.cursor,
    parsed.data.limit ?? DEFAULT_LIMIT,
  );
};
