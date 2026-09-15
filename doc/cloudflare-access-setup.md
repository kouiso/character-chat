# Cloudflare Access — 本番 sukererion@gmail.com 限定セットアップ

## 前提

- 本アプリは Cloudflare Pages project `adult-ai-chat` にデプロイ済。標準の本番 URL は `https://adult-ai-chat.pages.dev`。`adult-ai-app.pages.dev` は存在しない Pages project 名なので DNS 解決できない。
- 認証は `functions/api/[[route]].ts` の `getUserEmail()` が `CF-Access-Authenticated-User-Email` ヘッダーを既に読み取る作りになっている (708-715行)。Access が前段で email を確定させると、アプリ内では自動的に「ログイン済ユーザー」として扱われる
- Claude 月額利用（Claudeモデル直送チャット・文脈サジェスト）は `CLAUDE_SESSION_TOKEN` を Cloudflare Pages secret に入れて使う。品質judgeは #952 で OpenRouter へ移行したのでこのトークンに依存せん。ローカルと同じ Claude Code OAuth token を使う場合は `bash script/sync-claude-session-secret.sh` で同期する
- 規約観点: CF Access の Google ログインは「Cloudflare の OAuth クライアント」として動く。アプリのコンテンツ性は Google から見えないため、Google OAuth ToS の成人向け制限を踏まない (private use 前提)

## 全体構成

```
Browser ──► https://本番ドメイン
            ↓ (CF Access 未認証なら 302)
            CF Access ログイン画面 (Google SSO)
            ↓ (sukererion@gmail.com で通過)
            CF Access が CF-Access-Authenticated-User-Email を付与
            ↓
            Cloudflare Pages (本アプリ)
```

## セットアップ手順

### 1. Cloudflare Zero Trust にアクセス

1. https://one.dash.cloudflare.com/ にアクセス
2. 初回は Team name (例: `kouiso`) を設定。すでに設定済なら 2 へ
3. 左メニュー **Settings > Authentication**

### 2. Google を Login Method に追加 (未追加の場合のみ)

1. **Login methods** タブ → **Add new**
2. プロバイダとして **Google** を選択
3. 表示される手順に従って Google Cloud Console で OAuth client を作成
   - **OAuth consent screen**: User Type = External, App name = `Cloudflare Access`, User support email = sukererion@gmail.com, Developer contact = sukererion@gmail.com
   - **Credentials > Create credentials > OAuth client ID**: Application type = Web application, Authorized redirect URI = CF が表示する `https://<team>.cloudflareaccess.com/cdn-cgi/access/callback`
4. 発行された Client ID / Client Secret を Cloudflare 側に貼り付け
5. **Save**
6. Cloudflare 側で「Test connection」を実行して成功すること

> ⚠️ Google Cloud Console で **Publishing status** を `Testing` のままにしておけば、Test users に sukererion@gmail.com を追加するだけで使える。`In production` に上げる必要なし → Google の審査・規約チェックを回避できる

### 3. Access Application を作成

1. Zero Trust ダッシュボード左メニュー **Access > Applications**
2. **Add an application** → **Self-hosted**
3. フォーム入力:
   - **Application name**: `adult-ai-app (production)`
   - **Session Duration**: `24 hours` (お好みで)
   - **Application domain**:
     - Subdomain: 空欄 (apex) または `app` (例)
     - Domain: 本番に使うドメイン (`adult-ai-chat.pages.dev` または独自ドメイン)
     - Path: 空欄 (全パス保護)
4. **Identity providers**: Google にチェック (他を全部 OFF)
5. **Next**

### 4. Policy を作成 (sukererion@gmail.com のみ許可)

1. **Add a policy**
2. フォーム入力:
   - **Policy name**: `allow-owner-only`
   - **Action**: `Allow`
   - **Session Duration**: アプリ設定と同じ
   - **Configure rules > Include**:
     - Selector = **Emails**
     - Value = `sukererion@gmail.com`
   - Require / Exclude は空のまま
3. **Next** → **Add application** で保存

### 5. 動作確認

事前に Claude token を本番へ設定:

```bash
bash script/sync-claude-session-secret.sh
```

1. ブラウザの incognito ウィンドウで本番ドメインを開く
2. CF Access のログイン画面が出る → **Google** を選ぶ
3. `sukererion@gmail.com` でログイン → アプリ画面に到達
4. 試しに別のメアドでログインしてみる → 「Access denied」画面が出ること

CLI で DNS と Access 前段を確認:

```bash
npm run deploy:verify-url
```

`adult-ai-chat.pages.dev` は Cloudflare Access 保護時に `302` を返す。deployment 固有 URL を渡した場合は `200` が正常。`adult-ai-app.pages.dev` が `000` 以外を返したら、誤った Pages project / Access 設定が混入している。

### 6. アプリのログアウトリンク (Phase 1 で UI 側に追加)

CF Access のセッションを切る URL:
```
https://<team>.cloudflareaccess.com/cdn-cgi/access/logout
```

`<team>` は Zero Trust 設定の **Team name**。例: team が `kouiso` なら `https://kouiso.cloudflareaccess.com/cdn-cgi/access/logout`。

このURL をアプリ右上のログアウトボタンの遷移先にする (別途 codex 委譲で UI 追加予定)。

### 7. ローカル開発時の挙動

Cloudflare Access は本番ドメインだけ前段に置かれる。ローカル (`localhost:5173` / `localhost:8788`) は通らない。`getUserEmail()` のローカル fallback (`sukererion@gmail.com`) がそのまま効くので、ローカル開発は変わらず動く。

### 8. もし「ログインループ」になったら

- Cookie がブラウザに残っていない (ITP / シークレットモードでブロック等)
- CF Access のセッション Cookie ドメインがアプリと一致しない
- Browser 側で `*.cloudflareaccess.com` を 3rd party cookie として弾いている

→ Zero Trust の **Settings > Authentication > Cookie settings** で Session Duration や SameSite を確認。

## 解除手順 (Phase 2 移行時)

将来 email magic link に置換する際:
1. Cloudflare Access の Application を **Delete** または Policy を `Deny everyone` に
2. `getUserEmail()` の Bearer / Access ヘッダー読み取りはそのまま残す (magic link 側の JWT を発行・検証する別経路を追加)
3. このドキュメントを更新

## チェックリスト

- [ ] Zero Trust Team name 設定済
- [ ] Google Login Method 追加 (OAuth ID / Secret 設定)
- [ ] Application `adult-ai-app (production)` 作成
- [ ] Policy `allow-owner-only` 作成
- [ ] `CLAUDE_SESSION_TOKEN` を Cloudflare Pages secret に設定済
- [ ] sukererion@gmail.com でアクセス可能
- [ ] 別メアドで `Access denied` を確認
- [ ] アプリ側のログアウトリンクが正しいログアウトURLになっている
- [ ] ローカル開発 (localhost) が引き続き通る
