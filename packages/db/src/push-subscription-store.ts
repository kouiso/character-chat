import { eq } from "drizzle-orm";

import { v2PushSubscriptionTable } from "./v2-schema";

import type { V2Db } from "./client";

export type PushSubscriptionRow = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

export const savePushSubscription = async (
  db: V2Db,
  input: { userId: string; endpoint: string; p256dh: string; auth: string; now: number },
): Promise<void> => {
  // 同じ endpoint の再購読は上書きして最新の鍵に揃える。
  await db
    .insert(v2PushSubscriptionTable)
    .values({
      id: crypto.randomUUID(),
      userId: input.userId,
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      createdAt: input.now,
    })
    .onConflictDoUpdate({
      target: v2PushSubscriptionTable.endpoint,
      set: {
        userId: input.userId,
        p256dh: input.p256dh,
        auth: input.auth,
        createdAt: input.now,
      },
    });
};

export const listPushSubscriptions = async (
  db: V2Db,
  userId: string,
): Promise<PushSubscriptionRow[]> =>
  db
    .select({
      endpoint: v2PushSubscriptionTable.endpoint,
      p256dh: v2PushSubscriptionTable.p256dh,
      auth: v2PushSubscriptionTable.auth,
    })
    .from(v2PushSubscriptionTable)
    .where(eq(v2PushSubscriptionTable.userId, userId));

export const deletePushSubscription = async (db: V2Db, endpoint: string): Promise<void> => {
  await db.delete(v2PushSubscriptionTable).where(eq(v2PushSubscriptionTable.endpoint, endpoint));
};
