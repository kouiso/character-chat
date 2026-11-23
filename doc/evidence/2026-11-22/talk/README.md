# Talk 画面の証跡（2026-11-22）

環境: `pnpm --filter @v2/app dev`（`--port 3211`）、`V2_FAKE_MODEL=1` の擬似返事、
`runtime-seed.sql` の `runtime-probe` / `runtime-other`。390×844（board 指定サイズ）、
Basic 認証（`.dev.vars` のローカル用ユーザ）。撮影は Playwright（Chromium）。

板との対応（板の絵は `doc/design/v2/screenshot/*.jpg`）:

| ファイル | 板 | 状態 |
|---|---|---|
| 01-talk-first.png | TalkFirst.jpg | 初回の挨拶だけの画面 |
| 10-talk-waiting-bubble.png | TalkWaiting.jpg | 送った直後（点3つの泡＋止める） |
| 11-talk-normal.png | Talk.jpg | 返事が届いた通常状態（台詞の声ボタン・心の声・候補チップ） |
| 12-talk-tray.png | TalkTray.jpg | ＋をひらいた時（よく使う・この会話・場面） |
| 13-talk-overlong.png | TalkError.jpg「長すぎる 1 通」 | 上限超えのカウンタ（4,001/4,000。板の例は 20,000 だが API の上限は 4,000） |
| 14-talk-offline.png | TalkError.jpg「オフラインの時」 | オフラインで送信（入力は残る・POST は出ない） |
| 15-talk-online.png | TalkError.jpg | つながったら枠が消える（自動送信しない） |
| 16-talk-left.png | TalkLeft.jpg | 持つ手: 左（＋と送信が左右入れ替わり） |
| 17-talk-left-waiting.png | TalkLeft.jpg | 持つ手: 左の待機中（止めるも左） |
| 18-talk-menu.png | TalkMenu.jpg | ≡ メニューのシート |
| 19-talk-mood-sheet.png | TalkTray.jpg の「雰囲気」行の先 | 雰囲気シート（ふだん〜余韻） |

未確認・割愛:

- TalkImage / TalkAlbum / TalkRewrite / TalkSettings / TalkMore / GroupTalk は別 PR（本 PR は BASE Talk のみ）。
- 実機未確認。フォントは Web フォント未取得の環境で代替表示のため、書体の厳密な見えは板と異なる。
- キャラの肖像（ヘッダ背後の大きな絵）は、種データにアバター画像が無いので未掲出。
