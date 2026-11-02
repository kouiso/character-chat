# 評価コーパスは本番 D1（adult-ai-db）に入っているか

調査日: 2026-10-31〜11-02 ／ 方法: 読み取り専用（SELECT と PRAGMA のみ。書き込み・削除・デプロイなし）

## 結論

**入っていない。** `kouiso/character-chat-corpus` の `.work/e2e-results`（1,871 ファイル）は、
本番 D1 `adult-ai-db` に保存されていない。抽出した 20 ファイルのうち、名前でも本文でも一致したのは 0 件。

この文書には成人向けの本文を載せない。名前と件数だけを書く。

## 対象

| 対象 | 値 |
|---|---|
| コーパス | `kouiso/character-chat-corpus` HEAD `6f4e873`。`.work` に 1,908 ファイル、うち `.work/e2e-results` が 1,871（約 10.7 MB） |
| `e2e-results` の内訳 | `vlong-dogfood` 1,840 ／ `bench-runs` 11 ／ `dogfood-*` 3 フォルダ計 6 ／ `923-outfit-vocabulary` 2 ／ `downer-img2img-canonical` 1 ／ 直下 11 |
| 拡張子 | `.txt` 1,768 ／ `.json` 96 ／ `.md` 6 ／ `.sql` 1 |
| D1 | アカウントには 3 つ（`adult-ai-db`、`character-chat-v2-staging`、`emdash-trial-20261021-db`） |
| `adult-ai-db` | 4,112,384 バイト、47 テーブル。`_cf_KV` は Cloudflare 内部テーブルで読めない（SQLITE_AUTH） |

## adult-ai-db の行数（2026-10-31 時点）

0 行でないテーブル:

| テーブル | 行数 |
|---|---|
| quality_measurement | 3,234 |
| usage_log | 2,777 |
| streaming_chunk | 261 |
| character_default_outfit_tag | 260 |
| character | 223 |
| message | 210 |
| character_visual | 155 |
| d1_migrations | 98 |
| image_review | 98 |
| character_sub_image | 72 |
| character_prompt_version | 70 |
| image_review_criterion | 60 |
| request_counter | 60 |
| conversation | 47 |
| quality_report_dedup | 44 |
| rag_chunk | 36 |
| character_distinctive_mark | 16 |
| scene_location_tag | 8 |
| prompt_variant | 5 |
| character_undress_progression | 4 |
| conversation_scene_state | 4 |
| sqlite_sequence | 4 |
| user | 3 |
| scene_location | 1 |

0 行のテーブル（22）: `character_scene_default`, `chat_group`, `comic`, `comic_panel`,
`conversation_scene_body_fluid`, `conversation_share`, `group_message`, `memory_note`,
`message_feedback`, `promotion_log`, `rag_embedding_cache`, `review_image_rating`, `scene_bookmark`,
`v2_chunk`, `v2_conversation`, `v2_generation`, `v2_ledger`, `v2_memory`, `v2_message`,
`wardrobe_outfit`, `wardrobe_outfit_occasion`, `wardrobe_outfit_tag`

ファイル名やパスを持つ列は、どのテーブルにも無い。

## 照合

| 確認 | 結果 |
|---|---|
| 件数と容量 | コーパス 1,871 ファイル・約 10.7 MB に対し、D1 全体で 4.1 MB。全量は物理的に入らん |
| 20 ファイル抽出: ファイル名 | 0 / 20 |
| 20 ファイル抽出: 実行 ID | 0 / 20 |
| 20 ファイル抽出: 本文の断片（計 59 個） | 0 / 59。本文を持ちうる 16 テーブル（message、streaming_chunk、rag_chunk、conversation、quality_measurement、prompt_variant、quality_report_dedup、usage_log、character、character_prompt_version、image_review、image_review_criterion、character_sub_image、request_counter、scene_location、user）のテキスト列を `instr()` で検索 |
| 残りの行ありテーブル 8 つ（タグ・設定・マイグレーション系） | 実行 ID 20・ファイル名 3・本文断片 3 の計 24 個で 0 / 24 |
| 陽性対照（既存の message 本文から取った断片を同じ式で検索） | 1 件一致。照合式が日本語で機能しとることを確認 |
| 逆方向: コーパス期間（8/16〜22）の D1 メッセージ 66 件から 47 断片を取り、コーパスを grep | 3 件一致。2 件はキャラの挨拶文（全会話に共通）、1 件は短い定型句。同じメッセージの別の 4 断片は 0 件。実ユーザーの会話であり、評価データやない |
| 実行先 | `vlong-dogfood` の summary 81 件すべてが `baseUrl` = `http://127.0.0.1:<port>`。`package.json` の `dev:worker` は `wrangler pages dev ... --local` なので、書き込み先はローカルの D1 |

抽出は `random.seed(20261031)` でソート済みファイル一覧から 20 件。結果的に全件が `vlong-dogfood`（全体の 98%）から出た。
残り 31 ファイルは個別に確認した。

- `bench-runs`（11）: summary に本番パイプラインを通さん旨の注記がある。実行時刻 ±1 時間の D1 は quality_measurement・message とも 0 行
- 直下の A/B 系 JSON（11）: `baseUrl` を持たん集計ファイル
- `923-outfit-vocabulary/repair-prod.sql`: 評価データやのうて修復 SQL。旧タグが D1 に残り、新タグは 0 行なので本番へは未適用
- `dogfood-*`（6）と `downer-img2img-canonical`（1）: 下の「未確認」を参照

## 紛らわしいもの: quality_measurement

モデルはコーパスと同じ 3 種（deepseek-chat、qwen-2.5-72b、euryale-70b）で、コーパス期間に 421 行ある。だがコーパスの評価結果やない。

- 421 行すべて `message_id` が NULL で、どのメッセージとも結べない
- 量が合わん。8/18 は D1 が 8 行、コーパスの同日フォルダは 547 記録
- フェーズが合わん。D1 の intimate 生成は期間全体で 4、コーパスは 487

## 敵対レビュー

この session では Codex MCP が使えんかったため、独立したエージェントに「結論は誤り」を既定にして反証させた。

- 6 通りの攻撃（未検索テーブル、本番への書き込み有無、quality_measurement のスコア、抽出の偏り、修復 SQL、エスケープと文字コード）はすべて結論を崩せんかった
- 指摘 1 件を採用: 最初の照合は 16 テーブルだけで、行を持つ 8 テーブルが未検索やった。追加で検索して 0 / 24。残る 22 テーブルは 0 行。結論は変わらん
- 最も強い根拠（summary 81 件すべてが localhost）は、こちらで再確認した

## 未確認

- `dogfood-1781902*` 3 フォルダ（6 ファイル）と `downer-img2img-canonical`（1 ファイル）は D1 と直接照合していない。dogfood の実行 ID から見た日付は 2026-06-19 で、逆方向照合の期間外
- R2 と KV は今回の範囲外

## 再現手順

1. Cloudflare の D1 ツールで `adult-ai-db` に `SELECT name FROM sqlite_master WHERE type='table'` を流し、各テーブルを `COUNT(*)` する
2. コーパスをクローンし、`find .work/e2e-results -type f | wc -l` で 1,871 を確認する
3. `grep -rhoE '"baseUrl": *"[^"]*"' .work/e2e-results/vlong-dogfood | sort | uniq -c` で 81 件すべてが `127.0.0.1` であることを確認する
4. 上の seed で 20 件抽出し、名前・実行 ID・本文断片を `json_each` 経由で `instr()` 検索する。陽性対照を同じクエリに含める
