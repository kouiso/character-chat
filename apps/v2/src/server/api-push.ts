import { createDb, deletePushSubscription, savePushSubscription } from "@v2/db";
import { z } from "zod";

import { LOCAL_USER_ID } from "./identity";
import { getPlatform } from "./platform";

const SubscriptionBody = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({
    p256dh: z.string().min(1).max(512),
    auth: z.string().min(1).max(512),
  }),
});

const UnsubscribeBody = z.object({
  endpoint: z.string().url().max(2048),
});

// PushManager が subscribe に使う公開鍵。未設定なら null で「この環境では push 無し」を返す。
export const handlePushVapidKey = async (): Promise<Response> => {
  const { env } = await getPlatform();
  const publicKey = env.VAPID_PUBLIC_KEY ?? null;
  return Response.json({ publicKey });
};

export const handlePushSubscriptions = async (request: Request): Promise<Response> => {
  const { env } = await getPlatform();
  const db = createDb(env.DB);

  if (request.method === "POST") {
    const parsed = SubscriptionBody.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return Response.json({ message: "購読情報が不正です。" }, { status: 400 });
    }
    await savePushSubscription(db, {
      userId: LOCAL_USER_ID,
      endpoint: parsed.data.endpoint,
      p256dh: parsed.data.keys.p256dh,
      auth: parsed.data.keys.auth,
      now: Date.now(),
    });
    return Response.json({ ok: true });
  }

  if (request.method === "DELETE") {
    const parsed = UnsubscribeBody.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return Response.json({ message: "endpoint が不正です。" }, { status: 400 });
    }
    await deletePushSubscription(db, parsed.data.endpoint);
    return Response.json({ ok: true });
  }

  return Response.json({ message: "method not allowed" }, { status: 405 });
};
