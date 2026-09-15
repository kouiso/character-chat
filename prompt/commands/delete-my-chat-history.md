# /delete-my-chat-history

自分のチャット履歴（`sukererion@gmail.com`）を本番D1とR2から削除する。
`user` / `character` 行とキャラ画像（`avatars/` `sub/` prefix）は保全する。

## 実行手順

### Step 1: dry-run で削除予定件数を確認

```bash
bash script/maintenance/delete-my-chat-history.sh --dry-run
```

削除件数とR2キー件数を表示する（破壊なし）。
問題なければ Step 2 へ進む。

### Step 2: バックアップ付き本実行

```bash
bash script/maintenance/delete-my-chat-history.sh
```

確認プロンプト `[y/N]` が出るので `y` を入力する。

処理内容:
1. D1フルバックアップ → `.work/backups/chat-history/<ts>/d1-full.sql`
2. 削除予定R2キーリスト → `.work/backups/chat-history/<ts>/r2-keys.txt`
3. R2オブジェクトをローカルにダウンロード → `.work/backups/chat-history/<ts>/r2/`
4. D1 から conversation/message/関連テーブルを順に DELETE
5. R2 から `images/` `videos/` のオブジェクトを削除
6. 削除後の件数を SELECT で再確認して報告

### オプション

| フラグ | 説明 |
|--------|------|
| `--dry-run` | 件数表示のみ（削除なし） |
| `--yes` | 確認プロンプトをスキップ |
| `--email addr` | 削除対象のuser_idを変更（デフォルト: `sukererion@gmail.com`） |
| `--skip-r2-backup` | R2ローカルバックアップをスキップ（高速化） |

pnpm エイリアス: `pnpm db:purge-my-chat [-- <flags>]`

## 削除対象テーブル（順序）

1. `memory_note`
2. `message_feedback`
3. `scene_bookmark`
4. `comic`
5. `quality_report_dedup`（conversation IN サブクエリ）
6. `conversation_scene_state`（同上）
7. `conversation_scene_body_fluid`（同上）
8. `message`
9. `conversation`

## 保全対象

- `user` 行・`character` 行・`character_sub_image` 行
- R2の `avatars/` `sub/` prefix（キャラ画像）
- `usage_log`（課金ログ）
- `group_message` / `chat_group`（未使用だが触らない）
