---
name: autonomous-execution
description: "Autonomous Execution Addendum"
---
---
---

# Autonomous Execution Addendum

ECC とグローバル共通ルールを前提とし、本ファイルでは **adult-ai-app 固有** の自走条件だけを定義する。

## 着手前に確認すること

- 本質的目的が UI 改修なのか API 改修なのか、チャット品質改善なのかを明確にする
- 変更がフロント、Worker、ストア、永続化のどこに波及するかを見積もる

## この repo の自走ライン

- 質問前に `package.json`, `wrangler.toml`, 関連 store / api / schema を確認する
- 実装後は最低でも `pnpm build` と `pnpm lint` で壊れていないことを確認する
- UI / API / チャットループ変更時は、可能な範囲で E2E かシナリオ確認まで進める

## 自動で疑うべき影響範囲

- ストア変更 → 全 consumer
- API 変更 → `src/lib/api.ts` と全 caller
- schema / parser 変更 → adapter / 表示層 / persistence
- モデルや画像生成フロー変更 → settings / chat view / quality guard
