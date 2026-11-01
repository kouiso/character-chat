import { waitUntil } from "cloudflare:workers";

type Activity = {
  recipientId: string;
  characterId: string;
  conversationId: string;
  requestId: string;
};

const record = async (
  env: Pick<Cloudflare.Env, "PROACTIVE_RECIPIENTS">,
  activity: Activity,
): Promise<void> => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      JSON.stringify([activity.characterId, activity.conversationId, activity.requestId]),
    ),
  );
  const activityId = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  for (let attempt = 0; attempt < 3; attempt++) {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.resolve().then(() =>
          env.PROACTIVE_RECIPIENTS.getByName(activity.recipientId).recordActivity(
            activity.characterId,
            activityId,
          ),
        ),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error("Activity recording timed out")), 5_000);
        }),
      ]);
      return;
    } catch {
      // 応答を失ったRPCも同じIDで再送し、静穏時間を再接続のたびに延長しない。
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error("Activity recording unavailable");
};

export const deferProactiveActivity = (
  env: Pick<Cloudflare.Env, "PROACTIVE_RECIPIENTS">,
  activity: Activity,
): void => {
  // 任意の通知機能の障害で、既に永続受付した会話のSSEを503や無期限待機にしない。
  const background = record(env, activity).catch(() => {
    console.warn("proactive_activity_recording_failed");
  });
  try {
    waitUntil(background);
  } catch {
    console.warn("proactive_activity_background_unavailable");
  }
};
