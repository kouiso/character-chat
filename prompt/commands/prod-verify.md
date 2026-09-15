---
description: adult-ai-chat.pages.dev の本番動作確認を実施する。CF Access 認証・API・キャラ描画を体系的に検証する。
---

# /prod-verify — 本番動作確認

## 概要

このコマンドは `adult-ai-chat.pages.dev` の本番環境を体系的に検証する。
AI が **自分の目で** 本番 UI を確認するための手順を定義する。

## 前提条件

`.prod-verify.vars`（gitignore 済み、プロジェクトルートに配置）:
```
PROD_BASE_URL=https://adult-ai-chat.pages.dev
CF_ACCESS_CLIENT_ID=<id>.access
CF_ACCESS_CLIENT_SECRET=<secret>
AUTH_TOKEN=<bearer token>
```

## Step 1: API 疎通確認（課金なし）

```bash
pnpm exec tsx script/verify/prod-smoke.ts
```

確認内容:
- CF Access エッジ通過（サービストークン）→ 200
- トークンなしアクセス → 30x/403
- `/api/me` → 200 + email 返却
- `/api/characters` → 200 + 件数ログ

## Step 2: ブラウザ UI 目視確認（課金なし）

```bash
pnpm exec tsx script/verify/browser-smoke.ts
```

内部動作:
1. `page.route("**/*")` で CF-Access ヘッダー注入（`CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET`）
2. `POST /api/auth/session` に `AUTH_TOKEN` → app JWT 取得 → `localStorage.auth_token` セット
3. `localStorage.age_verified = "true"` セット → エイジゲート回避
4. `[data-testid="portal-scroll-container"]` 待機 → キャラカード件数ポーリング
5. スクリーンショットを `.work/e2e-results/browser-smoke-<ts>.png` に保存

PASS 条件: キャラカード ≥1件 かつ エラー文言なし

スクリーンショット確認コマンド（Read ツールで開く）:
```
.work/e2e-results/browser-smoke-<最新タイムスタンプ>.png
```

## Step 3: 本番 URL Chrome MCP 直接確認（オプション）

Chrome MCP が使える場合:
```
navigate → https://adult-ai-chat.pages.dev
（CF Access 認証済みタブがあれば再利用、なければ Step 2 のスクリーンショットで代替）
```

## CF Access 認証の仕組み（理解のため）

| 経路 | 仕組み | 対象 |
|------|--------|------|
| サービストークン（非 identity） | `CF-Access-Client-Id/Secret` ヘッダー | AI 自動検証（browser-smoke.ts） |
| OTP ログイン（identity） | CF Access メール OTP → CF Access JWT → app JWT | 人間ユーザー |

**CF Access JWT 認証のコード（`functions/api/[[route]].ts` 内 `getUserEmail`）:**
- `Cf-Access-Jwt-Assertion` ヘッダーを JWKS で検証
- `CLOUDFLARE_ACCESS_TEAM_DOMAIN` / `CLOUDFLARE_ACCESS_AUD` を wrangler.toml [vars] で設定済み
- AUD 未設定でも issuer + 署名検証は実施（audience check のみ省略）

→ 実装済み（`92ca8de`）。OTP ログインユーザーも `/api/auth/session` で app JWT を取得可能。

## Step 4: 機能検証（課金あり、opt-in）

```bash
PROD_VERIFY_MODE=functional pnpm exec tsx script/verify/browser-smoke.ts
```

注意: chat 送信 + 画像生成 = OpenRouter / Novita に **実際に課金が発生する**。
明示的に求められた場合のみ実行。

## 完了基準と報告フォーマット

```
【本番動作確認】
- CF Access エッジ: [GREEN/RED] HTTP <status>
- Guard (トークンなし): [GREEN/RED] HTTP <status>
- /api/me: [GREEN/RED] <email>
- /api/characters: [GREEN/RED] <件数>件
- キャラ UI 描画: [GREEN/RED] <件数>件 (スクリーンショット: <path>)
- 総合: ✅ PASS / ❌ FAIL
```

検証ソース: `[実機目視]` (スクリーンショット添付) または `[CI]`

## よくある失敗パターンと対処

| 症状 | 原因 | 対処 |
|------|------|------|
| `/api/me` → 401 | AUTH_TOKEN 未デプロイ / 期限切れ | wrangler pages secret で再設定 |
| キャラ 0件 | D1 migration 未適用 / DB バインディング誤り | `wrangler d1 execute DB --remote --command "SELECT COUNT(*) FROM character"` |
| エッジ 403 | CF_ACCESS_CLIENT_ID/SECRET 誤り | .prod-verify.vars 確認 |
| playwright 起動失敗 | chromium バイナリ未インストール | `pnpm exec playwright install chromium` |

## 禁止事項

- `.prod-verify.vars` の内容（secret）をログ・チャット・スクリーンショットに出力しない
- `functional` モードを理由なく実行しない（課金発生）
- スクリーンショットなしで「キャラが見える」と報告しない
