<!-- AUTO-GENERATED from AGENTS.md by scripts/sync-ai-rules.sh -->
<!-- DO NOT HAND-EDIT — changes will be overwritten on next sync -->
<!-- To update: edit AGENTS.md, then run: bash scripts/sync-ai-rules.sh -->

# adult-ai-app — Gemini Code Assist スタイルガイド

## レビュー言語

- すべてのレビューコメントは **日本語** で記述してください
- 内部の思考プロセス（think）のみ英語で行い、出力は日本語にしてください

## PR サマリー

- PR の要約はポエティックで読みやすい形式で記述してください（CodeRabbit 風）
- 変更内容の本質を捉えた、わかりやすく印象的な表現を使用してください

---

<!-- ===== AGENTS.md CONTENT (auto-synced) ===== -->

# adult-ai-app

AI キャラクターチャット＆画像生成 PWA。Cloudflare Pages + Hono バックエンド構成。

- **本番**: https://adult-ai-chat.pages.dev
- **ステージング**: なし（Cloudflare Pages preview deployment が代替）

> ⚠️ `.gemini/styleguide.md` と `.github/copilot-instructions.md` はこのファイルから
> `scripts/sync-ai-rules.sh` で自動生成される。直接編集禁止。

## 技術スタック

| カテゴリ | 技術 |
|---|---|
| フレームワーク | React 19 + TypeScript + Vite 8 |
| スタイル | Tailwind CSS v4 + shadcn/ui |
| 状態管理 | Zustand |
| ローカル DB | Dexie (IndexedDB) |
| AI SDK | Vercel AI SDK + OpenRouter |
| バックエンド | Hono (Cloudflare Pages Functions) |
| DB | Cloudflare D1 (Drizzle ORM) |
| デプロイ | Cloudflare Pages |
| パッケージ管理 | pnpm |

## コマンド

```bash
pnpm install         # 依存インストール
pnpm dev             # Vite 開発サーバー
pnpm build           # tsc -b && vite build
pnpm lint            # ESLint
pnpm test            # Vitest
pnpm dev:worker      # Cloudflare Pages ローカル開発
task ci              # CI チェック（lint + build）
task deploy          # デプロイ（D1 migration auto-apply ゲートあり）
```

## Codex Cloud コンテナ環境（自己プロビジョニング）

DB / サービス / 結合系タスクをクラウド委譲可能にするための自己完結セットアップ。
外部ネットワーク・実 API・実課金を一切使わない。詳細は `.codex/README.md`。

```bash
bash .codex/setup.sh          # 依存 + ローカル D1(miniflare) + migration + 最小 seed + placeholder secret
node .codex/mock-server.mjs   # 外部 LLM/画像 API のモック（no network / no payment）
```

- ローカル D1 は `wrangler d1 ... --local`（miniflare・認証不要・オフライン）。
- 新規スキーマ変更は **autogenerate 優先**: `pnpm db:generate`（drizzle-kit）で生成し、D1 が未対応の箇所だけ手当てする。フル手書き migration は禁止。
- placeholder secret は `.codex/dev-vars.example` → `.dev.vars`（gitignore 済み・実鍵なし。既存の本物は上書きしない）。

## アーキテクチャ

`prompt/` を詳細指示のシングルソースとする。Claude Code は常時ロードを
最小化し、`.claude/rules/domain-routing.md` から対象の詳細指示だけを読む。
GitHub Copilot にはシンボリックリンクで配信する。

| ソース | Claude Code | GitHub Copilot |
|---|---|---|
| `prompt/instructions/*.md` | `.claude/rules/domain-routing.md` から必要時に参照 | `.github/instructions/*.instructions.md` |
| `prompt/commands/*.md` | `.claude/commands/*.md` | `.github/prompts/*.prompt.md` |
| `prompt/agents/*.md` | `.claude/agents/*.md` | `.github/agents/*.agent.md` |

`.claude/rules/` には routing、path-scoped rules、常時適用が必要な最小ルールだけを置く。

## コーディング規約

- **ファイル名・ディレクトリ名**: 英語小文字単数形ケバブケース（例: `chat-input.tsx`）
- **コンポーネント**: PascalCase
- **変数・関数**: camelCase
- **定数**: UPPER_SNAKE_CASE
- **コメント**: 日本語、「なぜ」のみ
- **コミットメッセージ**: 英語 Conventional Commits（`feat:`, `fix:`, `chore:` 等）
- `any` 型禁止・`@ts-ignore` 禁止
- `eslint-disable` コメント禁止（根本解決する）
- タスク完了前に `pnpm test` GREEN 必須

## Git

- `--no-verify` 禁止
- `--force`（`--force-with-lease` 以外）禁止
- `git reset --hard/--soft/--mixed` 禁止

