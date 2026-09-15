---
name: prod-verify
description: adult-ai-chat.pages.dev の本番動作確認スキル。CF Access をサービストークンで突破し AI 単独で本番 API・UI を検証する。デプロイ後・PR merge 後に必ず呼ぶ。
metadata:
  type: feedback
  trigger: デプロイ完了後、PR merge 後、「本番で動いてるか確認して」「CF Access でアクセスできない」と判断しかけた時
---

# 本番動作確認スキル — adult-ai-chat.pages.dev

## 自動起動トリガー（hook 強制）

`gh pr merge` を検知すると `.work/.pending-prod-verify` marker が自動で立つ。
`pnpm verify:prod:browser` が `.work/e2e-results/browser-smoke-*.png` を生成するまで Stop hook が turn 終了をブロックする。
**ユーザーに「確認して」と言わせることは禁止。marker が立ったら即座に以下の手順を実行せよ。**

## 鉄則

「CF Access でブロック」「ユーザーにログインしてもらう必要がある」と宣言する前に、
必ずこのスキルの手順を全て試すこと。**ユーザー介入なしで本番確認が完結する。**

## 前提確認

```bash
ls .prod-verify.vars   # 存在すれば OK（gitignore 済み）
```

`.prod-verify.vars` がない場合:
- `~/.claude/projects/-Users-kouiso-ghq-kouiso-adult-ai-app/` の過去セッションを grep して取得方法を確認
- または `wrangler pages secret list` + 1Password で再構築

## Step 1: API 疎通確認（課金なし、30秒以内）

```bash
pnpm verify:prod
```

確認内容:
- CF Access エッジ通過（サービストークン `CF-Access-Client-Id/Secret`）→ 200
- 認証なしアクセス → 302/403（Guard intact）
- `/api/me` → 200 + email
- `/api/characters` → 200 + キャラ件数
- 画像生成パイプライン全体 → Novita succeed + R2 persist + R2 display

**PASS 基準**: 全チェック ✓（exit code 0）

## Step 2: UI ブラウザ確認（課金なし、スクリーンショット生成）

```bash
pnpm verify:prod:browser
```

内部動作:
1. Playwright headless Chromium 起動
2. `CF-Access-Client-Id/Secret` ヘッダーを全リクエストに注入（CF Access 突破）
3. `POST /api/auth/session` で app JWT 取得 → `localStorage.auth_token` セット
4. `localStorage.age_verified = "true"` → エイジゲート回避
5. キャラカード表示まで待機
6. スクリーンショット → `.work/e2e-results/browser-smoke-<ts>.png`

確認コマンド:
```bash
ls -t .work/e2e-results/browser-smoke-*.png | head -1
# → Read ツールで画像を開いて目視確認
```

**PASS 基準**: キャラカード ≥1件、エラー文言なし、スクリーンショット生成済み

## Step 3: 機能検証（課金あり、明示指示時のみ）

```bash
PROD_VERIFY_MODE=functional pnpm verify:prod:browser
```

注意: OpenRouter（chat）+ Novita（image）に実課金が発生する。
「本番で実際に会話・画像生成まで確認して」と明示された時のみ実行。

## 報告フォーマット

```
【本番動作確認】 [実機目視]
- CF Access エッジ通過: ✅ 200
- Guard (認証なし): ✅ 302/403
- /api/me: ✅ sukererion@gmail.com
- /api/characters: ✅ N件
- 画像パイプライン (Step1): ✅ or ❌ (R2 404等の詳細)
- UI キャラ描画 (Step2): ✅ N件 (スクリーンショット: .work/e2e-results/browser-smoke-xxx.png)
- 総合: ✅ PASS / ❌ FAIL
```

## よくある失敗と対処

| 症状 | 原因 | 対処 |
|------|------|------|
| CF Access 403 | CF_ACCESS_CLIENT_ID/SECRET 期限切れ | Cloudflare dashboard でサービストークン再生成 → `.prod-verify.vars` 更新 |
| `/api/me` 401 | AUTH_TOKEN 期限切れ | `wrangler pages secret put AUTH_TOKEN` |
| R2 404 | R2 binding 誤り / persist→fetch キー不一致 | `wrangler d1 execute` でDB確認, R2 bucket binding 確認 |
| キャラ 0件 | D1 migration 未適用 | `wrangler d1 execute DB --remote --command "SELECT COUNT(*) FROM character"` |
| playwright 起動失敗 | chromium 未インストール | `pnpm exec playwright install chromium` |

## CF Access の仕組み（理解のため）

| 経路 | ヘッダー | 用途 |
|------|--------|------|
| サービストークン | `CF-Access-Client-Id` + `CF-Access-Client-Secret` | AI 自動検証（このスキル） |
| OTP ログイン | CF Access JWT → app JWT | 人間ユーザー |

→ AI はサービストークンで人間ログインなしに本番にアクセスできる。
「CF Access でアクセス不可」は誤り。

## 関連ファイル

- `.prod-verify.vars` — CF Access トークン + AUTH_TOKEN（gitignore 済み）
- `script/verify/prod-smoke.ts` — API 疎通テスト実装
- `script/verify/browser-smoke.ts` — UI ブラウザテスト実装
- `.claude/commands/prod-verify.md` — コマンド詳細説明
- `prompt/instructions/prohibitions.md` — 「本番 verify インフラを使わずにブロック宣言禁止」ルール
