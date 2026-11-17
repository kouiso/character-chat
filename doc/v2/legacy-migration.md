# 旧データの移行（RIT-77・RIT-78）

旧 `conversation` / `message` を残し、同じIDで `v2_conversation` / `v2_message` に取り込む。元のタイトル・本文・日時を保持する。表示順は旧表の `created_at, rowid` に従い、`system` を除く発言を 1 発言 1 番号にする（挨拶や連続する assistant 発言も個別の番号）。新しい送信は最大番号の次へ保存する。

取り込みの記録は台帳 `v2_legacy_import` に残す。主キーは `(legacy_table, legacy_id)`、`v2_id`・`conversation_id`・`source_user_id`・`target_user_id`・`content_hash`・`imported_at` を持ち、`(conversation_id, legacy_table)` に索引 `v2_legacy_import_conversation_idx` がある。v2 側の行へ外部キーは張らないので、v2 で消した行と「まだ移していない」行を見分けられる。台帳の行は `onConflictDoNothing` で足すだけで書き換えない。

一度に一つの会話を D1 batch で確定する（v2 会話の挿入・発言の挿入・台帳の行・`image_key` の補完・題名/更新日時/移行元の合わせ直しを 1 batch にまとめる）。中断後の再実行は移行済み行を ID・番号・本文・日時・役割で照合する。照合が合わん会話は上書きせず飛ばし、他の会話の移行は続ける。飛ばした会話は `failures` に会話 ID と符号（`source_owner_mismatch`・`destination_conflict`・`source_changed`・`source_deleted`・`source_conversation_deleted`・`source_owner_unknown`・`write_failed`）を入れて返す。

- v2 で消した会話・発言（台帳の行が在って v2 の行が無い物）は戻さない（`skippedDeletedConversations`・`skippedDeletedMessages`）。
- v2 で続けた後の旧発言（新しい旧発言の最も若い番号が v2 の番号の最大以下）は写さず台帳も書かない（`skippedAfterV2Continue`）。
- 台帳の無い頃に移した会話は、一致した番号の最大 N（v2 が |M| 以下で書いた番号も数える）までの「v2 に無い旧発言」を v2 で消した物と見なして台帳だけ埋める。N 以下で v2 に在って旧に無い行は、その番号が `v2_ledger` に在れば作り直しの行として飲む。
- 切替中は旧側の書き込みを止めて最終差分を取り込む必要がある。

元の画像・生成情報・枝分かれ・記憶は旧表に残る。画像は同じメッセージIDで参照し、所有者を確認したサーバールートがR2から返す。旧状態の新しい記憶形式への変換はRIT-78で別に検証する。

## 受け口 `POST /api/admin/legacy-migration`

`mode` は 1 つだけ。`sources`・`conversations`・`verify-conversations`（RIT-77）に RIT-78 が `memory`・`corpus`・`verify-memory`・`verify-corpus` を足した。利用者は札 `local` または `owner-<SHA-256 の先頭 8 桁>` で指定し、応答に利用者 ID・本文・題名は出さない。

