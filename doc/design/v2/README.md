# character-chat v2 デザイン（案 D「隣」第4版）

Claude Design のキャンバス「character-chat デザイン」を、キャンバスを開けない人や AI でも読める形にして置いたフォルダです。
v2（`apps/v2`）の画面の見た目は、ここに在る板を正とします。

- 版: 第4版（2026-11-12）。このフォルダへ写したのは 2026-11-16。
- 採用: 案 D「隣」。案 A「灯」・案 B「月白」・案 C「幕」は不採用です（記録として `rejected/` に在ります。実装には使いません）。
- 元のキャンバス: https://claude.ai/artifact/HDt85J2hKCrNpNUtXEgguo （持ち主の権限が要ります。開けなくても、このフォルダだけで実装できるようにしてあります）

## フォルダの中身

| 置き場 | 中身 |
|---|---|
| `board/` | 板の HTML 78 枚（`<板名>.dc.html`）と、キャンバスの索引 `canvas.json`。板の HTML は元のファイルを 1 バイトも変えずに写した物。`canvas.json` は注記の 1 か所だけ置き換えた（下の「読み方」） |
| `text/` | 板ごとに、画面に出る文字だけを抜き出した物（`<板名>.txt`） |
| `screenshot/` | 板を描いた画像（`<板名>.jpg`）。キャラの絵の所は単色の面に差し替えてある |
| `state.md` | 板ごとの状態の名前の一覧（板に積んである順） |
| `tokens.md` | 色・文字・余白・角丸・影・部品の寸法の表。`apps/v2/src/design-token.css` との食い違いもここ |
| `rejected/` | 不採用の案 A・B・C の板 6 枚（HTML・文字・画像）。採用ではない |
| `.oxfmtrc.json` | 板の HTML（`*.dc.html`）を整形の検査（oxfmt）から外す設定。板を元のまま保つために置いた |

## 読み方

1. まず `screenshot/<板名>.jpg` で全体の形を見る。
2. 画面の文言は `text/<板名>.txt` から写す。板の文言は一字一句そのまま使う。
3. 色・寸法は `tokens.md` を見る。そこに無い値は `board/<板名>.dc.html` の `style` 属性を読む。

板の HTML の決まり:

- 1 枚で完結している。色・寸法・文字の大きさは全部、要素の `style` 属性に直に書いてある。**`style` 属性が色・寸法の正**。クラスや外部の CSS は無い。`<style>` に在るのは 3 行だけ（`body` の余白 0、リンクの色を継ぐ、入力欄の薄い文の色 `#DCD3CE`）。
- 幅は 390px。1 画面は 390×844。`Sizes` だけ 360×740 と 430×932 の見本を持つ（幅 430）。`Kit` は部品の見本帳で幅 1266。
- 縦に長い板は、同じ画面の「状態」を上から積んだ物。高さ 40px・地 `#05070D` の帯が状態の区切りで、帯の文字が状態の名前（`state.md` に一覧）。この帯は板の中だけの物で、アプリには作らない。
- 板名の末尾の `-2`・`-3` は「（つづき）」。同じ画面の状態の続きで、別の画面ではない。
- 板は `./support.js`（Claude Design の描画の道具）を読み込むが、リポジトリには入れていない。無くても、ブラウザで開けばそのまま描ける（`Talk`・`Call`・`Kit` の 3 枚で、有る時と無い時の画像が画素まで同じ事を確かめた）。
- 書体は Google Fonts から読む（Zen Kaku Gothic New・Zen Maru Gothic）。
- 板の中の人名・台詞・日時は見本（仮の文）で、仕様ではない。ボタンの名前・見出し・案内の文・エラーの文は仕様。
- `board/canvas.json` は、注記の中の担当者の姓 1 か所を「担当者」に置き換えた。ほかは元と同じ。

`text/` の書き方:

- `[button:送信]` のような角かっこは、絵だけの部品の読み上げ名（`aria-label`）・絵の代わりの文（`alt`）・入力欄の薄い文（`placeholder`）。`[部品の種類:文]` の形。
- `<button>`・`<a>`・`<input>`・`<textarea>` は、その直後の文字が押せる部品・入力欄である印。
- 抜き出しは機械でやった（HTML の表示される文字と上の属性だけ。`script`・`style`・`svg` の中は捨てる）。

