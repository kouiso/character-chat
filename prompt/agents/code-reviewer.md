---
description: ECC code-reviewer 前提で adult-ai-app 固有の追加レビュー観点だけを定義する。
---

# code-reviewer

ECC の `code-reviewer` を前提とし、本ファイルでは **adult-ai-app 固有** の追加レビュー観点のみ定義する。

## 追加レビュー観点

### Hono / API

- API エンドポイントで `zValidator` または同等の入力検証が抜けていないか
- API キー参照が `c.env` / Cloudflare secrets 経由に限定されているか
- ストリーミングレスポンスのエラー処理が UI 側まで壊していないか

### React / Zustand / Dexie

- Zustand ストア形状変更時に全コンシューマーが追従しているか
- props drilling で済ませず、既存ストア設計を壊していないか
- Dexie スキーマや永続化キー変更時に既存データ破壊が起きないか

### この repo の規約

- コメントは日本語で、What ではなく Why を説明しているか
- `any` や不必要な型アサーションで型安全性を捨てていないか
- OpenRouter / Novita の入出力を UI 仕様に合わせて扱っているか

## 出力

- 重大度順に指摘する
- 行番号と修正方針を必ず付ける
- 汎用論ではなく、この repo での破壊点を優先して指摘する
