# Secrets — 1Password ありか一覧

機密値はリポジトリに置かない。`.dev.vars` / 本番 `wrangler pages secret` に入れる値は、すべて 1Password から取得する。

取得方法（サービスアカウント or 個人アカウントで `op` 認証済みの前提）:

```bash
op item get <ITEM_ID> --vault <VAULT> --fields <FIELD> --reveal
```

## 一覧

| 用途 | 環境変数 | 1Password Item ID | Vault | フィールド |
|---|---|---|---|---|
| Cloudflare R2（アバター等のオブジェクト読み書き） | `CLOUDFLARE_API_TOKEN` | `cyva4yddtmsfvjxm5hbym75loa` | RITMO | `password` |
| 同上・R2 S3 互換アクセスキー | （S3 client 用） | `cyva4yddtmsfvjxm5hbym75loa` | RITMO | `アクセスキー` |
| 同上・R2 S3 互換シークレット | （S3 client 用） | `cyva4yddtmsfvjxm5hbym75loa` | RITMO | `シークレットアクセスキー` |
| 同上・R2 S3 エンドポイント URL | （S3 client 用） | `cyva4yddtmsfvjxm5hbym75loa` | RITMO | `URL` |
| OpenRouter（チャット生成） | `OPENROUTER_API_KEY` | `btrffvnud4emiktpdztkiwf3ua` | RITMO | （item 参照） |
| Novita（画像生成） | `NOVITA_API_KEY` | `a2pfh6g6cp664svpxvsq2iycia` | RITMO | （item 参照） |
| Runware（画像生成 fallback） | `RUNWARE_API_KEY` | `xt4ttufzkvqto3rxretj333cjq` | RITMO | （item 参照） |
| AtlasCloud（動画生成） | `ATLASCLOUD_API_KEY` | `chkr72wmvxan5nipt7ldpy37re` | a2z | （item 参照） |
| git-crypt 鍵 | — | `wqeabpnn6uicz5uweub2gad2ka` | RITMO | （item 参照） |

## Cloudflare R2 トークンの権限
- `Workers R2 Storage : Edit` / アカウント全体 / 無期限（2026-06-13 発行）。
- account_id: `6e206506efda3871a2d6e81da38b4b0b`、bucket: `adult-ai-images`。
- wrangler は `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` で R2 を操作する。

## 注意
- このファイルには **値を書かない**。ID と取得方法のポインタのみ。
- `.dev.vars` は gitignore 済み。コミットしない。
