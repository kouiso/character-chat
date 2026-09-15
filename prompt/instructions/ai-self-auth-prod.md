---
applyTo: "**"
---

# 本番/CF Access 認証は AI が自律でやる（ユーザに委ねない）

`kouiso@ritmo.co.jp` を CF Access のポリシー(allow-team)に追加済み。以降:

NEVER ユーザに本番ログイン・CF Access 認証・1Password 入力を依頼する
WHEN adult-ai-app の本番/ダッシュボード/CF Access 検証で認証が要る
BECAUSE 認証情報は 1Password (op CLI, RITMO vault) から AI 自身が取得でき、CF Access も
kouiso@ritmo.co.jp で通る。ユーザ委任は Zero User Burden 違反。

## 手順
- `op item get <ID> --vault RITMO --fields <field> --reveal` で取得（値は画面に出さない、長さのみ報告）。
- CF Access: サービストークン（`.prod-verify.vars` の CF_ACCESS_CLIENT_ID/SECRET）or kouiso 認証で通す。
- 本番検証は `pnpm verify:prod` / `verify:prod:browser`。
- 取得値は同ターンの consumer に直接渡し、export もログ出力もしない。
