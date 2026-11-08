// @vitest-environment node
import { createDb, savePushSubscription } from "@v2/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { openLocalD1, type LocalD1 } from "../../../../packages/db/src/test/local-d1";

import { sendProactivePush } from "./push";

// テスト内で本物の VAPID 鍵ペアを作る（送信パスの暗号化を素通しで確かめる）。
const generateVapid = async () => {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const pub = new Uint8Array(65);
  pub[0] = 4;
  pub.set(Buffer.from(jwk.x!, "base64url"), 1);
  pub.set(Buffer.from(jwk.y!, "base64url"), 33);
  return {
    VAPID_PUBLIC_KEY: Buffer.from(pub).toString("base64url"),
    VAPID_PRIVATE_KEY: jwk.d!,
    VAPID_SUBJECT: "mailto:test@example.test",
  };
};

// PushManager が配る p256dh と同じ形式（非圧縮 P-256 点・16バイト auth）を作る。
const generateSubscriptionKeys = async () => {
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ]);
  const raw = await crypto.subtle.exportKey("raw", pair.publicKey);
  return {
    p256dh: Buffer.from(raw).toString("base64url"),
    auth: Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64url"),
  };
};

const PAYLOAD = { title: "試し役", body: "おはよう", url: "/chat/c1?conversationId=x", tag: "x" };

describe("sendProactivePush", () => {
  let local: LocalD1;
  // local D1 は共有 store。過去 run の購読を拾わんようテストごとにユーザーを替える。
  let userId: string;

  beforeEach(async () => {
    local = await openLocalD1();
    userId = `push-test-${crypto.randomUUID()}`;
  });
  afterEach(() => {
    void local.dispose();
    vi.unstubAllGlobals();
  });

  it("VAPID 未設定なら何も送らん", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const result = await sendProactivePush(
      createDb(local.d1),
      {},
      {
        userId,
        payload: PAYLOAD,
      },
    );
    expect(result).toEqual({ sent: 0, dropped: 0 });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("購読へ POST し、受理されれば sent を数える", async () => {
    const db = createDb(local.d1);
    const endpoint = `https://push.example.test/${crypto.randomUUID()}`;
    await savePushSubscription(db, {
      userId,
      endpoint,
      ...(await generateSubscriptionKeys()),
      now: Date.now(),
    });

    const seen: { url: string; auth: string | null }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        seen.push({
          url,
          auth: (init?.headers as Record<string, string>)?.authorization ?? null,
        });
        return new Response(null, { status: 201 });
      }),
    );

    const result = await sendProactivePush(db, await generateVapid(), {
      userId,
      payload: PAYLOAD,
    });
    expect(result.sent).toBe(1);
    expect(seen[0].url).toBe(endpoint);
    expect(seen[0].auth).toContain("vapid t=");
  });

  it("410 が返った購読は DB から消す", async () => {
    const db = createDb(local.d1);
    const endpoint = `https://push.example.test/${crypto.randomUUID()}`;
    await savePushSubscription(db, {
      userId,
      endpoint,
      ...(await generateSubscriptionKeys()),
      now: Date.now(),
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 410 })),
    );

    const result = await sendProactivePush(db, await generateVapid(), {
      userId,
      payload: PAYLOAD,
    });
    expect(result.dropped).toBe(1);

    const { results } = await local.d1
      .prepare("SELECT endpoint FROM v2_push_subscription WHERE endpoint = ?")
      .bind(endpoint)
      .all<{ endpoint: string }>();
    expect(results).toHaveLength(0);
  });
});