## 色について気をつける事

`DirD-Home`・`DirD-Chat` は、方向を決めた時の比較の板です（キャンバスの「方向性の比較」のページ）。
この 2 枚の色と書体（地 `#141110`・押す所 `#E8AC5A`・Klee One）は、ほかの 76 枚（地 `#10162A` の紺・押す所 `#FFC9AC` のピーチ・Zen Maru Gothic）と違います。
キャンバスの注記は「色: 紺から暮れていく夜＋ピーチ」と書いていて、見本帳（`Kit`）と画面の板 75 枚がその色です。
**色・寸法は `Kit` と画面の板から取る**。`DirD-*` の値は `tokens.md` に入れていません。

## 入れていない物

- **キャラの絵**。板の中の `<img src="/_blob/<id>">` が絵で、568 か所在る（絵は 4 種類）。絵のファイルは公開リポジトリに入れていない。板の HTML には参照（`/_blob/<id>`）だけが残っていて、開いても絵は出ない。
- 板を描く道具（`support.js`）と、キャンバスの編集画面。

## 画像（`screenshot/`）の作り方

- Playwright の Chromium で板を開き、ページ全体を写した。幅は板の幅（390。`Sizes` は 430、`Kit` は 1266）、`deviceScaleFactor` は 1、JPEG の品質 70。
- `/_blob/` の絵は取りに行かず、単色 `#4A5270` の面を返して描いた。**画像の中の青灰色の面は「ここに絵が入る」の印で、デザインの色ではない**。
- 書体は Google Fonts から読めた状態で描いた。
- 78 枚ぶんで約 11MB。
- 描いた係（AI）が画像を開いて見たのは一部だけ（`Talk`・`Kit`・`Main`・`Sizes`・`Call` の全体と、`History`・`CharacterEdit` の一部）。その範囲では、板として読める絵になっていた。残りの板は、描画の記録（高さがキャンバスの索引と同じ・読めなかった物 0・エラー 0）だけで確かめた。人の目ではまだ見ていない。

## 板の一覧

全部で 78 枚。状態の区切りの帯は、見本帳を除いて 620 本（キャンバスの注記の「約620」に当たる）。
まとまりは、キャンバスの見出しの注記の文そのまま。


### 基準 — ホーム・出会う・始まり方・トーク

| 板名 | 題 | 大きさ | 状態 | HTML | 文字 | 画像 |
|---|---|---|---|---|---|---|
| Main | ホーム | 390×844 | 1 | [html](board/Main.dc.html) | [txt](text/Main.txt) | [jpg](screenshot/Main.jpg) |
| Meet | 出会う | 390×1768 | 2 | [html](board/Meet.dc.html) | [txt](text/Meet.txt) | [jpg](screenshot/Meet.jpg) |
| Start | 始まり方を選ぶ | 390×5265 | 9 | [html](board/Start.dc.html) | [txt](text/Start.txt) | [jpg](screenshot/Start.jpg) |
| Talk | トーク | 390×844 | 1 | [html](board/Talk.dc.html) | [txt](text/Talk.txt) | [jpg](screenshot/Talk.jpg) |
| TalkTray | トーク｜＋をひらく | 390×844 | 1 | [html](board/TalkTray.dc.html) | [txt](text/TalkTray.txt) | [jpg](screenshot/TalkTray.jpg) |
| Mood | 雰囲気を動かす | 390×1416 | 2 | [html](board/Mood.dc.html) | [txt](text/Mood.txt) | [jpg](screenshot/Mood.jpg) |
| TalkMenu | トークのメニュー | 390×6372 | 10 | [html](board/TalkMenu.dc.html) | [txt](text/TalkMenu.txt) | [jpg](screenshot/TalkMenu.jpg) |

### 実装へ渡す見本 — 画面の大きさのちがい

| 板名 | 題 | 大きさ | 状態 | HTML | 文字 | 画像 |
|---|---|---|---|---|---|---|
| Sizes | 画面の大きさのちがい | 430×3504 | 4 | [html](board/Sizes.dc.html) | [txt](text/Sizes.txt) | [jpg](screenshot/Sizes.jpg) |

### ホームまわり