- `conversations` は `apply` を付けなければ確認だけ、`apply: true` では `expected`（確認だけで見た `insertedConversations`・`insertedMessages`）が必須で、計画と違えば何も書かず 409 `plan_changed`。
- `memory` も同じ構え。`expected` は `{ insertedMemories }`（新しく入れる v2_memory の件数）。D1 の行を確定してから、まだ埋めていない記憶を 1 件ずつ 埋める → Vectorize へ入れる → embedding を D1 へ書き戻す。途中の失敗は `index_failed` としてその 1 件だけ `failures` へ入れて続く。検索箱が使えなければ apply は 503 `vector_unavailable`。
- `corpus` の `expected` は `{ chunks }`（そのページの塊の件数）。塊は 1 件ずつ bge-m3 で埋め直し、`legacy-rag-<旧の id>`・区画 `legacy-corpus`・metadata `source:"rag_chunk"`/`type`/`phase`/`character_id` で入れる。同じ id なので繰り返しても増えない。
- `verify-memory` はメモ 1 件ずつ `match`・`edited_in_v2`・`deleted_in_v2`・`not_imported`・`skipped`・`source_changed`・`not_indexed` を返す。`search: true` を付けると `match` の記憶だけを検索箱を通る道（固定の道は通らない）で実際に引き、`retrievable` を返す。search の時は 1 ページ 10 件まで。
- `verify-corpus` はそのページの `legacy-rag-<id>` を `getByIds` で引き、無い id を `missingIds` に返す。
- ページは旧 `conversation.id`・`memory_note.id`・`rag_chunk.id` の昇順で `limit` 件（conversations 既定 5・memory/corpus 既定 10・最大 20）。`cursor` は前のページの最後の id。
- `verify-conversations` は会話ごとに `match`・`not_imported`・`deleted_in_v2`・`mismatch` を返し、何も書かない。

## 旧記憶メモと検索の塊（RIT-78）

旧 `memory_note` は 1 件につき `v2_memory`（id `legacy-mn-<旧の id>`・kind `fact`・pinned 0）・`v2_memory_source`（importance 3）・台帳の 3 行に写す。`[auto] ` で始まる本文は頭の印だけ剥がす。写す先の会話は ①`source_message_id` が v2_message に解けて会話が持ち主×同じキャラならその会話（出どころはその発言、assistant ならそれ以前の起きている自分の発言の最大）②同じ `legacy_source_user_id` の会話のうち更新が最新 ③同じキャラの会話の最新。会話が無ければ `skippedNoConversation`、自分の発言が無ければ `skippedNoUserMessage`。別の利用者・別のキャラの会話には付かない。

台帳に行が在って v2_memory が無い物は v2 で消した印（`skippedDeletedInV2`）、同じ会話・同じ本文の消した印（`v2_memory_tombstone`）が在る物は `skippedTombstoned`、どちらも戻さない。旧の本文が台帳のハッシュと違う物は `source_changed` の failure で v2 を変えない。v2 で書き換えられた記憶は取り込み直しで上書きしない。台帳の無い頃に写した記憶は台帳と出どころの行を補う。旧表は 1 行も変えない。

旧 `rag_chunk` は全件を bge-m3 で埋め直し、`legacy-corpus` 区画へ入れる。会話の検索は記憶の区画だけを見るので、コーパスの物は応答の検索には 1 件も現れない。

## 流す道具

```sh
node apps/v2/script/run-legacy-migration.mjs <URL> [--mode conversations|memory|corpus] \
  [--source-owner <札>] [--out <確認だけの結果.json>] \
  [--apply --expected-file <確認だけの結果.json>] [--verify] [--search] [--limit N]
```

`--source-owner` は conversations・memory の時に要る（corpus は共有なので要らない）。`--verify` は mode に対応する verify（conversations→verify-conversations・memory→verify-memory・corpus→verify-corpus）を全ページ流す。`--search` は verify-memory で retrievable の検査を点ける。`--apply` の後の `--verify` は検索箱の反映を待って 60 秒後に流し、retrievable が偽の物が残れば 60 秒おきに 2 回まで流し直す。

認証は RIT-80 と同じ名前: `V2_BASIC_USER`/`V2_BASIC_PASSWORD`（Basic）か `CF_ACCESS_CLIENT_ID`/`CF_ACCESS_CLIENT_SECRET`（Access）。1 ページずつ送る。`--apply` で 409 を受けたら止まって確認だけからやり直す（書けたページは残る）。検索箱が使えなければ「検索箱が使えません（V2_RAG_ENABLED と束ねを確かめてください）」と出て終了コード 1。終了コードは `failures` が 0 で、`--verify` の時は `not_imported`・`mismatch`・`source_changed`・`not_indexed`・missing・retrievable 偽が全部 0 の時だけ 0。

