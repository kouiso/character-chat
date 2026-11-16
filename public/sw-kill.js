// v1 凍結に伴う引き継ぎ用。_redirects で /sw.js として配信され、
// 既存ユーザーの SW 更新チェックが拾う。全キャッシュと自分を消す。
// 以後のページ遷移は制御外となり /* の 302 が v2 へ送る。
// 別オリジンへは client.navigate で飛べないので誘導はリダイレクトに任せ、
// ここでは掃除だけを確実に終わらせる。
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
      await self.registration.unregister();
    })(),
  );
});
