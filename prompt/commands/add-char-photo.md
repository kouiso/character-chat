---
description: Add sub-photos (pose/outfit variants) to an existing character — generate → verify → save to R2 + D1.
---

# /add-char-photo <char_id> [count] [theme]

既存キャラの **サブ写真**（別ポーズ・別衣装・別シーン等、同一キャラのバリエーション）を生成 → 検証 → R2+D1 保存まで一気通貫で実行する。

## v2 工程要件（正本: `prompt/instructions/char-approval-process.md`）

- **枚数**: ノーマル4枚以上＋エロ4枚以上（両方必須）を満たすまでがキャラ完成条件（工程③）。
- **重複禁止**: 体位・シチュ・文脈の重複禁止（NSFWに限らず）。生成前に既採用分の構図一覧と突き合わせる。
- **意図コメント必須**: 提示時は1枚ごとに「どういう意図で吐き出したか」を添える（作り直し時も毎回）。
- **審査員パネル事前評価**: 局長提示前に `prompt/agents/reviewer-panel.md` の**6レンズ**（同一性 / タッチ / 人体構造 / シチュ整合 / 性的表現 / 人格）で評価し、1枚ごとコメントに反映。安全性・倫理軸は禁止。レンズは `criterion_key` と1対1で、正典画像のピクセルを必ず各レンズへ渡す。
- **intent は必須**: 各候補へ `normal | erotic` を必ず設定する。`normal` は `sexual_expression` を合計から除外し、残り5軸を1.0へ正規化する。
- **集約はwriterを通す**: D1 へ書く前に `script/image-review/persist-panel-review.ts` へ6レンズの出力を渡す。内部で `aggregatePanelReview` を実行し、`ok:false` なら非ゼロ終了する。手組みの `ai_panel_json` / `image_review_criterion` を直接 INSERT せん。
- **既採用履歴を渡す**: 既定 `count=1` でも V-S を判定できるよう、同キャラの採用済み `ai_panel_json` から `acceptedHistory` を構築してwriter入力へ入れる。履歴を空配列で済ませてはならん（初回で本当に0件の場合だけ可）。
- **レンズの根拠は必須**: 各レンズは自分が見た箇所を文章で残す（`lensEvidence`）。1枚提出（既定 `count 1`）では、これが軸コピーを判定できる唯一の材料。欠けとったら集約が差し戻す。
- **審査レコードD1化**: 提示のたびに D1 `image_review` へ INSERT（label/round/intent_comment/ai_panel_json/image_model/seed/prompt、`verdict='pending'`）→ 採点のたびに同じ行を UPDATE（director_score/director_comment/verdict）。ローカル散在禁止。`image_review_criterion` へは6キーすべてを個別に書く（4軸で書いて割り戻すのは禁止）。
- **キャラ人格の厳守**: image_meta を必ずアンカーに使う（NULL なら先に /onboard-char 工程①へ戻る）。
- サブ画像完了後は工程④シナリオテスト（チャットE2E）へ。

## 引数

- `<char_id>` — 必須。既存キャラの D1 ID。
- `[count]` — 省略可（デフォルト 1）。生成枚数。
- `[theme]` — 省略可。例: `私服`, `水着`, `制服`, `添い寝`, `下着` 等。

## 前提

- `<char_id>` の行が D1 に存在し `avatar` を持つ（img2img の参照元）。
- wrangler auth 済（`pnpm exec wrangler whoami`）。

## 実行手順

1. **引数チェック**: `<char_id>` 未指定なら usage 表示で停止。

2. **前提確認**

   ```bash
   pnpm exec wrangler d1 execute adult-ai-db --remote \
     --command "SELECT id, name, avatar, image_meta FROM character WHERE id = '<char_id>' LIMIT 1"
   ```

   - `avatar` が NULL なら停止（img2img 参照元なし）。
   - `image_meta.appearance` を生成プロンプトのアンカーとして使う。

3. **生成（Novita API 直・決定モデル固定 — 局長指示 2026-07-12）**
   - モデルは `waiNSFWIllustrious_v90_1187991.safetensors` **固定**。他モデル・codex経由・macmini `$imagegen` 経由は使わない。
   - `NOVITA_API_KEY` は `.dev.vars` にある。参照画像（avatar）を R2 から取得して img2img、または image_meta.appearance をアンカーに txt2img。
   - **生成前に枚数と概算コストを局長に提示**してから実行する。
   - browser User-Agent 付与を忘れない（no-UA は Cloudflare 1010 で弾かれる — prohibitions.md）。

