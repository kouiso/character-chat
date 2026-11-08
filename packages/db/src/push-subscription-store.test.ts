// v2_push_subscription の store をローカル D1（Miniflare）で回す（RIT-108）。
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  deletePushSubscription,
  listPushSubscriptions,
  savePushSubscription,
} from "./push-subscription-store";
import { openLocalD1, type LocalD1 } from "./test/local-d1";

describe("push-subscription-store", () => {
  let local: LocalD1;

  beforeAll(async () => {
    local = await openLocalD1();
  });

  afterAll(async () => {
    await local?.dispose();
  });

  it("保存した購読をユーザー単位で取り出せる", async () => {
    const db = local.db;
    const endpoint = `https://push.example.test/${crypto.randomUUID()}`;
    await savePushSubscription(db, {
      userId: "user-a",
      endpoint,
      p256dh: "key-1",
      auth: "auth-1",
      now: 1_700_000_000_000,
    });

    const rows = await listPushSubscriptions(db, "user-a");
    const found = rows.find((row) => row.endpoint === endpoint);
    expect(found).toEqual({ endpoint, p256dh: "key-1", auth: "auth-1" });
  });

  it("同じ endpoint の再購読は鍵を上書きする", async () => {
    const db = local.db;
    const endpoint = `https://push.example.test/${crypto.randomUUID()}`;
    await savePushSubscription(db, {
      userId: "user-b",
      endpoint,
      p256dh: "key-old",
      auth: "auth-old",
      now: 1,
    });
    await savePushSubscription(db, {
      userId: "user-b",
      endpoint,
      p256dh: "key-new",
      auth: "auth-new",
      now: 2,
    });

    const rows = (await listPushSubscriptions(db, "user-b")).filter(
      (row) => row.endpoint === endpoint,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ endpoint, p256dh: "key-new", auth: "auth-new" });
  });

  it("endpoint 指定で購読を消せる", async () => {
    const db = local.db;
    const endpoint = `https://push.example.test/${crypto.randomUUID()}`;
    await savePushSubscription(db, {
      userId: "user-c",
      endpoint,
      p256dh: "key",
      auth: "auth",
      now: 3,
    });
    await deletePushSubscription(db, endpoint);

    const rows = await listPushSubscriptions(db, "user-c");
    expect(rows.find((row) => row.endpoint === endpoint)).toBeUndefined();
  });
});
