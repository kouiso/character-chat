# Versions（前の設定）390×844 証跡

板: `doc/design/v2/board/Versions.dc.html`「前の設定 見て戻す」。
dev server（vite + local D1, BASIC e2e:e2e-local-pass）で実データを入れたキャラ 3 体で撮影。
実装画像は 390×844 CSS px・DSF2（保存は 780×1688 px）。

- さくら（3版）: 通常・選択・確かめ・戻している間・戻したあと・中身の失敗系
- ミント（1版）: 前の設定なし
- たくさん（7版）: 折りたたみ・全展開

## 実装画像

| ファイル | 板の状態 | 内容 |
|---|---|---|
| 01-normal.png | 前の設定と、選んだ設定の中身 | 開くと最初の古い版が選ばれ、版ごとの中身（顔・名前・ひとこと・性格…タグ）と帯「この設定に戻す」 |
| 02-current-selected.png | いまの設定を選んでいる時 | 「いま」行を選ぶと中身を出さず帯「いまの設定です。戻す必要はありません。」 |
| 03-confirm.png | 戻すのを確かめる時 | シート「11月22日の設定に戻しますか？」＋やめる/戻す |
| 04-restored.png | 戻したあと | toast「前の設定に戻しました」＋「新しい会話を始める」。いま札が戻した版に移り選択もそこへ |
| 05-empty.png | 前の設定がまだ無い時 | 現行だけの一覧＋帯「前の設定は、まだありません。」 |
| 06-many-collapsed.png | たくさんある時 | 5行まで＋「もっと前を見る」 |
| 07-many-expanded.png | たくさんある時（展開） | 全行表示。板は折りたたみ時だけなので行の確認用 |
| 08-detail-loading.png | 中身の読み込み中 | 版の中身 GET を遅延させ、一覧は出したまま中身だけ骨組み |
| 09-detail-error.png | 選んだ設定の中身だけ読み込めなかった時 | 中身 GET を 500 に。「この設定の中身を読み込めませんでした。」＋もう一度 |
| 10-detail-notfound.png | この設定が見つからなかった時 | 中身 GET を 404 に。「この設定が見つかりませんでした。」＋編集に戻る |
| 11-restore-fail.png | 戻せなかった時 | POST /restore を 500 に。全面「前の設定に戻せませんでした。いまの設定は残っています。」＋もう一度 |
| 12-list-loading.png | 読み込み中 | 編集の「前の設定」リンクから遷移し `_serverFn` を遅延。route pending の骨組み。2026-11-27 に撮り直し（旧画像は detail-loading と同一だった） |
| 13-list-error.png | 読み込めなかった時 | 編集の「前の設定」リンクから遷移し serverFn を 500 に。「前の設定を読み込めませんでした。」＋もう一度 |
| 14-conflict.png | 板外の衝突時 | POST /restore を 409 に。最新の内容を読み直した案内を確かめシートの中へ出す |
| 15-draft-removal-failure.png | 板外の端末下書き削除失敗時 | 復元成功と分け「端末の下書きは残っています」＋削除だけの「もう一度」 |
| 16-restoring.png | 戻している間 | POST /restore を遅延。確かめシートのボタンが「戻しています」になり、やめる/戻すが押せない。2026-11-27 追加 |

## 板との並べ替え比較（`cmp/`）

`cmp/` には左=板・右=実装の 792×844 px 比較画像を置く。中央 12px は Home 証跡と同じ `#181820` の区切り。
再生成は次の1コマンド。

```bash
node script/design/versions-comparisons.mjs
```

板の Versions は 1 枚の長尺画像へ状態を縦に積み、下固定の帯・シート・toast を持つ状態は高さを圧縮して描いてある。そのまま切り出すと実機 viewport と縦位置を比べられないので、比較画像では板のピクセルを 390×844 viewport へ並べ直している。

- 通常状態: 板の先頭 760px と、板末尾の下帯 84px を実 viewport どおりに接続
- 確かめ・戻している間: 板の通常状態を暗幕の下地に使い、板のシートを下端へ移動
- 戻したあと・いま選択・空: 板にある flexible space を伸ばし、下帯と toast を下端基準へ移動
- 失敗・読み込み・たくさん: 板に描かれた fragment だけを上から置き、残りは背景 gradient のまま
- 文字・絵・部品を新規に描き足さない。並べ直しと背景の補完だけ

対応表は `cmp/manifest.json` にも入っている。

| 比較 | 実装画像 | 板の参照 |
|---|---|---|
| cmp-normal.png | 01-normal.png | 前の設定と、選んだ設定の中身 |
| cmp-current-selected.png | 02-current-selected.png | いまの設定を選んでいる時 |
| cmp-confirm.png | 03-confirm.png | 戻すのを確かめる時 |
| cmp-restoring.png | 16-restoring.png | 戻している間 |
| cmp-restored.png | 04-restored.png | 戻したあと |
| cmp-empty.png | 05-empty.png | 前の設定がまだ無い時 |
| cmp-many-collapsed.png | 06-many-collapsed.png | たくさんある時 |
| cmp-many-expanded.png | 07-many-expanded.png | たくさんある時（近似。展開後は板に無い） |
| cmp-detail-loading.png | 08-detail-loading.png | 読み込み中（近似。板は一覧/詳細を分けていない） |
| cmp-detail-error.png | 09-detail-error.png | 選んだ設定の中身だけ読み込めなかった時 |
| cmp-detail-notfound.png | 10-detail-notfound.png | この設定が見つからなかった時 |
| cmp-restore-fail.png | 11-restore-fail.png | 戻せなかった時 |
| cmp-list-loading.png | 12-list-loading.png | 読み込み中 |
| cmp-list-error.png | 13-list-error.png | 読み込めなかった時 |
| cmp-conflict.png | 14-conflict.png | 戻すのを確かめる時（近似。409 案内は板に無い） |
| cmp-draft-removal-failure.png | 15-draft-removal-failure.png | 戻したあと（近似。下書き警告は板に無い） |

## 板との食い違い（意図）

- 板の「紹介」「始まり方」「絵の見た目」は設定スキーマに欄が無い。欄は板どおりに残し、値は「入っていません」で出す。
- 板の人物・日時は見本なので、実装データの名前・日時・件数は一致させない。
- 03・16 は確かめシートを native dialog にした実装。見た目の配置・色・寸法は板へ合わせ、focus・暗幕はブラウザの modal 動作を使う。
- 07・14・15 は板に独立状態が無い。行の見え方・409・下書き削除失敗を確認するため、最も近い板の状態と並べた。
- 12 は `_serverFn` 遅延、13 はクライアント遷移時の失敗で再現（SSR 直アクセスでは serverFn を傍受できない）。

## 比較で見える未解決の食い違い（証拠の範囲では直していない）

- 板の loading は一覧カードの中に骨組み行を出す。実装の一覧 loading は大きな骨組みカード＋詳細側の骨組み行で、形が違う（cmp-list-loading）。
- 板の detail error / detail notfound / list error は画面内カードの中に「もう一度」または「編集に戻る」を出す。実装は全面失敗形に倒し、下帯の主ボタンへ出す（cmp-detail-error / cmp-detail-notfound / cmp-list-error）。
- 板の「たくさんある時」は一覧 fragment だけを描く。実装は選択中の版の詳細と下帯が続くため、比較の下段は板側が空になる（cmp-many-collapsed）。