4. **生成結果の取得と検証**
   - `ssh macmini-lan 'ls -lh /tmp/sub-<char_id>-*.png'` → 各ファイル >1.5MB を確認
   - `scp macmini-lan:/tmp/sub-<char_id>-*.png /tmp/` でローカルに転送
   - **1枚目のみ** まず検証してから残り生成（偽コンポジット排除）
   - SendUserFile 提示前にラベルを確定（A→Z→AA… 単調増加）
   - キャプション形式: `【<char_name>】【<theme>】【ラベル X】`
   - codex vision による構図・キャラ一貫性・NSFW 度の主観評価を添える

5. **証跡の保存（合否より前・提示する全画像・1枚ずつ）**

   現物は `/tmp` にしか無い。合否が出るまで置いとくと、不合格の証跡が消える。
   **局長へ見せる前に R2 へ置き、実在を確かめてから D1 を書く。**

   ```bash
   # 既存の審査レコードから次のラベルと round を決める。
   # ラベルは A→Z→AA… の続き、作り直しは同じラベルで round+1。
   pnpm exec wrangler d1 execute adult-ai-db --remote \
     --command "SELECT label, round, r2_key FROM image_review \
       WHERE character_id = '<char_id>' ORDER BY id DESC LIMIT 20"

   # 審査プレフィックスへ put。PASS/FAIL に関係無く全部。
   # キーに round と一意値（seed か UNIXミリ秒）を入れる。日付＋ラベルだけだと
   # 同日再実行・作り直しラウンドで前の証跡を上書きして実体が消える。
   pnpm exec wrangler r2 object put \
     "adult-ai-images/review/<char_id>/<YYYYMMDD>-<ラベル>-r<round>-<seed>.jpg" \
     --file /tmp/sub-<char_id>-N.jpg \
     --content-type image/jpeg --remote

   # 置けたことを確認する。ここが通ってから D1 を書く。
   # --pipe が無いと本体が cwd 配下のファイルへ書き出され、worktree が汚れる。
   pnpm exec wrangler r2 object get \
     "adult-ai-images/review/<char_id>/<YYYYMMDD>-<ラベル>-r<round>-<seed>.jpg" \
     --remote --pipe | wc -c

   # V-S用に同キャラの「実際にギャラリーへ入った」パネル履歴だけを取得し、
   # panel-review-input.json の acceptedHistory へ復元する。初回以外で空にしてはならん。
   # verdict='pass' だけで絞ると、合格点やけど採用せんかった△画像が混じる。
   # △は工程7へ進めん＝ギャラリーに存在せんので、V-S の基準にしてはならん
   # （基準がギャラリー外の画像になり、後続候補が実在せん画像との差で veto される）。
   pnpm exec wrangler d1 execute adult-ai-db --remote --json \
     --command "SELECT ai_panel_json FROM image_review \
       WHERE character_id = '<char_id>' AND verdict = 'adopted' \
       AND ai_panel_json IS NOT NULL ORDER BY id"

   # panel-review-input.json には images[].panel.intent / lensEvidence(6軸) /
   # touchComparison(正典・候補各5項目) / trademarkComparison /
   # fatalAnatomyDefects / fatalIdentityDiscontinuities と acceptedHistory を入れる。
   # writerは集約、親行pending INSERT、6 criterion行INSERTを1回の実行にまとめる。
   # D1 は SQL の BEGIN を受け付けんので、wrangler が複文を渡す D1 batch に載せる。
   pnpm exec tsx script/image-review/persist-panel-review.ts \
     --input /tmp/panel-review-input.json --execute --remote

   # pHash 台帳登録（再提示防止。FAIL/不採用も rejected として登録）
   python3 scripts/avatar-pipeline/dedupe-check.py register \
     --label <ラベル> --date YYYY-MM-DD /tmp/sub-<char_id>-N.jpg
   ```

   - NEVER put を飛ばして `image_review` だけ書く。実体の無いキーが台帳に残る。
   - NEVER writerを飛ばして `image_review` / `image_review_criterion` を直接書く。
   - NEVER `/tmp` を証跡の置き場にする。macmini 側もローカルも再起動で消える。

