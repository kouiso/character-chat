import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { subscribeToPush, unsubscribeFromPush } from "./push";

const jsonResponse = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

const subscription = {
  endpoint: "https://push.example.test/sub-1",
  toJSON: () => ({
    endpoint: "https://push.example.test/sub-1",
    keys: { p256dh: "key", auth: "auth" },
  }),
  unsubscribe: vi.fn(async () => true),
};

const registration = (existing: unknown) => ({
  pushManager: {
    getSubscription: vi.fn(async () => existing),
    subscribe: vi.fn(async () => subscription),
  },
});

const installBrowser = (opts: {
  permission?: string;
  requestPermission?: () => Promise<string>;
  existingSubscription?: unknown;
  getRegistration?: unknown;
}) => {
  Object.defineProperty(globalThis.navigator, "serviceWorker", {
    value: {
      register: vi.fn(async () => registration(opts.existingSubscription ?? null)),
      getRegistration: vi.fn(async () => opts.getRegistration ?? null),
    },
    configurable: true,
  });
  Object.defineProperty(globalThis, "PushManager", {
    value: class {},
    configurable: true,
  });
  Object.defineProperty(globalThis, "Notification", {
    value: {
      permission: opts.permission ?? "granted",
      requestPermission: opts.requestPermission ?? (async () => "granted"),
    },
    configurable: true,
  });
};

describe("subscribeToPush", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        url === "/api/push/vapid-key"
          ? jsonResponse({
              publicKey:
                "BHlCOMkST-7w3VDvwjNMWEcxFXWcf_6plP4H--WcgCLuGt8LgNjbbCAL3tdCKfD-t_SB-WjFqP513fLnD0I2MM8",
            })
          : jsonResponse({ ok: true }),
      ),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (globalThis as Record<string, unknown>).Notification;
    delete (globalThis as Record<string, unknown>).PushManager;
    Object.defineProperty(globalThis.navigator, "serviceWorker", {
      value: undefined,
      configurable: true,
    });
  });

  it("serviceWorker 非対応なら unsupported", async () => {
    Object.defineProperty(globalThis.navigator, "serviceWorker", {
      value: undefined,
      configurable: true,
    });
    expect(await subscribeToPush()).toBe("unsupported");
  });

  it("通知拒否なら denied を返して鍵取得もしない", async () => {
    installBrowser({ permission: "denied" });
    expect(await subscribeToPush()).toBe("denied");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("サーバに公開鍵が無ければ unavailable", async () => {
    installBrowser({});
    vi.stubGlobal(
      "fetch",
      vi.fn(() => jsonResponse({ publicKey: null })),
    );
    expect(await subscribeToPush()).toBe("unavailable");
  });

  it("購読に成功すれば endpoint を登録APIへ送る", async () => {
    installBrowser({});
    expect(await subscribeToPush()).toBe("subscribed");
    const calls = vi.mocked(fetch).mock.calls;
    const post = calls.find((c) => (c[1]?.method ?? "GET") === "POST");
    expect(post?.[0]).toBe("/api/push/subscriptions");
    expect(JSON.parse(String(post?.[1]?.body)).endpoint).toBe("https://push.example.test/sub-1");
  });

  it("既に購読済みなら already（登録APIは再度送る）", async () => {
    installBrowser({ existingSubscription: subscription });
    expect(await subscribeToPush()).toBe("already");
  });
});

describe("unsubscribeFromPush", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    Object.defineProperty(globalThis.navigator, "serviceWorker", {
      value: undefined,
      configurable: true,
    });
  });

  it("購読があれば endpoint を DELETE して解除する", async () => {
    installBrowser({ getRegistration: registration(subscription) });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => jsonResponse({ ok: true })),
    );
    await unsubscribeFromPush();
    const calls = vi.mocked(fetch).mock.calls;
    const del = calls.find((c) => c[1]?.method === "DELETE");
    expect(del).toBeTruthy();
    expect(subscription.unsubscribe).toHaveBeenCalled();
  });
});
