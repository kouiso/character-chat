# 旧会話の移行（RIT-77）

旧 `conversation` / `message` を残し、同じIDで `v2_conversation` / `v2_message` に取り込む。元のタイトル・本文・日時を保持する。表示順は旧表の `created_at, rowid` に従い、挨拶や連続するassistant発言も個別のターン番号にする。新しい送信は最大番号の次へ保存する。

一度に一つの会話をD1 batchで確定する。中断後の再実行は移行済み行をID・本文・日時・役割・番号で照合する。変更を見つけた場合やv2で進んだ会話と新規の旧発言が衝突する場合は、上書きせず停止する。切替中は旧側の書き込みを止めて最終差分を取り込む必要がある。

元の画像・生成情報・枝分かれ・記憶は旧表に残る。画像は同じメッセージIDで参照し、所有者を確認したサーバールートがR2から返す。旧状態の新しい記憶形式への変換はRIT-78で別に検証する。

## ローカルの復元コピーで実行

事前にRIT-75の手順でD1を復元する。以下はローカル限定で、`CF_REMOTE=1`は拒否される。

```sh
pnpm --filter @v2/cf migrate:legacy --persist-root /absolute/path/to/restored-d1 --target-user local
pnpm --filter @v2/cf migrate:legacy --persist-root /absolute/path/to/restored-d1 --target-user local --apply
```

元の利用者が複数いる場合は `--source-user` を明示する。異なる所有者を自動で統合しない。`target-user=local`は個人用BASIC認証の所有者に対応する。

```sh
V2_LOCAL_PERSIST_ROOT=/absolute/path/to/restored-d1 pnpm --filter @v2/app dev
```

`V2_LOCAL_PERSIST_ROOT`は開発サーバーのローカル永続領域だけを変更する。実モデルを使わない検証では、git管理外の `.dev.vars` に `APP_ENV=test` と `V2_FAKE_MODEL=1` を設定する。

## 2026-10-26の検証

- 本番バックアップの復元コピーで47会話・210メッセージを移行。
- 再実行は追加会話0件・追加メッセージ0件。
- 全210メッセージのID・会話ID・役割・本文・日時が完全一致。
- 旧39テーブルに変更なし。19件の画像参照を保持。
- 223キャラクターすべてが既存のZod検査を通過。
- 復元コピーをworkerdで起動し、実ブラウザから全47会話を開いて続きの発言を送信。全件で以前の履歴を保持して1ターン追加、pageerror=0。固定モデルを使用し実AIの品質評価は含まない。
- 中断後の再開、連続assistant発言、元データ変更の検出、他所有者の画像参照拒否はローカルD1テストで検証。

本番には未適用。R2実オブジェクトの全件存在検査と本番での並行運用期間は別の完了条件である。