| 板名 | 題 | 大きさ | 状態 | HTML | 文字 | 画像 |
|---|---|---|---|---|---|---|
| MeetList | 出会う｜一覧 | 390×4420 | 5 | [html](board/MeetList.dc.html) | [txt](text/MeetList.txt) | [jpg](screenshot/MeetList.jpg) |
| MeetEmpty | 出会う｜うまくいかない時 | 390×5304 | 6 | [html](board/MeetEmpty.dc.html) | [txt](text/MeetEmpty.txt) | [jpg](screenshot/MeetEmpty.jpg) |
| MeetEmpty-2 | 出会う｜うまくいかない時（つづき） | 390×4420 | 5 | [html](board/MeetEmpty-2.dc.html) | [txt](text/MeetEmpty-2.txt) | [jpg](screenshot/MeetEmpty-2.jpg) |
| HomeEmpty | ホーム｜最初の状態 | 390×1768 | 2 | [html](board/HomeEmpty.dc.html) | [txt](text/HomeEmpty.txt) | [jpg](screenshot/HomeEmpty.jpg) |
| HomeStates | ホーム｜読み込み中・読めない・圏外 | 390×5304 | 6 | [html](board/HomeStates.dc.html) | [txt](text/HomeStates.txt) | [jpg](screenshot/HomeStates.jpg) |
| HomeStates-2 | ホーム｜読み込み中・読めない・圏外（つづき） | 390×4420 | 5 | [html](board/HomeStates-2.dc.html) | [txt](text/HomeStates-2.txt) | [jpg](screenshot/HomeStates-2.jpg) |
| Profile | プロフィール | 390×6260 | 5 | [html](board/Profile.dc.html) | [txt](text/Profile.txt) | [jpg](screenshot/Profile.jpg) |
| Profile-2 | プロフィール（つづき） | 390×7072 | 8 | [html](board/Profile-2.dc.html) | [txt](text/Profile-2.txt) | [jpg](screenshot/Profile-2.jpg) |
| DeleteConfirm | 削除の確認 | 390×5712 | 14 | [html](board/DeleteConfirm.dc.html) | [txt](text/DeleteConfirm.txt) | [jpg](screenshot/DeleteConfirm.jpg) |

### トークの状態

| 板名 | 題 | 大きさ | 状態 | HTML | 文字 | 画像 |
|---|---|---|---|---|---|---|
| TalkFirst | はじめての会話 | 390×5264 | 9 | [html](board/TalkFirst.dc.html) | [txt](text/TalkFirst.txt) | [jpg](screenshot/TalkFirst.jpg) |
| TalkWaiting | 返事を待つ | 390×3996 | 8 | [html](board/TalkWaiting.dc.html) | [txt](text/TalkWaiting.txt) | [jpg](screenshot/TalkWaiting.jpg) |
| TalkMore | もっと・別の返事 | 390×3576 | 7 | [html](board/TalkMore.dc.html) | [txt](text/TalkMore.txt) | [jpg](screenshot/TalkMore.jpg) |
| TalkRewrite | 書き直す・ここから戻る | 390×4970 | 9 | [html](board/TalkRewrite.dc.html) | [txt](text/TalkRewrite.txt) | [jpg](screenshot/TalkRewrite.jpg) |
| TalkError | つながらない時 | 390×4128 | 10 | [html](board/TalkError.dc.html) | [txt](text/TalkError.txt) | [jpg](screenshot/TalkError.jpg) |

### 画像

| 板名 | 題 | 大きさ | 状態 | HTML | 文字 | 画像 |
|---|---|---|---|---|---|---|
| TalkImage | 画像を頼む・届く | 390×7052 | 14 | [html](board/TalkImage.dc.html) | [txt](text/TalkImage.txt) | [jpg](screenshot/TalkImage.jpg) |
| ImageSettings | 画像のくわしい設定 | 390×3240 | 5 | [html](board/ImageSettings.dc.html) | [txt](text/ImageSettings.txt) | [jpg](screenshot/ImageSettings.jpg) |
| TalkAlbum | この会話のアルバム | 390×5316 | 11 | [html](board/TalkAlbum.dc.html) | [txt](text/TalkAlbum.txt) | [jpg](screenshot/TalkAlbum.jpg) |
| Viewer | 全画面で見る | 390×5072 | 8 | [html](board/Viewer.dc.html) | [txt](text/Viewer.txt) | [jpg](screenshot/Viewer.jpg) |
| Viewer-2 | 全画面で見る（つづき） | 390×5112 | 9 | [html](board/Viewer-2.dc.html) | [txt](text/Viewer-2.txt) | [jpg](screenshot/Viewer-2.jpg) |

