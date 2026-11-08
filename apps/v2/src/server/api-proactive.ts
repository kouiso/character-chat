import { LOCAL_USER_ID } from "./identity";
import { getPlatform } from "./platform";

import type { ProactiveScheduler } from "./proactive-scheduler";

// API → ユーザーごとのスケジューラ DO。DO 内部で zod 検証するのでここでは形状だけ見る。
const schedulerFor = (env: Cloudflare.Env): DurableObjectStub<ProactiveScheduler> =>
  env.PROACTIVE_SCHEDULERS.getByName(LOCAL_USER_ID);

const doFetch = (env: Cloudflare.Env, path: string, init: RequestInit): Promise<Response> =>
  schedulerFor(env).fetch(new Request(`https://proactive.internal${path}`, init));

export const handleProactiveSettings = async (
  characterId: string,
  request: Request,
): Promise<Response> => {
  const { env } = await getPlatform();
  if (request.method === "GET") {
    return doFetch(env, `/settings?characterId=${encodeURIComponent(characterId)}`, {
      method: "GET",
    });
  }
  const body = await request.json().catch(() => null);
  if (body === null || typeof body !== "object") {
    return Response.json({ message: "JSON形式で送信してください。" }, { status: 400 });
  }
  // クライアントは settings 丸ごとか enabled トグルのみを送れる。
  if ("settings" in body) {
    return doFetch(env, "/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ characterId, settings: body.settings }),
    });
  }
  return doFetch(env, "/enabled", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ characterId, enabled: (body as { enabled?: boolean }).enabled }),
  });
};

// 会話ターンの受付から呼ぶ。失敗しても返信を遅らせんよう waitUntil 側へ投げる想定。
export const recordProactiveActivity = async (characterId: string): Promise<void> => {
  const { env } = await getPlatform();
  await doFetch(env, "/activity", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ characterId }),
  });
};
