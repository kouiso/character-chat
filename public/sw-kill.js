// v1 凍結に伴う引き継ぎ用。_redirects で /sw.js として配信され、
// 既存ユーザーの SW 更新チェックが拾う。全キャッシュと自分を消してから v2 へ案内する。
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
      await self.registration.unregister();
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of clients) {
        await client.navigate("https://adult-ai-v2.kouiso.workers.dev/");
      }
    })(),
  );
});
