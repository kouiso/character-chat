import { buildPushPayload } from "@block65/webcrypto-web-push";
import { deletePushSubscription, listPushSubscriptions } from "@v2/db";

import type { V2Db } from "@v2/db";

export type PushVapidConfig = {
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
};

export type ProactivePushPayload = {
  title: string;
  body: string;
  url: string;
  tag: string;
};

export const vapidConfigured = (env: PushVapidConfig): boolean =>
  Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);

// 着信に失敗した購読（404/410）は端末側で消えているのでDBからも落とす。
const GONE_STATUSES = new Set([404, 410]);

export const sendProactivePush = async (
  db: V2Db,
  env: PushVapidConfig,
  input: { userId: string; payload: ProactivePushPayload },
): Promise<{ sent: number; dropped: number }> => {
  if (!vapidConfigured(env)) return { sent: 0, dropped: 0 };

  const subscriptions = await listPushSubscriptions(db, input.userId);
  const vapid = {
    subject: env.VAPID_SUBJECT ?? "mailto:noreply@localhost",
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
  };

  let sent = 0;
  let dropped = 0;
  for (const row of subscriptions) {
    const subscription = {
      endpoint: row.endpoint,
      expirationTime: null,
      keys: { auth: row.auth, p256dh: row.p256dh },
    };
    const request = await buildPushPayload(
      { data: input.payload, options: { ttl: 60 * 60 * 24 } },
      subscription,
      vapid,
    );
    const response = await fetch(row.endpoint, {
      method: request.method,
      headers: request.headers as HeadersInit,
      body: request.body as BodyInit,
    }).catch(() => null);
    if (response?.ok) {
      sent += 1;
      continue;
    }
    if (response && GONE_STATUSES.has(response.status)) {
      await deletePushSubscription(db, row.endpoint);
      dropped += 1;
      continue;
    }
    dropped += 1;
  }
  return { sent, dropped };
};
