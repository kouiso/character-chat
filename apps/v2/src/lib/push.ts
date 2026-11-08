// PWA push の購読まわり。SW 登録 → VAPID 公開鍵取得 → PushManager.subscribe → 登録API。
// 失敗理由は呼び出し側がそのまま画面に出せるよう状態で返す。
export type PushSubscribeResult =
  | "subscribed"
  | "already"
  | "unsupported"
  | "denied"
  | "unavailable"
  | "failed";

const SW_PATH = "/sw.js";

const base64UrlToUint8Array = (base64: string): Uint8Array => {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

const postSubscription = async (subscription: PushSubscription): Promise<boolean> => {
  const json = subscription.toJSON();
  const response = await fetch("/api/push/subscriptions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      endpoint: json.endpoint,
      keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
    }),
  }).catch(() => null);
  return response?.ok === true;
};

const pushSupported = (): boolean =>
  typeof navigator !== "undefined" &&
  "serviceWorker" in navigator &&
  "PushManager" in globalThis &&
  typeof Notification !== "undefined";

const fetchVapidKey = async (): Promise<string | null | undefined> => {
  const response = await fetch("/api/push/vapid-key").catch(() => null);
  if (!response?.ok) return undefined;
  const body = (await response.json().catch(() => ({}))) as { publicKey?: string | null };
  return body.publicKey ?? null;
};

const registerAndSubscribe = async (publicKey: string): Promise<PushSubscribeResult> => {
  const registration = await navigator.serviceWorker.register(SW_PATH).catch(() => null);
  if (!registration) return "failed";

  const existing = await registration.pushManager.getSubscription();
  if (existing) {
    // 鍵が変わっとる可能性もあるので毎回サーバへは送る（同じ endpoint は上書き保存）。
    await postSubscription(existing);
    return "already";
  }

  const subscription = await registration.pushManager
    .subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToUint8Array(publicKey) as BufferSource,
    })
    .catch(() => null);
  if (!subscription) return "failed";

  const ok = await postSubscription(subscription);
  if (!ok) {
    await subscription.unsubscribe().catch(() => {});
    return "failed";
  }
  return "subscribed";
};

export const subscribeToPush = async (): Promise<PushSubscribeResult> => {
  if (!pushSupported()) return "unsupported";

  const permission =
    Notification.permission === "default"
      ? await Notification.requestPermission()
      : Notification.permission;
  if (permission === "denied") return "denied";

  const publicKey = await fetchVapidKey();
  if (publicKey === undefined) return "failed";
  if (publicKey === null) return "unavailable";
  return registerAndSubscribe(publicKey);
};

export const unsubscribeFromPush = async (): Promise<void> => {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration(SW_PATH).catch(() => null);
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;
  await fetch("/api/push/subscriptions", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  }).catch(() => {});
  await subscription.unsubscribe().catch(() => {});
};