### トークのパネル

| 板名 | 題 | 大きさ | 状態 | HTML | 文字 | 画像 |
|---|---|---|---|---|---|---|
| Scene | いまの場面 | 390×4828 | 8 | [html](board/Scene.dc.html) | [txt](text/Scene.txt) | [jpg](screenshot/Scene.jpg) |
| SceneEdit | いまの場面｜直す | 390×5612 | 9 | [html](board/SceneEdit.dc.html) | [txt](text/SceneEdit.txt) | [jpg](screenshot/SceneEdit.jpg) |
| Bookmarks | しおり | 390×5180 | 8 | [html](board/Bookmarks.dc.html) | [txt](text/Bookmarks.txt) | [jpg](screenshot/Bookmarks.jpg) |
| Memory | 記憶 | 390×5306 | 7 | [html](board/Memory.dc.html) | [txt](text/Memory.txt) | [jpg](screenshot/Memory.jpg) |
| Memory-2 | 記憶（つづき1） | 390×5210 | 11 | [html](board/Memory-2.dc.html) | [txt](text/Memory-2.txt) | [jpg](screenshot/Memory-2.jpg) |
| Memory-3 | 記憶（つづき2） | 390×5340 | 7 | [html](board/Memory-3.dc.html) | [txt](text/Memory-3.txt) | [jpg](screenshot/Memory-3.jpg) |

### 声と通知

| 板名 | 題 | 大きさ | 状態 | HTML | 文字 | 画像 |
|---|---|---|---|---|---|---|
| Call | 通話 | 390×6188 | 7 | [html](board/Call.dc.html) | [txt](text/Call.txt) | [jpg](screenshot/Call.jpg) |
| Call-2 | 通話（つづき） | 390×6188 | 7 | [html](board/Call-2.dc.html) | [txt](text/Call-2.txt) | [jpg](screenshot/Call-2.jpg) |
| Voice | 声 | 390×4384 | 13 | [html](board/Voice.dc.html) | [txt](text/Voice.txt) | [jpg](screenshot/Voice.jpg) |
| TalkSettings | この子との設定 | 390×5504 | 15 | [html](board/TalkSettings.dc.html) | [txt](text/TalkSettings.txt) | [jpg](screenshot/TalkSettings.jpg) |
| Documents | 資料 | 390×4224 | 6 | [html](board/Documents.dc.html) | [txt](text/Documents.txt) | [jpg](screenshot/Documents.jpg) |
| Documents-2 | 資料（つづき） | 390×4516 | 16 | [html](board/Documents-2.dc.html) | [txt](text/Documents-2.txt) | [jpg](screenshot/Documents-2.jpg) |

### つくる

| 板名 | 題 | 大きさ | 状態 | HTML | 文字 | 画像 |
|---|---|---|---|---|---|---|
| Create | つくる | 390×3676 | 5 | [html](board/Create.dc.html) | [txt](text/Create.txt) | [jpg](screenshot/Create.jpg) |
| CreateCharacter | キャラクターをつくる | 390×4724 | 9 | [html](board/CreateCharacter.dc.html) | [txt](text/CreateCharacter.txt) | [jpg](screenshot/CreateCharacter.jpg) |
| CreateWizard | こだわってつくる | 390×4608 | 9 | [html](board/CreateWizard.dc.html) | [txt](text/CreateWizard.txt) | [jpg](screenshot/CreateWizard.jpg) |
| CreateResult | できあがりの確認 | 390×7050 | 17 | [html](board/CreateResult.dc.html) | [txt](text/CreateResult.txt) | [jpg](screenshot/CreateResult.jpg) |
| CharacterEdit | キャラクター編集 | 390×7388 | 13 | [html](board/CharacterEdit.dc.html) | [txt](text/CharacterEdit.txt) | [jpg](screenshot/CharacterEdit.jpg) |
| CharacterEdit-2 | キャラクター編集（つづき） | 390×7172 | 19 | [html](board/CharacterEdit-2.dc.html) | [txt](text/CharacterEdit-2.txt) | [jpg](screenshot/CharacterEdit-2.jpg) |
| Versions | 版の履歴 | 390×7108 | 14 | [html](board/Versions.dc.html) | [txt](text/Versions.txt) | [jpg](screenshot/Versions.jpg) |

