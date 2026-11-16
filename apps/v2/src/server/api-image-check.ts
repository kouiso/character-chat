// GET /api/admin/image-check — 持ち主の会話の中の画像全件を 1 件ずつ検査して返す。
// 鍵が指す R2 オブジェクトの実在だけを見る（head のみ）。書き換えはしない。
import { and, asc, count, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";

import type { SelectedFields } from "drizzle-orm/sqlite-core";

import { createDb, messageTable, v2ConversationTable, v2MessageTable } from "@v2/db";

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

export const handleImageCheck = async (request: Request): Promise<Response> => {
  if (request.method !== "GET") return json({ code: "method_not_allowed" }, 405);
  const parsed = querySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams.entries()),
  );
  if (!parsed.success) return json({ code: "bad_request" }, 400);
  const { cursor } = parsed.data;
  const limit = parsed.data.limit ?? DEFAULT_LIMIT;

  const { env } = await getPlatform();
  const checkEnv = env as { DB: D1Database; BUCKET: Pick<R2Bucket, "head"> };
  // 対象: local の会話に属し、v2・旧どちらかの image_key が在る発言全部（眠っている枝も）。
  const targetFilter = and(
    eq(v2ConversationTable.userId, LOCAL_USER_ID),
    sql`coalesce(${v2MessageTable.imageKey}, ${messageTable.imageKey}) is not null`,
  );
  const db = createDb(checkEnv.DB);
  // SELECT 句だけを変えて、同じ FROM・JOIN・対象条件で回す。
  const fromTarget = <TSelection extends SelectedFields>(selection: TSelection) =>
    db
      .select(selection)
      .from(v2MessageTable)
      .innerJoin(v2ConversationTable, eq(v2ConversationTable.id, v2MessageTable.conversationId))
      .leftJoin(messageTable, eq(messageTable.id, v2MessageTable.id));
  try {
    const [total] = await fromTarget({ n: count() }).where(targetFilter);
    const [created] = await fromTarget({ n: count() }).where(
      and(
        targetFilter,
        sql`${messageTable.id} is null`,
        sql`${v2MessageTable.imageKey} is not null`,
      ),
    );
    const rows = await fromTarget({
      messageId: v2MessageTable.id,
      conversationId: v2MessageTable.conversationId,
      key: sql<string>`coalesce(${v2MessageTable.imageKey}, ${messageTable.imageKey})`,
    })
      .where(and(targetFilter, cursor ? gt(v2MessageTable.id, cursor) : undefined))
      .orderBy(asc(v2MessageTable.id))
      .limit(limit + 1);

    const page = rows.slice(0, limit);
    const items: ImageCheckItem[] = [];
    let currentId = "";
    try {
      for (const row of page) {
        currentId = row.messageId;
        let status: ImageCheckStatus;
        if (!R2_KEY_PATTERN.test(row.key)) {
          status = "bad_key";
        } else {
          const head = await checkEnv.BUCKET.head(row.key);
          status = !head ? "missing" : head.size <= 1 ? "empty" : "ok";
        }
        items.push({ messageId: row.messageId, conversationId: row.conversationId, status });
      }
    } catch {
      return json({ code: "storage_failed", id: currentId }, 502);
    }

    return json({
      total: total.n,
      createdInV2: created.n,
      items,
      nextCursor: rows.length > limit ? (page.at(-1)?.messageId ?? null) : null,
    });
  } catch {
    return json({ code: "db_failed" }, 500);
  }
};
