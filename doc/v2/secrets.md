# v2 の資格情報管理（RIT-61）

この文書は投入・入れ替え手順と検査の実装を扱う。本番への投入・入れ替えを実行した記録ではない。

## 名前と保管場所

v2 の実装で使う名前は `BASIC_AUTH_USERNAME`、`BASIC_AUTH_PASSWORD`、`OPENROUTER_API_KEY`。
チケットにある `BASIC_AUTH_USER/PASS` ではない。値は承認された RITMO の保管庫から取得する。
値をコード、Wrangler の `vars`、`VITE_` 変数、URL、ログ、PR、スクリーンショットへ入れない。
旧 Pages と v2 Worker は別の配備先で、片方の secret を変えても他方には反映されない。

## 投入・入れ替え

配備先の承認と、対象アカウント・Worker 名・環境の一致を先に確認する。
現在の v2 設定は開発用 D1 を指すため、この手順を理由に本番デプロイや D1 変更はしない。

```sh
pnpm --filter @v2/app exec wrangler whoami
pnpm --filter @v2/app exec wrangler secret list
pnpm --filter @v2/app exec wrangler secret put BASIC_AUTH_USERNAME
pnpm --filter @v2/app exec wrangler secret put BASIC_AUTH_PASSWORD
pnpm --filter @v2/app exec wrangler secret put OPENROUTER_API_KEY
```

値は `secret put` の対話入力へ渡す。コマンド引数・シェル履歴・端末への `echo` には書かない。
名前付き環境を使う場合は、承認済みの同じ `--env` を全コマンドに付ける。
`secret put` は Worker を更新する操作なので、確認だけのつもりで実行しない。
今回追加した検査とテストは secret の取得や書き換えを行わない。

パスワードの入れ替えは、新しい値を保管庫へ保存してから同じ名前の `secret put` で上書きする。
更新後は、対象環境の認証付きの非生成エンドポイントで、新しい値が通り旧値が 401 になることを確認する。
Basic 認証を記憶したブラウザとは別のクライアントで確認し、リクエストヘッダーや値は記録しない。
Worker は要求ごとに env を照合する。ローカルの入口テストで、入れ替え後の旧値拒否を検査する。
本番での反映確認は今回の実装スコープ外であり、このテストの成功とは区別する。

API キーも同じ名前の secret を上書きする。新キーの利用確認後に、提供元で旧キーを失効させる。
API の実呼び出しや有料利用には別途承認が必要。漏洩したキーへ戻す復旧はしない。
失敗した場合は漏洩していない値で復旧し、切り替え完了まで旧キーを使える状態と誤認しない。

## コミットと成果物の検査

```sh
pnpm verify:secrets
pnpm verify:secrets --artifact dist
pnpm verify:secrets --artifact apps/v2/dist
```

最初のコマンドは Git index 全体を読む。作業ファイルから消しただけで index に残るキーも検出する。
`.env`、`.env.*`、`.dev.vars`、派生バックアップ名、`.prod-verify.vars` はコミット不可。
`.env.example` と `.dev.vars.example` は名前だけ許可し、中身の検査は省略しない。
対応する内容検査は OpenRouter・Anthropic・GitHub のキー形式と、秘密鍵ヘッダーの後に32文字以上の Base64 本文が続く PEM 鍵マテリアル。ヘッダーだけの文字列は検出しない。
任意のパスワード、独自形式のトークン、分割・暗号化・エンコードした値を網羅する検査ではない。
成功は「資格情報が絶対に無い」という証明ではない。値の投入先を secrets に限定する運用も必要。

pre-commit と pre-push に同じ index 検査を接続する。CI では index と両アプリのビルド後の成果物を検査する。
成果物は隠しファイル・バイナリも読み、検査対象外へ出る symlink は拒否する。
指定した成果物が無い・読めない場合は失敗する。検出時はファイル名だけを表示し、本文やキーは表示しない。
Git の過去履歴は対象外。既に公開した値があれば、ファイル削除だけではなく失効・入れ替えが必要。

## 参照

- [Wrangler secrets コマンド](https://developers.cloudflare.com/workers/wrangler/commands/#secret)
- [Workers secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
- [RIT-61](https://linear.app/ritmo-inc/issue/RIT-61)