## 本番へ書く時の順番

台帳の migration、確認だけ、`apply`、`verify-conversations` はどれも持ち主の許可の後。順番:

1. RIT-68 の棚卸し → RIT-75 で D1 を書き出して復元練習 → 台帳の migration を当てる（持ち主の許可）。
2. `sources` → 確認だけを全ページ → 合計を票のコメントに貼る → 持ち主の「書いてよい」→ `--apply` → `--verify` → 棚卸しをもう一度取り `--diff` → RIT-80 の `image-check`。
3. **会話を消す入口（kouiso/character-chat#171・RIT-171 系）を本番へ出す前に、台帳を持つ取り込みの適用を必ず先に終える。** 台帳が無いうちに v2 で会話が消えると、再実行で「v2 で消した物」と「まだ移していない物」を見分けられず、消したはずの会話が復活する。
4. `--apply` から 7 日以内に `--verify` と RIT-45 の「親として確かめる事」1〜8 を終える（D1 を書く前の点へ戻せるのは 7 日前まで）。

## ローカルの復元コピーで実行

事前にRIT-75の手順でD1を復元する。以下はローカル限定で、`CF_REMOTE=1`は拒否される。

```sh
pnpm --filter @v2/cf migrate:legacy --persist-root /absolute/path/to/restored-d1 --target-user local
pnpm --filter @v2/cf migrate:legacy --persist-root /absolute/path/to/restored-d1 --target-user local --apply
```

`--apply` なしは確認だけ。要確認の会話は `failures` に会話 ID と符号で出し、終了コード 1 で終える。元の利用者が複数いる場合は `--source-user` を明示する。異なる所有者を自動で統合しない。`target-user=local`は個人用BASIC認証の所有者に対応する。

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

## 移行後の全件検査（RIT-80）

移したキャラと画像が「居る」だけでなく「使える」かを、読み取り専用の検査APIで確かめる。検査は何度呼んでも D1・R2 を変えない。

- `GET /api/admin/character-check?limit=10&cursor=...` — キャラ全件を1件ずつ。見えるか・公開か・顔の絵の状態（`unset`/`bundled`/`r2`/`missing`/`not_image`/`bad_key`）・Zod検査の合否と場所・持ち主として読めるか・書けるかを返す。`limit` は 10 が標準で最大 25。`nextCursor` が null になるまでめくる。
- `GET /api/admin/image-check?limit=10&cursor=...` — 自分の会話に出る画像のキー（v2・旧の両方）が R2 に在るかを `ok`/`missing`/`empty`/`bad_key` で返す。
- `GET /api/characters/<id>/avatar` — キャラの顔の絵を返す。同梱 `public/avatars/` → R2 `avatars/` → 旧 R2 キーの順で探し、中身が画像かをバイト列で見て返す。見える・公開されたキャラだけ応答する。

全件を最後のページまで検査するには同梱のスクリプトを使う。不合格が1件でも在れば終了コード1で、合計と不合格の一覧を `.work/report/` へ Markdown で残す。

```sh
# BASIC 認証
V2_BASIC_USER=... V2_BASIC_PASSWORD=... \
  node apps/v2/script/verify-character-check.mjs https://adult-ai-v2-staging.kouiso.workers.dev

# Cloudflare Access（サービストークン）
CF_ACCESS_CLIENT_ID=... CF_ACCESS_CLIENT_SECRET=... \
  node apps/v2/script/verify-character-check.mjs https://adult-ai-v2-staging.kouiso.workers.dev
```

ローカルの復元コピー（上の `V2_LOCAL_PERSIST_ROOT` で起動した開発サーバー）にも同じ手順で向けられる。認証が通らなければ「認証の値を確かめてください」と出て終了コード1。応答が失敗したページは同じページをもう一度だけ呼び直す。