6. **採点の記録（PASS/FAIL/△ すべて・採点を受けた瞬間に1枚ずつ）**

   工程5の行は `verdict='pending'` のまま残っとる。採点を受けたらここで必ず埋める。
   PASS だけの工程7に混ぜると FAIL と△の採点が記録されずに消える。

   `verdict` は3値で使い分ける。工程7（採用）まで進んだかどうかを表す。

   | verdict | 意味 | 工程7 | acceptedHistory |
   |---|---|---|---|
   | `adopted` | 合格点・△なし。工程7で採用した | 進む | 含める |
   | `pass` | 合格点やけど△付き。審査データとしてのみ保存 | 進まん | 含めん |
   | `fail` | 不合格。作り直し | 進まん | 含めん |

   ```bash
   pnpm exec wrangler d1 execute adult-ai-db --remote \
     --command "UPDATE image_review \
       SET director_score = <0-10>, director_comment = '<惜しい点>', \
           verdict = '<adopted|pass|fail>' \
       WHERE r2_key = 'review/<char_id>/<YYYYMMDD>-<ラベル>-r<round>-<seed>.jpg' \
         AND round = <round>"
   ```

   - △マーク付きは合格点でも `verdict='pass'` 止まりにし、工程7へは進めない
     （`character_sub_image` INSERT 禁止 — char-approval-process.md）。
   - NEVER △付きを `adopted` にする。工程5の acceptedHistory クエリがそれを拾い、
     ギャラリーに存在せん画像が V-S の基準になる。
   - NEVER 採点を受けたのに `pending` のまま次の画像へ進む。

   **この3値化より前に採点された既存行の扱い（キャラごとに1回だけ）**

   3値化より前は、採用した画像も△の画像もどちらも `verdict='pass'` で入っとる。
   そのままやと工程5の `verdict='adopted'` が0件を返し、V-S の基準が空になる。
   そのキャラで初めて工程5を回す前に、**ギャラリーに実在する画像の行だけ**を
   `adopted` へ上げる。判定は `character_sub_image` に現物があるかどうかで行い、
   点数やコメントからは推測せん。

   - NEVER `verdict='pass'` を一括で `adopted` へ書き換える（△が混ざる）。
   - NEVER 局長の確認なしに本番D1へ UPDATE を流す。対象行を先に SELECT で列挙して見せる。

7. **採用（局長PASSが出た画像だけ・PASSの瞬間に即実行）**

   ```bash
   # 表示用プレフィックスへ put
   pnpm exec wrangler r2 object put \
     "adult-ai-images/sub/<char_id>/<filename>.jpg" \
     --file /tmp/sub-<char_id>-N.jpg \
     --content-type image/jpeg --remote

   # D1 character_sub_image へ INSERT（次の ord）
   pnpm exec wrangler d1 execute adult-ai-db --remote \
     --command "INSERT INTO character_sub_image \
       (character_id, r2_key, ord, approval, image_model, image_provider) \
       VALUES ('<char_id>', 'sub/<char_id>/<filename>.jpg', <next_ord>, 'approved', '<model>', '<provider>')"

   # 採用が済んだ審査行だけを adopted へ上げる。これが acceptedHistory の唯一の入口。
   pnpm exec wrangler d1 execute adult-ai-db --remote \
     --command "UPDATE image_review SET verdict = 'adopted' \
       WHERE r2_key = 'review/<char_id>/<YYYYMMDD>-<ラベル>-r<round>-<seed>.jpg' \
         AND round = <round>"
   ```

8. **良質な生成物は seed 保存**（`seed-preservation` ルール準拠）
   `.work/seeds/images/YYYYMMDD-<char_id>-sub-<theme>.md` に記録:

   ```
   # シナリオ種別: サブ写真
   # キャラ: <name>
   # テーマ: <theme>
   # 評価: <主観スコア>
   ## 使用プロンプト
   [プロンプト全文]
   ## 何が良かったか
   [1〜3点]
   ```

9. **報告**: 生成手段・枚数・各ラベルとサイズ・主観評価・保存先 R2 key を提示。

## 必須プロトコル

- 1枚目のみテスト生成 → >1.5MB 確認 → OK なら残りをスケール
- SendUserFile 前にラベル確定（`avatar-label-assignment` ルール）
- 目視確認: キャラ一貫性・NSFW 度・構図を必ず主観評価して添える
- 良質（主観85点+）は seed として `.work/seeds/images/` に即時保存
