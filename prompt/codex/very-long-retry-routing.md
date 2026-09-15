# Codex 実行プロンプト：very_long retry モデル選択の回帰テスト

## タスク概要

Sakura/Downer の `very_long` 応答で、リトライ時に `qwen/qwen-2.5-72b-instruct` へフォールバックすると 1300 visible 文字を下回る問題があった。本タスクでは、`functions/api/lib/route-context.ts` の `selectQualityRetryModel` と `functions/api/[[route]].ts` のリトライ経路を、**LLM を呼ばずに**網羅的に検証する unit test を追加する。

## スコープ（ノンアダルト）

- `selectQualityRetryModel` の返り値を、各種入力（`originalModel`, `currentModel`, `category`, `isVeryLongResponse`）に対して assertion する。
- `[[route]].ts` の refusal / consent / apology リトライ時の `refusalRetryModel` 決定ロジックを、直接 import または同等のヘルパーに切り出してテストする。
- テスト中に実際の LLM や NSFW コンテンツは生成しない。入力は文字列定数、出力はモデル ID のみ。

## 受け入れ条件

- [ ] `selectQualityRetryModel` の unit test が追加され、`pnpm test` で pass すること
- [ ] `very_long` かつ `currentModel` が `EROTIC_CHAT_MODEL` または `EURYALE_CHAT_MODEL` の場合、qwen 系（`DEFAULT_CHAT_MODEL`）には戻らないことをカバーするケースがあること
- [ ] `consent`/`apology` リトライでも `isVeryLongResponse === true` のとき `selectQualityRetryModel` を通ることをテストすること
- [ ] テストファイルに `any` / `@ts-ignore` / `eslint-disable` が含まれないこと
- [ ] `pnpm lint` および `pnpm test` および `pnpm typecheck` が全 green であること

## 実装指針

1. `functions/api/lib/route-context.ts` 内の `selectQualityRetryModel` は既に純粋関数として切り出されているので、それを export したままテストから import する。
2. `[[route]].ts` の `refusalRetryModel` 計算ブロックを抽出する場合は、同じ型の小さなヘルパー関数に切り出し、route handler から呼び出すこと（diff を最小に）。
3. テストは `functions/api/__tests__/route-context.test.ts` または近いディレクトリに配置し、既存の Vitest 設定に従うこと。
4. 定数は `src/lib/model.ts` / 同ファイルのものを import して使うこと。ハードコーディング禁止。

## 動作確認コマンド

```bash
pnpm test functions/api/__tests__/very-long-retry-routing.test.ts
pnpm lint
pnpm typecheck
```

## 備考

- 本タスクはコードの回帰防止を目的とした技術作業であり、NSFW コンテンツの生成・評価は含まない。
- PR 作成時は `Closes #1408` を本文に含めること。PBI は #1407 となる。
- 既存の `pnpm lint` / `pnpm test` / `pnpm typecheck` を通すまで修正を続けること。
