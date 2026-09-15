---
description: ECC security-reviewer を前提に、adult-ai-app 固有の確認項目だけで監査する。
---

# /security-check - adult-ai-app Security Addendum

ECC の `security-reviewer` を前提とし、本コマンドでは **adult-ai-app 固有** の追加確認だけを行う。

## 優先チェック

- `OPENROUTER_API_KEY`, `NOVITA_API_KEY` がコード・ログ・レスポンスに漏れていない
- `.dev.vars` と Cloudflare secrets の使い分けが崩れていない
- Hono の `cors()` が本番で広すぎない
- 全 API エンドポイントで入力検証が適用されている
- フロントエンドバンドルに secret や内部 URL が混入していない
- OpenRouter / Novita に未検証の入力をそのまま渡していない
- ストリーミング失敗時に内部エラー詳細を露出していない

## 検証の最低ライン

- secret 文字列の grep
- API 入口のバリデーション確認
- CORS と env 参照箇所の確認
- 必要なら `pnpm build` でバンドル側の漏洩確認

## 出力

- Critical / High / Medium の順で報告
- 各指摘に攻撃シナリオと修正方針を付ける
