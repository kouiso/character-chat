// v1 凍結に伴う引き継ぎ用。_redirects で /sw.js として配信され、
// 既存ユーザーの SW 更新チェックが拾う。全キャッシュと自分を消す。
// 以後のページ遷移は制御外となり /* の 302 が v2 へ送る。
// client.navigate はオリジン外 URL で reject するので、activate を
// 落とさないよう失敗は握り潰す（v2 への誘導はリダイレクトが担う）。
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
      await self.registration.unregister();
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of clients) {
        try {
          await client.navigate("https://adult-ai-v2.kouiso.workers.dev/");
        } catch {
          // オリジン外 navigate は不可。次の遷移・リロードが 302 で v2 へ行く。
        }
      }
    })(),
  );
});
