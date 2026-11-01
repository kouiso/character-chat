# PR 29 と PR 30 を両方 main へ入れる時の競合と解き方（2026-11-01 に確認）

PR 28・29 と PR 30 は、どちらも PR 27 の上に積んだ兄弟。片方を main に入れた後、もう片方を入れると次の 4 か所がぶつかる。
PR 29（f747100）と PR 30（1cd276a）を手元で合わせ、下の通りに解いて検査が全部通ることを確かめた。

| ファイル | 解き方 |
|---|---|
| `eslint.v2.config.js` | console を許す対象を両方足す: `chat-room.ts`・`api-chat.ts`（PR 29）・`memory-jobs.ts`（PR 30）・`worker.ts` |
| `apps/v2/vite.config.ts` | 両方残す: `persistState` の `V2_LOCAL_PERSIST_ROOT`（PR 28）と `remoteBindings: process.env.V2_REMOTE_BINDINGS === "1"`（PR 30） |
| `apps/v2/src/component/chat-view.test.tsx` | 「入力へ戻す保存に失敗」の試験。PR 28 の `removeItem` を失敗させる中身に、PR 30 の「メソッドを持つ側に spy を刺す」形を合わせる（`Object.hasOwn(localStorage, "removeItem") ? localStorage : Storage.prototype`） |
| `apps/v2/src/worker-configuration.d.ts` | 手で解かず、`wrangler.jsonc` を合わせた後に `pnpm --filter @v2/app cf:typegen` で作り直す |

## 合わせた後の検査（すべて成功）
- `NODE_OPTIONS=--experimental-sqlite pnpm v2:ci`（apps/v2 189・db 32・engine 42・judge 332・bench 44・prompt 21・cf 5）
- `pnpm --filter @v2/app build`
- `pnpm --filter @v2/app verify:ci`（手元の workerd）
- `pnpm --filter @v2/app check:built-env production`
