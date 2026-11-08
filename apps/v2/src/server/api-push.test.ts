// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { openLocalD1, type LocalD1 } from "../../../../packages/db/src/test/local-d1";

import { handlePushSubscriptions, handlePushVapidKey } from "./api-push";

const platform = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
vi.mock("./platform", () => ({ getPlatform: async () => platform }));

describe("push API", () => {
  let local: LocalD1;

  beforeEach(async () => {
    local = await openLocalD1();
    platform.env = { DB: local.d1, VAPID_PUBLIC_KEY: "pub-key-test" };
  });
  afterEach(() => local.dispose());

  it("VAPID 公開鍵を返す", async () => {
    const response = await handlePushVapidKey();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ publicKey: "pub-key-test" });
  });

  it("未設定なら publicKey は null", async () => {
    delete platform.env.VAPID_PUBLIC_KEY;
    const response = await handlePushVapidKey();
    expect(await response.json()).toEqual({ publicKey: null });
  });

  it("POST は購読を保存し DELETE で消せる", async () => {
    const endpoint = `https://push.example.test/${crypto.randomUUID()}`;
    const post = await handlePushSubscriptions(
      new Request("https://app.test/api/push/subscriptions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          endpoint,
          keys: { p256dh: "k1", auth: "a1" },
        }),
      }),
    );
    expect(post.status).toBe(200);

    const { results } = await local.d1
      .prepare("SELECT endpoint,p256dh,auth FROM v2_push_subscription WHERE endpoint = ?")
      .bind(endpoint)
      .all<{ endpoint: string; p256dh: string; auth: string }>();
    expect(results).toEqual([{ endpoint, p256dh: "k1", auth: "a1" }]);

    const del = await handlePushSubscriptions(
      new Request("https://app.test/api/push/subscriptions", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ endpoint }),
      }),
    );
    expect(del.status).toBe(200);
    const { results: after } = await local.d1
      .prepare("SELECT endpoint FROM v2_push_subscription WHERE endpoint = ?")
      .bind(endpoint)
      .all<{ endpoint: string }>();
    expect(after).toHaveLength(0);
  });

  it("鍵が欠けた POST は 400", async () => {
    const response = await handlePushSubscriptions(
      new Request("https://app.test/api/push/subscriptions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ endpoint: "https://push.example.test/x" }),
      }),
    );
    expect(response.status).toBe(400);
  });
});