### ストーリー

| 板名 | 題 | 大きさ | 状態 | HTML | 文字 | 画像 |
|---|---|---|---|---|---|---|
| Stories | ストーリーの一覧 | 390×7564 | 13 | [html](board/Stories.dc.html) | [txt](text/Stories.txt) | [jpg](screenshot/Stories.jpg) |
| StoryEdit | ストーリー編集 | 390×5200 | 8 | [html](board/StoryEdit.dc.html) | [txt](text/StoryEdit.txt) | [jpg](screenshot/StoryEdit.jpg) |
| StoryEdit-2 | ストーリー編集（つづき） | 390×5124 | 10 | [html](board/StoryEdit-2.dc.html) | [txt](text/StoryEdit-2.txt) | [jpg](screenshot/StoryEdit-2.jpg) |
| ChapterEdit | 章の編集 | 390×6480 | 14 | [html](board/ChapterEdit.dc.html) | [txt](text/ChapterEdit.txt) | [jpg](screenshot/ChapterEdit.jpg) |
| ChapterEdit-2 | 章の編集（つづき） | 390×6552 | 16 | [html](board/ChapterEdit-2.dc.html) | [txt](text/ChapterEdit-2.txt) | [jpg](screenshot/ChapterEdit-2.jpg) |
| Reader | リーダー | 390×4076 | 3 | [html](board/Reader.dc.html) | [txt](text/Reader.txt) | [jpg](screenshot/Reader.jpg) |
| Reader-2 | リーダー（つづき） | 390×4460 | 9 | [html](board/Reader-2.dc.html) | [txt](text/Reader-2.txt) | [jpg](screenshot/Reader-2.jpg) |

### クリップとグループ

| 板名 | 題 | 大きさ | 状態 | HTML | 文字 | 画像 |
|---|---|---|---|---|---|---|
| Clips | クリップ | 390×7116 | 12 | [html](board/Clips.dc.html) | [txt](text/Clips.txt) | [jpg](screenshot/Clips.jpg) |
| ClipCreate | クリップをつくる | 390×5754 | 14 | [html](board/ClipCreate.dc.html) | [txt](text/ClipCreate.txt) | [jpg](screenshot/ClipCreate.jpg) |
| Groups | グループ | 390×3960 | 5 | [html](board/Groups.dc.html) | [txt](text/Groups.txt) | [jpg](screenshot/Groups.jpg) |
| Groups-2 | グループ（つづき） | 390×4356 | 9 | [html](board/Groups-2.dc.html) | [txt](text/Groups-2.txt) | [jpg](screenshot/Groups-2.jpg) |
| GroupTalk | グループの会話 | 390×6188 | 7 | [html](board/GroupTalk.dc.html) | [txt](text/GroupTalk.txt) | [jpg](screenshot/GroupTalk.jpg) |
| GroupTalk-2 | グループの会話（つづき） | 390×5560 | 11 | [html](board/GroupTalk-2.dc.html) | [txt](text/GroupTalk-2.txt) | [jpg](screenshot/GroupTalk-2.jpg) |

### アルバムとマイ

