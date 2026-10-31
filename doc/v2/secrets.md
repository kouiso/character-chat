# v2 の secret の入れ方・入れ替え手順（SBI-01-3 / RIT-61）

2026-10-28。対象は Worker `adult-ai-v2`（本番）と `adult-ai-v2-staging`（試し用）。
資格情報は Cloudflare の secret と手元の `.dev.vars` だけに置く。repo・PR 本文・
ログ・ビルド成果物へは書かん。

## 必要な secret

| 名前 | 用途 | 無い時の挙動 |
|---|---|---|
| `BASIC_AUTH_USERNAME` | 入口 BASIC 認証のユーザー名（コロン不可） | 全リクエスト 503 |
| `BASIC_AUTH_PASSWORD` | 入口 BASIC 認証のパスワード | 全リクエスト 503 |
| `OPENROUTER_API_KEY` | 返事生成のモデル呼び出し | チャット送信が 503 |

`wrangler.jsonc` の `secrets.required` に同名を宣言してあるので、未設定のままでは
`wrangler deploy` が止まる（出した後に開く状態にはならん）。

## 入れる（初回・環境ごとに 1 回）

```sh
cd apps/v2
pnpm exec wrangler secret put BASIC_AUTH_USERNAME   # 値を貼る（履歴に残さんためプロンプトで）
pnpm exec wrangler secret put BASIC_AUTH_PASSWORD
pnpm exec wrangler secret put OPENROUTER_API_KEY
# staging は --env staging を付ける
pnpm exec wrangler secret put BASIC_AUTH_USERNAME --env staging
```

## 手元で動かす（秘密は repo に置かん）

`apps/v2/.dev.vars`（git の無視対象、初回 0600 で作る）に同じ名前で書く:

```sh
BASIC_AUTH_USERNAME=<手元用>
BASIC_AUTH_PASSWORD=<手元用>
OPENROUTER_API_KEY=<実機でモデルを呼ぶ時だけ>
APP_ENV=test
V2_FAKE_MODEL=1
```

`APP_ENV=test` と `V2_FAKE_MODEL=1` の両方がある時だけ固定モデルが返る
（実キーを呼ばん検証は `verify:ci` / `verify:runtime` がこの形で回す）。

## 入れ替える（漏れた・定期交換）

1. `wrangler secret put <名前>` で新しい値を入れる。Workers の secret は即時反映。
2. 別端末から旧資格情報で `curl -u 旧ユーザー:旧パス https://<worker URL>/` を叩き、
   **401・本文 0 バイト**を確認する。新しい値で 200 が返ることも確認。
3. BASIC 認証のユーザー名・パスワードはセットで替える（片方だけ残すと当て勘の手がかりになる）。

## 検査（CI と同じものを手元でも回せる）

```sh
pnpm --filter @v2/app secrets:check
```

- `.dev.vars*`・`.prod-verify.vars` が `.gitignore` の無視ルールで commit 不能であること
- 追跡ファイル・ビルド成果物（`apps/v2/dist`・`apps/v2/.output`・`dist`）に
  鍵らしき文字列（`sk-or-v1-`、Slack/GitHub/Google の鍵、秘密鍵ブロック、
  プレースホルダでない `*_KEY=値` など）が無いこと

わざと `.dev.vars` を `git add` しても `git check-ignore` が無視を返すので
ステージングに乗らん（乗った場合はこのスクリプトが検出して止める）。

## 資源の初回準備（deploy 前に 1 回だけ）

`wrangler.jsonc` が束ねるうち、2026-10-28 時点でアカウントに未作成のもの:

```sh
pnpm exec wrangler vectorize create v2-memory-index --dimensions=1024 --metric=cosine
pnpm exec wrangler queues create v2-memory-jobs
# staging（既存の character-chat-v2-staging 系に揃える）
pnpm exec wrangler queues create v2-memory-jobs-staging
```

未作成のまま `wrangler deploy` すると束ね解決で止まるので、開いた状態にはならん。

## やってはいけん

- secret の値を issue・PR・commit・ログ・`wrangler.jsonc` の `vars` に書く
- 本番 secret を `.dev.vars` にコピペして手元から実モデルを叩く（必要時は別の試し用キー）
- `wrangler secret put` の引数に値を直接書く（シェル履歴に残る）
