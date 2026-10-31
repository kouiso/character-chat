# RIT-75 復元検証（2026-10-26）

本番D1のexportを非公開領域に保管し、独立したローカルD1へ復元した。
本番への復元・更新は実施していない。

- 元export SHA-256: `77b7701410d20f3d7adb73503e0f01b86d666c0f49ebdbd99702d11b111881d9`
- 45表の全行を型付きの値として正規化し、順序に依存しないSHA-256で比較。差異0表。
- 復元先 integrity_check: ok、foreign_key_check: 0件。
- exportを途中で切ったファイルは期待SHA-256との不一致で拒否。出力ファイルは作られない。
- `script/prepare-d1-restore.py` がSHA-256、元データ整合性、外部キーを検査後、D1で復元可能な挿入順を生成する。
- 以下は件数のみ。会話本文、資格情報、バックアップ本体を含まない。

| 表 | export | 復元先D1 | 全行ハッシュ |
| --- | ---: | ---: | --- |
| `character` | 223 | 223 | 一致 |
| `character_default_outfit_tag` | 260 | 260 | 一致 |
| `character_distinctive_mark` | 16 | 16 | 一致 |
| `character_prompt_version` | 70 | 70 | 一致 |
| `character_scene_default` | 0 | 0 | 一致 |
| `character_sub_image` | 72 | 72 | 一致 |
| `character_undress_progression` | 4 | 4 | 一致 |
| `character_visual` | 155 | 155 | 一致 |
| `chat_group` | 0 | 0 | 一致 |
| `comic` | 0 | 0 | 一致 |
| `comic_panel` | 0 | 0 | 一致 |
| `conversation` | 47 | 47 | 一致 |
| `conversation_scene_body_fluid` | 0 | 0 | 一致 |
| `conversation_scene_state` | 4 | 4 | 一致 |
| `conversation_share` | 0 | 0 | 一致 |
| `d1_migrations` | 98 | 98 | 一致 |
| `group_message` | 0 | 0 | 一致 |
| `image_review` | 98 | 98 | 一致 |
| `image_review_criterion` | 60 | 60 | 一致 |
| `memory_note` | 0 | 0 | 一致 |
| `message` | 210 | 210 | 一致 |
| `message_feedback` | 0 | 0 | 一致 |
| `promotion_log` | 0 | 0 | 一致 |
| `prompt_variant` | 5 | 5 | 一致 |
| `quality_measurement` | 3234 | 3234 | 一致 |
| `quality_report_dedup` | 44 | 44 | 一致 |
| `rag_chunk` | 36 | 36 | 一致 |
| `rag_embedding_cache` | 0 | 0 | 一致 |
| `request_counter` | 60 | 60 | 一致 |
| `review_image_rating` | 0 | 0 | 一致 |
| `scene_bookmark` | 0 | 0 | 一致 |
| `scene_location` | 1 | 1 | 一致 |
| `scene_location_tag` | 8 | 8 | 一致 |
| `streaming_chunk` | 261 | 261 | 一致 |
| `usage_log` | 2777 | 2777 | 一致 |
| `user` | 3 | 3 | 一致 |
| `v2_chunk` | 0 | 0 | 一致 |
| `v2_conversation` | 0 | 0 | 一致 |
| `v2_generation` | 0 | 0 | 一致 |
| `v2_ledger` | 0 | 0 | 一致 |
| `v2_memory` | 0 | 0 | 一致 |
| `v2_message` | 0 | 0 | 一致 |
| `wardrobe_outfit` | 0 | 0 | 一致 |
| `wardrobe_outfit_occasion` | 0 | 0 | 一致 |
| `wardrobe_outfit_tag` | 0 | 0 | 一致 |