| 板名 | 題 | 大きさ | 状態 | HTML | 文字 | 画像 |
|---|---|---|---|---|---|---|
| Album | アルバム | 390×5416 | 6 | [html](board/Album.dc.html) | [txt](text/Album.txt) | [jpg](screenshot/Album.jpg) |
| Album-2 | アルバム（つづき） | 390×5032 | 6 | [html](board/Album-2.dc.html) | [txt](text/Album-2.txt) | [jpg](screenshot/Album-2.jpg) |
| My | マイ | 390×5868 | 7 | [html](board/My.dc.html) | [txt](text/My.txt) | [jpg](screenshot/My.jpg) |
| LearnedPrefs | AIがおぼえた好み | 390×6188 | 7 | [html](board/LearnedPrefs.dc.html) | [txt](text/LearnedPrefs.txt) | [jpg](screenshot/LearnedPrefs.jpg) |
| LearnedPrefs-2 | AIがおぼえた好み（つづき） | 390×6988 | 9 | [html](board/LearnedPrefs-2.dc.html) | [txt](text/LearnedPrefs-2.txt) | [jpg](screenshot/LearnedPrefs-2.jpg) |
| History | 履歴 | 390×6188 | 7 | [html](board/History.dc.html) | [txt](text/History.txt) | [jpg](screenshot/History.jpg) |
| History-2 | 履歴（つづき） | 390×6448 | 11 | [html](board/History-2.dc.html) | [txt](text/History-2.txt) | [jpg](screenshot/History-2.jpg) |
| Settings | 設定 | 390×2872 | 4 | [html](board/Settings.dc.html) | [txt](text/Settings.txt) | [jpg](screenshot/Settings.jpg) |
| Notifications | 通知の設定 | 390×4724 | 7 | [html](board/Notifications.dc.html) | [txt](text/Notifications.txt) | [jpg](screenshot/Notifications.jpg) |
| Notifications-2 | 通知の設定（つづき） | 390×5004 | 7 | [html](board/Notifications-2.dc.html) | [txt](text/Notifications-2.txt) | [jpg](screenshot/Notifications-2.jpg) |

### その子の暮らし — つぶやき・日記・電話・おぼえている日

| 板名 | 題 | 大きさ | 状態 | HTML | 文字 | 画像 |
|---|---|---|---|---|---|---|
| Feed | その子のつぶやき | 390×5668 | 10 | [html](board/Feed.dc.html) | [txt](text/Feed.txt) | [jpg](screenshot/Feed.jpg) |
| Diary | その子の日記 | 390×4064 | 7 | [html](board/Diary.dc.html) | [txt](text/Diary.txt) | [jpg](screenshot/Diary.jpg) |
| CallSchedule | 電話の約束 | 390×3852 | 7 | [html](board/CallSchedule.dc.html) | [txt](text/CallSchedule.txt) | [jpg](screenshot/CallSchedule.jpg) |
| CallSchedule-2 | 電話の約束（つづき） | 390×4220 | 7 | [html](board/CallSchedule-2.dc.html) | [txt](text/CallSchedule-2.txt) | [jpg](screenshot/CallSchedule-2.jpg) |
| Anniversary | おぼえている日 | 390×4410 | 6 | [html](board/Anniversary.dc.html) | [txt](text/Anniversary.txt) | [jpg](screenshot/Anniversary.jpg) |
| Anniversary-2 | おぼえている日（つづき） | 390×4140 | 8 | [html](board/Anniversary-2.dc.html) | [txt](text/Anniversary-2.txt) | [jpg](screenshot/Anniversary-2.jpg) |

### 見本帳 — 色・文字・部品

| 板名 | 題 | 大きさ | 状態 | HTML | 文字 | 画像 |
|---|---|---|---|---|---|---|
| Kit | 見本帳 | 1266×2686 | （部品 36 節） | [html](board/Kit.dc.html) | [txt](text/Kit.txt) | [jpg](screenshot/Kit.jpg) |

### 方向性の比較 — 採用は案D「隣」。A・B・C は不採用の記録

| 板名 | 題 | 大きさ | 状態 | HTML | 文字 | 画像 |
|---|---|---|---|---|---|---|
| DirD-Home | 案D 隣｜ホーム（採用） | 390×1400 | 1 | [html](board/DirD-Home.dc.html) | [txt](text/DirD-Home.txt) | [jpg](screenshot/DirD-Home.jpg) |
| DirD-Chat | 案D 隣｜トーク（採用） | 390×844 | 1 | [html](board/DirD-Chat.dc.html) | [txt](text/DirD-Chat.txt) | [jpg](screenshot/DirD-Chat.jpg) |

### 不採用の案（`rejected/`）

採用ではない。実装には使わない。方向を比べた時の記録として置く。

