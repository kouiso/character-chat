# Codex Cloud コンテナ自己プロビジョニング

DB / サービス / 結合系タスクを **Codex Cloud に委譲可能**にするための自己完結セットアップ。
外部ネットワーク・実 API・実課金を一切使わない、オフライン環境を1コマンドで用意する。

## 使い方

```bash
bash .codex/setup.sh          # 依存 + ローカルD1 + migration + 最小seed + placeholder secret
node .codex/mock-server.mjs   # 外部LLM/画像APIのモック（別プロセス、no network）
```

Codex Cloud env の「setup script」に `bash .codex/setup.sh` を登録すれば、以降の
タスクは最初からDBが立った状態で開始できる。

### 便利なノブ（環境変数）

| 変数 | 効果 |
|---|---|
| `SKIP_INSTALL=1` | `pnpm install` を飛ばす（依存が既にある再実行時） |
| `WRANGLER_PERSIST_DIR=<dir>` | ローカルD1/R2/KVの状態を `<dir>` に隔離（既存 `.wrangler` を汚さない） |
| `START_MOCK=1` | 最後に `mock-server.mjs` をバックグラウンド起動 |

## 何をプロビジョニングするか

| 要素 | 手段 | ネットワーク |
|---|---|---|
| 依存 | `pnpm install --frozen-lockfile`（pnpm 9.15.0 / Node 22） | パッケージ取得のみ |
| ローカルDB | `wrangler d1 migrations apply adult-ai-db --local`（miniflare, 認証不要） | なし |
| seed | `wrangler d1 execute --local --file .codex/seed-min.sql` | なし |
| secret / env | `.codex/dev-vars.example` → `.dev.vars`（gitignore済・実鍵なし） | なし |
| 外部API | `.codex/mock-server.mjs`（OpenRouter/Anthropic/Novita形状） | なし |

### なぜ最小 seed なのか

フルの `pnpm db:seed`（`script/seed.ts`）は avatar を **リモート R2** に
`wrangler r2 object put`（`--local` なし）でアップロードするため、Cloudflare 認証と
ネットワークが必須でコンテナでは動かない。`.codex/seed-min.sql` は user / character /
conversation / message を1件ずつ入れるだけの、結合テストが実データを読むための最小分。
ベーススキーマのカラムのみ使用（全 migration 適用後も必ず存在するカラム）。

## migration は autogenerate 優先（手書き禁止）

新しいスキーマ変更が要るタスクでは、必ず drizzle-kit の生成を先に走らせる:

```bash
# 1. src/schema/*.ts を編集
# 2. migration を自動生成（手書きしない）
pnpm db:generate
# 3. D1 が未対応の箇所（例: 一部の ALTER）だけを生成物に手当てする
# 4. ローカル適用して確認
pnpm exec wrangler d1 migrations apply adult-ai-db --local
```

フルの手書き migration は禁止。生成物をベースに、未対応部分だけ最小限手で直す
（AGENTS.md の DB-1 / DB-2 と整合）。

## 外部APIモック

`.codex/mock-server.mjs` は依存ゼロの Node HTTP サーバー。既定 `http://127.0.0.1:8790`。
`functions/api/lib/model-router.ts` などは `fetchImpl` を差し込めるので、結合テストは
モックの base URL を指すことで無ネットワークで LLM/画像の応答形状を再現できる。

| ルート | 返すもの |
|---|---|
| `POST /api/v1/chat/completions` | OpenRouter/OpenAI 形式（`stream:true` で SSE） |
| `POST /v1/messages` | Anthropic messages 形式 |
| `POST /v3/async/txt2img` `img2img` | Novita 非同期 init `{ task_id }` |
| `GET /v3/async/task-result` | Novita 結果（`/mock-image.png` を指す） |
| `GET /mock-image.png` | 1x1 PNG（ローカル生成） |
| `GET /health` | `{ ok: true }` |

## これで委譲可能になるタスククラス

このコンテナがある前に「DB/サービスが無いから Cloud 対象外」と除外していたものが対象になる:

- **migration 系**: 新スキーマの `pnpm db:generate` → ローカル適用 → 差分確認。
- **seed / データ整合系**: `script/db-sync.ts`（catalog/dry）や seed ロジックのローカル検証。
- **DB 依存の結合テスト**: D1 バインディングに実データがある状態でのハンドラ検証。
- **worker ローカル起動系**: `wrangler pages dev` を placeholder secret + モックAPIで起動して叩く検証。
- **オフライン e2e smoke**: ライブ鍵不要の Playwright スモーク（CI と同じ graceful-skip 方針）。

いずれも外部ネットワーク・実課金なしで完結する。
