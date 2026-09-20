# character-chat

AI キャラクターとのリアルタイムチャット・画像生成が楽しめる PWA。
React + Hono + Cloudflare Pages で動く。

## ドキュメント

詳細は doc ディレクトリ内の各ファイルを参照

- 新規参加・環境構築
  [doc/onboarding.md](./doc/onboarding.md)

- 開発ガイド・コーディング規約
  [doc/dev-guide.md](./doc/dev-guide.md)

- LLM ルーティング設計
  [doc/llm-router-architecture.md](./doc/llm-router-architecture.md)

- デプロイ準備チェックリスト
  [doc/cloudflare-pages-deploy-readiness.md](./doc/cloudflare-pages-deploy-readiness.md)

- バックアップ・リストア手順
  [doc/backup-restore.md](./doc/backup-restore.md)

- ユビキタス言語
  [doc/ubiquitous-language.md](./doc/ubiquitous-language.md)

## デプロイ運用ルール

`drizzle/*.sql` を含む PR は、merge 後に **必ず** migration を production D1 に適用してから Pages deploy する。
通常は `main` push 時に GitHub Actions (`.github/workflows/deploy.yml`) が migration → build → deploy を順に実行する。
手動で行う場合は `task deploy`（migration auto-apply gate 込み）を使う。

## サプライチェーン

| コントロール | 状態 |
|---|---|
| lockfile 整合性 | ✅ CI で `pnpm install --frozen-lockfile` |
| 依存バージョン固定 | ✅ pnpm-lock.yaml に exact versions |
| CI ランナー | ✅ Blacksmith isolated (`blacksmith-4vcpu-ubuntu-2404`) |
| シークレット管理 | ✅ Cloudflare Pages secrets のみ（ソース非埋め込み） |

## 品質自動報告（Linear）

`/api/chat` レスポンスに `x-quality-warning: 1` が付いたとき、サーバーが自動的に Linear Issue を起票する。

1. Linear の personal API key を発行
2. `LINEAR_API_KEY` / `LINEAR_TEAM_ID` を Cloudflare Pages secrets に登録:

`GH_APP_ID` / `GH_APP_INSTALLATION_ID` / `GH_APP_PRIVATE_KEY` も従来通り GitHub Issue 起票のフォールバックとして使える。

```bash
wrangler pages secret put LINEAR_API_KEY --project-name adult-ai-chat
wrangler pages secret put LINEAR_TEAM_ID --project-name adult-ai-chat
```
