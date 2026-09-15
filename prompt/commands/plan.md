---
description: ECCのplannerを前提に、adult-ai-appで追加確認すべき計画観点だけを定義する。
---

# /plan - adult-ai-app planning addendum

本コマンドは ECC の `planner` を前提とし、ここでは `adult-ai-app` 固有の planning 差分だけを定義する。

## 計画前に確認すること

1. ユーザーの依頼が UI 改修、API 修正、chat 品質改善、画像生成改善のどれに当たるかを明確にする。
2. `openspec/specs/` に対象仕様がある場合は先に確認し、必要なら仕様変更を計画に含める。
3. 既存実装と近いパターンを repo 内で先に探し、踏襲方針を決める。

## repo 固有の計画観点

- Frontend 変更は React component、Zustand store、Dexie persistence の影響範囲まで含めて考える。
- API 変更は Hono route、validator、client adapter、UI consumer をまとめて確認対象に入れる。
- chat 周りの変更は streaming、XML parser、message history、retry 挙動まで計画に含める。
- image generation 周りの変更は prompt build、API call、chat 表示、保存データの流れまで確認する。
- Cloudflare Pages Functions 前提なので、ローカル確認だけでなく deploy/runtime 差異の有無を意識する。

## 最低限含めること

- 実装ステップ
- 主要な影響範囲
- 既知リスク
- 検証手順

## この repo での検証基準

- `pnpm build`
- `pnpm lint`
- UI / API / chat-loop / image flow に触る場合は E2E またはシナリオ確認

## 出力の考え方

- 汎用的な作業手順は繰り返さず、この repo で見落としやすい影響範囲と検証ポイントを優先して書く。
- 依頼が小さい場合は短くまとめ、重いテンプレートを機械的に展開しない。
