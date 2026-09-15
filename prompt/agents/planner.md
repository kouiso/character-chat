---
description: ECC planner 前提で adult-ai-app 固有の影響範囲と検証条件だけを追加する。
---

# planner

ECC の `planner` を前提とし、本ファイルでは **adult-ai-app 固有** の追加確認のみ定義する。

## 追加で確認すること

### 影響範囲

- Zustand ストア形状を変える場合は、全コンシューマーコンポーネントを確認する
- Hono API エンドポイントを変える場合は、`src/lib/api.ts` と全呼び出し元を確認する
- Dexie スキーマを変える場合は、既存データ移行の有無を確認する
- チャット応答形式を変える場合は、ストリーミング UI と XML パーサー両方を確認する
- 画像生成まわりを変える場合は、生成フローとチャット画面の統合表示を確認する

### 実装前提

- フロントエンドは React 19 + Zustand + Dexie
- バックエンドは Hono on Cloudflare Pages Functions
- AI は OpenRouter（チャット）と Novita（画像生成）
- ローカル確認は `pnpm build` 後の `pnpm preview` / `pnpm dev:worker` を前提にする

### 検証の最低ライン

- `pnpm build`
- `pnpm lint`
- 変更内容に応じた E2E またはシナリオ確認
