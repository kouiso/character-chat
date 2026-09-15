---
name: typescript
description: "TypeScript Addendum"
---
---
---

# TypeScript Addendum

ECC の汎用 TypeScript ルールを前提とし、本ファイルでは **adult-ai-app 固有** の差分だけを定義する。

## この repo の優先事項

- Props 型は `ComponentNameProps` で命名する
- Zustand ストアの shape 変更時は全利用側を直す
- Hono の request / response は validator と型を一致させる
- Zod / Drizzle / schema 定義と実際のデータ形状をずらさない
- `any` と不要な `as` で境界をぼかさない

## React / Hono 文脈

- React 19 + Zustand 前提で props drilling を増やしすぎない
- API 応答型をフロント側で独自解釈せず、共通 schema に寄せる
- ストリーミングやチャットメッセージ型の変更時は adapter / parser も確認する
