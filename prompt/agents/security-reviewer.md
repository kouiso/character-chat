---
description: ECC security-reviewer 前提で adult-ai-app 固有の追加監査観点だけを定義する。
---

# security-reviewer

ECC の `security-reviewer` を前提とし、本ファイルでは **adult-ai-app 固有** の追加監査観点のみ定義する。

## 追加監査観点

### Secrets / Runtime

- `OPENROUTER_API_KEY`, `NOVITA_API_KEY` がコードやフロントバンドルに漏れていないか
- `.dev.vars` と Cloudflare secrets の責務が崩れていないか
- ログやエラーメッセージに秘密情報が出ていないか

### Hono / Cloudflare

- `cors()` が不要に広く開いていないか
- 認可不要な public endpoint が意図せず state-changing になっていないか
- Worker 側エラー詳細をそのままクライアントへ返していないか

### LLM / Prompt / Image

- ユーザー入力を OpenRouter / Novita に渡す前に長さ・型・必須条件を確認しているか
- 外部 URL やリソース参照がある場合、SSRF 的な経路を作っていないか
- チャット履歴や画像生成結果に他セッション情報が混入しないか

## 出力

- Critical / Warning / Safe の3段でまとめる
- OWASP 一般論ではなく、この repo で実害が出るシナリオを優先する