## レビュー観点（よくある失敗パターン）

> このセクションは CodeRabbit（REVIEW.md）と共有する失敗パターン corpus の圧縮版です。
> Codex・Gemini・Copilot はこの観点で diff をレビューしてください。

### IMG — 画像生成

| ID | ルール | 重大度 |
|---|---|---|
| IMG-1 | climax/afterglow で cum/facial/hair付着タグを positive に置くな → negative へ | MUST |
| IMG-2 | img2img のベースは ord=0 ではなく highest-ord のサブ画像を使え | MUST |
| IMG-3 | 肌色・体型プロンプトには英語 SD タグ anchor を必須とせよ | MUST |
| IMG-4 | pHash 重複チェックなしのサブ画像 INSERT は弾け | suggestion |

### CHAT — 会話/エロ品質

| ID | ルール | 重大度 |
|---|---|---|
| CHAT-1 | climax フェーズのエスカレーション不足・continuation guard 欠如 | MUST |
| CHAT-2 | retry context に `【指示】` ブロックをそのまま積むな（sanitize 必須） | MUST |
| CHAT-3 | client 発 scenePhase 昇格をバックエンドが無検証で受け入れるな | MUST |
| CHAT-4 | `*_LONGFORM_HINT` に具体的な文字数目標を混ぜるな。文字数の正規指示は lengthDirective 一本（hint との同時活性化自体は意図的な両立方針、#633 #719） | MUST |

### DB — データ/マイグレーション

| ID | ルール | 重大度 |
|---|---|---|
| DB-1 | `DROP TABLE` / `DROP COLUMN` / 破壊的 ALTER は根拠必須、additive migration を優先 | MUST |
| DB-2 | マイグレーションのみで同 PR に writer がない = scaffolding≠done、明示せよ | MUST |
| DB-3 | greeting / feedback 等の永続化は D1 を正とせよ（IndexedDB のみ保存禁止） | MUST |

### TS — 型安全

| ID | ルール | 重大度 |
|---|---|---|
| TS-1 | Zod スキーマ型変更時は consumer を同 PR で全修正せよ | MUST |
| TS-2 | `any` / `@ts-ignore` / `eslint-disable` を diff に含めるな | MUST |

### SSE — ストリーミング

| ID | ルール | 重大度 |
|---|---|---|
| SSE-1 | handler のみ・emitter なし（またはその逆）は scaffolding として明示せよ | MUST |
| SSE-2 | badge 文言変更時はテストも同 PR で更新せよ | MUST |

### PROC — プロセス

| ID | ルール | 重大度 |
|---|---|---|
| PROC-1 | lint 後追い commit 禁止（commit 前に `pnpm lint` を通せ） | suggestion |
| PROC-2 | `--no-verify` / `--force`（`--force-with-lease` 以外）/ `git reset` 系は禁止 | MUST |

### PHIL — プロジェクト哲学

| ID | ルール | 重大度 |
|---|---|---|
| PHIL-1 | モデレーション/CSAMフィルタ/生成内容検閲を P0/必須として持ち出すな（エロ品質が存在理由） | MUST |
| PHIL-2 | tracked issue を閉じない自作自演 PR（AI 起点の "gap/risk"）は立てるな | MUST |
| PHIL-3 | chat 側変更時は image への影響確認（またはスコープ外宣言）を PR description に書け | suggestion |
| PHIL-4 | テスト通過のみを根拠に「完了」を主張するな（UI には目視スクショ必須） | suggestion |
| PHIL-5 | コメントは日本語で「Why」のみ、英語コメント・自明な What コメント禁止 | suggestion |

### CHAT-5: very_long の指示に分量ノルマを入れるな

段落数・文数・段落あたり字数のノルマを very_long の指示へ入れてはいけない。
フロアは一箇所（`lengthDirective` 本体とユーザー発言末尾の差し込み）だけに置く。

理由: ノルマは「何を書くか」を一つも与えんまま量だけ要求するので、モデルは手近な
小道具で埋める。2026-08-16 の実測では climax ターンの 13 段落が、鞄の紐・
コーヒーカップ・花びら型の栞・靴の中で丸まる爪先・窓の外の雲で埋まり、同じ文が
2 回そのまま出た。何を書くかは `buildPhaseBeatSheet` がキャラ自身の
【キャラクター性的特徴】のエスカレート連鎖から出す。

機構: `functions/api/__tests__/very-long-no-quota-directive.test.ts` が、組み立て済みの
指示全文に対して数量そのもの（`N段落以上/ずつ/を目安`、`N文`）を禁じる。綴り一致では
「16段落」を「16パラグラフ」へ書き換えるだけで抜けるので、数量で禁じる。

履歴: #1431 でノルマを入れ、2026-08-16 の通し読みで水増しの主因と判明して撤去した。