| 板名 | 題 | 大きさ | HTML | 文字 | 画像 |
|---|---|---|---|---|---|
| DirA-Home | 案A 灯｜ホーム（不採用） | 390×1628 | [html](rejected/DirA-Home.dc.html) | [txt](rejected/DirA-Home.txt) | [jpg](rejected/DirA-Home.jpg) |
| DirA-Chat | 案A 灯｜トーク（不採用） | 390×844 | [html](rejected/DirA-Chat.dc.html) | [txt](rejected/DirA-Chat.txt) | [jpg](rejected/DirA-Chat.jpg) |
| DirB-Home | 案B 月白｜ホーム（不採用） | 390×1136 | [html](rejected/DirB-Home.dc.html) | [txt](rejected/DirB-Home.txt) | [jpg](rejected/DirB-Home.jpg) |
| DirB-Chat | 案B 月白｜トーク（不採用） | 390×844 | [html](rejected/DirB-Chat.dc.html) | [txt](rejected/DirB-Chat.txt) | [jpg](rejected/DirB-Chat.jpg) |
| DirC-Home | 案C 幕｜ホーム（不採用） | 390×2398 | [html](rejected/DirC-Home.dc.html) | [txt](rejected/DirC-Home.txt) | [jpg](rejected/DirC-Home.jpg) |
| DirC-Chat | 案C 幕｜トーク（不採用） | 390×844 | [html](rejected/DirC-Chat.dc.html) | [txt](rejected/DirC-Chat.txt) | [jpg](rejected/DirC-Chat.jpg) |

## キャンバスの注記（全文）

キャンバスの「画面」のページに貼ってある注記 2 枚。原文のまま（担当者の姓 1 か所だけ「担当者」に置き換えた）。

### 1 枚目: 第4版（決めた事・形と色・確かめた事）


> 第4版（2026-11-12）
>
> 足した物: どの画面にも「うまくいった時・待つ時・うまくいかない時」の状態（全部で 約620）
> 長い画面は「（つづき）」の板に分けて横に並べた
>
> 決めた事
> ・キャラを消すと、その子との会話・記憶・会話のアルバムが消える。ストーリーとクリップは残り「削除された子」と出る
> ・保存せずに閉じる時、目立つボタンは「編集に戻る」
> ・つくっている間は、どこでも「止める」が出る
> ・うまくいかない時の文は、場面ごとに 1 つにそろえた
>
> 形と色（第2版から変えていない）
> 形: キャラの絵が画面いっぱい。文字は不透明な面の上
> 色: 紺から暮れていく夜＋ピーチ（押す所だけ）
> 読みやすさ: 主な文字は背景との差 12 対 1 以上、本文 16px 以上
>
> 足した画面: 顔をアルバムからえらぶ／自分用にコピーしたあと／流れを分けて再生成したあと・元の流れへ戻る道／ホームの「つづきから」のグループ
>
> 確かめた: 全部の板で機械の検査 0、字の重なりの検査 0。絵は別の担当が全部を 2 回、担当者が一部を目で確認。最初の不具合 164 件は 1 件ずつ確かめた（残りは承認済みの基準の板と、局長の決定で残した物）。仕様書の機能 70 個は全部どこかの画面にある
> 確かめていない: 実機・暗い部屋での見え方、動かした時の体感。見本の文と名前は仮

### 2 枚目: 実装で直す不具合（全部直す）

実装の票では、この番号を「注記 3」のように引く。


> 実装で直す不具合（全部直す）
>
> 1. 編集画面でつくった子は「見た目」の設定が無く、画像・挿絵・4コマが必ず失敗する →「見た目」の節を足した
> 2. ストーリーの「読む」を押しても編集画面がまた出る → リーダーを描いた
> 3. {名前}から話しかける：入にしても保存も予約もされない。1 人を切ると全員ぶんの通知が消える
> 4. 会話の削除・名前変更・キャラ削除・グループ削除・履歴の全消し・クリップの削除の入口が無い
> 5. 全キャラ横断のアルバムが無い
> 6. 戻した会話は、画面を開き直すと二度と進められない
> 7. クリップ：作成画面を閉じると永久に「作成中」。失敗は黙って隠れる
> 8. グループ：全員の返事が揃うまで何も出ず、失敗すると打った文が消える
> 9. 保存・読み込みの失敗が何も出ない、やり直しのボタンが無い画面が多い
> 10. おまかせ・シナリオから・こだわって の 3 つの作り方は、v2 に生成の仕組みが無い
> 11. 通話の 1 日 180 秒の上限、資料の 15 個・5MB：上限の表示は描いていない（資料の容量だけ出した）
> 12. セーフモードは返事と候補にしか効かない（画像・グループ・話しかけには効かない）
