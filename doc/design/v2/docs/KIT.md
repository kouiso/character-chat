# 燈 v2 部品集（KIT）

全画面を v2 の基準（承認済みの `project/Main` `Meet` `Talk` `TalkTray`）で描き直すための、色・文字・部品の決まり。
これ 1 枚で足りるように書いてある。**色・文字の大きさ・部品はここにある物だけを使う。新しい色・新しい形の部品を足さない。**
見本の板は `project/Kit.dc.html`（描いた絵は `render/Kit.png`）。この文書と板は `tools/kit.py` から一緒に書き出している。

## 0. 先に守ること

- 読みやすさ: 主な文字は載っている面に対して 12:1 以上、副の文字は 7:1 以上。本文 16px、補助 13px、最小 12px（タブのラベルだけ）。
- 文字は絵やガラスの上に直に置かない。絵の上に置く時は不透明な札（6.3）の上。半透明の面は使わない（例外は 6 のシートの後ろの暗幕だけ）。
- 絵は無加工（色かぶせ・フィルタ・透過なし）。暗くしてよいのは、絵がシートへ溶ける下端 64px の縁だけ。
- 押せる物は縦横 44px 以上。図像だけのボタンには `aria-label`。
- 夜に眩しくしない: 明るい面は主ボタン 1 つ（と、選んだ切り替えのつまみ）だけ。
- 「彼女」と書かない。合意・配慮などの枠の文言を足さない。絵文字・記号文字を使わない（図像は 7 の線の SVG）。技術の言葉・数字・「[要決定]」などの覚え書きを画面に出さない。
- 板の書き方は `../AUTHORING.md`。全部 inline style に実値で書く。下の断片は実値に展開済みなので、そのまま貼れる。

## 1. 色（hex・役・実測のコントラスト）

コントラストは、文字を消した画面の画素に対して測った値（基準の 4 画面と Kit の板）。面がグラデーションの物は、いちばん不利な端の値。

### 1.1 文字と差し色

| 名前 | 値 | 役 | 地 `#10162A` | 面 `#212941` | 押せる面 `#262E49` | 自分の面 `#3C2428` | 下の帯 `#1C171F` | 窪み `#0B0F1A` | 絵の上の札 `#0F1528` |
|---|---|---|---|---|---|---|---|---|---|
| 文字 主 | `#FBF6F1` | 名前・セリフ・自分の発言・ボタン・行の名前・入力した文字 | 16.7 | 13.4 | 12.5 | 13.3 | 16.4 | 17.8 | 16.9 |
| 文字 副 | `#DCD3CE` | 地の文・ひとこと・日時・値・見出しのラベル・面なしの図像・選んでいないタブ | 12.2 | 9.8 | 9.1 | 9.7 | 12.0 | 13.0 | 12.3 |
| ピーチ（文字・図像） | `#FFC9AC` | 新着・今夜ひま？・#・選んだタブ・「保存」「元に戻す」・入っている値 | 12.1 | 9.7 | 9.1 | 9.6 | 11.9 | 12.9 | 12.3 |
| 消す・エラー | `#DBA199` | 削除の文字と図像、エラーの図像と 1 行、超えた数え（局長の実機コメントで 2 回沈めた。はじめは `#FFA69A`、12 回目は `#EDAFA7`。失敗の字は差 6 以上） | 8.2 | 6.6 | 6.1 | 載せない | 8.0 | 8.7 | 8.2 |
| ピーチの上の文字 | `#1A0B08` | 主ボタンの文字と図像 | — | — | — | — | — | — | — |
| 灯 | `#F5D58C` | 居る印の点だけ（文字にしない） | — | — | — | — | — | — | — |

- 主ボタン: `#1A0B08` on ピーチの面（`#FFCDB2`→`#FFC4A4`）= 12.5〜13.4:1。
- 画面のいちばん下（暮れ色 `#231B20`）では 主 15.7／副 11.4。
- 消すボタンの面（`#4A2226`→`#401C21`）の上: 主 12.6、赤い図像 6.2〜6.8（`#4A2226` の上 6.2・`#401C21` の上 6.8）。
- 選んだ札の面（`#3D2B2F`→`#36262A`）の上: 主 12.3。頭文字の札（`#2E2A4A` `#1E3437` `#3B2630` `#38291C`）の上: 主 12.2〜13.0。
- 赤い文字は自分の面に載せない。ピーチの文字は「主」ではなく「副」の扱い（7:1 以上あればよい所だけに使う）。

### 1.2 地と面

| 名前 | 値 | 役 |
|---|---|---|
| 地 | `linear-gradient(180deg, #0E1425 0%, #10162A 46%, #191826 78%, #231B20 100%)` | 画面のいちばん外（6.1） |
| シート | `linear-gradient(180deg, #10162A 0%, #131729 40%, #1B1925 74%, #231B20 100%)` | 絵の下の不透明な面（6.2）。角も線も無し |
| 絵の縁 | `linear-gradient(180deg, rgba(16,22,42,0) 0%, rgba(16,22,42,0.72) 52%, #10162A 88%, #10162A 100%)`・高さ 64 | 絵の下端だけ |
| 面 | `linear-gradient(180deg, #212941 0%, #1D253B 100%)` | 相手の吹き出し、設定の札、トレーの一覧、エラーの札 |
| 押せる面 | `linear-gradient(180deg, #262E49 0%, #212943 100%)` | 面のボタン、丸薬、返事の候補、「＋」、送信、切り替えの選んだ物 |
| 自分の面 | `linear-gradient(180deg, #3C2428 0%, #352024 100%)` | 自分の吹き出し |
| 選んだ札の面 | `linear-gradient(180deg, #3D2B2F 0%, #36262A 100%)`＋輪 `inset 0 0 0 1.5px #FFC9AC` | 選べる札の選んだ状態 |
| 選んだタブの丸薬 | `#3A292D` | 下のタブ |
| 消すボタンの面 | `linear-gradient(180deg, #4A2226 0%, #401C21 100%)` | 確かめのシートの「削除する」 |
| 絵の上の札 | `#0F1528` | 絵の上の題・操作、知らせ |
| 下の帯 | `#1C171F` | タブ、入力まわり、シート、トレー |
| 窪み | `#0B0F1A` | 入力欄、切り替えの溝、つまみの溝 |
| 骨組み | `#2B3452`／`#232C47` | 読み込み中の形（12 回目に 1 段明るくした。前は `#242C45`／`#1D253B`） |
| 状態の区切り | `#05070D` | 板に状態を積む時の帯（画面の外） |

### 1.3 線

| 名前 | 値 | 役 | コントラスト |
|---|---|---|---|
| 入力の枠 | `#8C8497`（1px） | 入力欄・切り替えの「切」の輪郭。枠線を使うのはここだけ | 地 5.0／下の帯 4.9／窪み 5.3 |
| エラーの枠 | `rgba(219,161,153,0.72)`（1px。失敗の色を 7 割強の濃さで） | エラーのある入力欄。ふつうの欄の枠と同じ見えやすさにする（窪みの上 5.0・地の上 4.8。ふつうの枠は 4.7〜5.3） | 窪み 5.0 |
| 細い線 | `rgba(255,255,255,0.08)`（`box-shadow: inset 0 1px 0`） | 行の間、帯の上端 | 飾り（読ませない） |
| 心の声の枠 | `#7A6058`（1px） | 心の声の吹き出し | 飾り（見出しの文字で見分ける） |

## 2. 文字

書体は 2 つだけ。Google Fonts のリンクはこの 1 本:
`https://fonts.googleapis.com/css2?family=Zen+Kaku+Gothic+New:wght@500;700&family=Zen+Maru+Gothic:wght@900&display=swap`

| 役 | font-family | 大きさ/行送り | 太さ | 字間 | style |
|---|---|---|---|---|---|
| 名前（1 画面に 1 つ） | `'Zen Maru Gothic', 'Zen Kaku Gothic New', sans-serif` | 32/40 | 900 | 0.03em | `font-family: 'Zen Maru Gothic', 'Zen Kaku Gothic New', sans-serif; font-size: 32px; line-height: 40px; font-weight: 900; letter-spacing: 0.03em` |
| タブの根の画面の題（つくる・アルバム・マイ・出会うの一覧） | `'Zen Kaku Gothic New', sans-serif` | 22/30 | 700 | 0.04em | `font-size: 22px; line-height: 30px; font-weight: 700; letter-spacing: 0.04em` |
| 題・主ボタン・節の見出し | `'Zen Kaku Gothic New', sans-serif` | 16/24 | 700 | 0.06em（節の見出しは 0.04em） | `font-size: 16px; line-height: 24px; font-weight: 700; letter-spacing: 0.06em` |
| 本文（セリフ・地の文・自分の発言・説明・設定の行） | 同上 | 16/28 | 500 | 0.02em | `font-size: 16px; line-height: 28px; font-weight: 500; letter-spacing: 0.02em` |
| ボタン・行の名前・選んだ物 | 同上 | 15/20 | 700 | 0.04em | `font-size: 15px; line-height: 20px; font-weight: 700; letter-spacing: 0.04em` |
| 静かなボタン・返事の候補・トレーの行 | 同上 | 15/20 | 500 | 0.02em | `font-size: 15px; line-height: 20px; font-weight: 500; letter-spacing: 0.02em` |
| ひとこと・日時・値・見出しのラベル・補足 | 同上 | 13/20 | 500 | 0.02em | `font-size: 13px; line-height: 20px; font-weight: 500; letter-spacing: 0.02em` |
| タブのラベル（最小） | 同上 | 12/16 | 500（選んだ物 700） | 0.04em | `font-size: 12px; line-height: 16px; font-weight: 500; letter-spacing: 0.04em` |

- 大きさは 12・13・15・16・22・32 の 6 つだけ。14・17・18・20・24 は使わない。
- 22px はタブの根の画面の題だけ（頭の高さ 56 はそのまま、`<h1>` に使う）。戻るの付く画面の題・シートの題・節の見出しは 16/24 のまま。
- 丸ゴシック（Zen Maru Gothic）は名前だけ。400 以下の細い太さは使わない。
- 入力欄の中の文字は 16/24・500。入力欄の薄い字（placeholder）は `#DCD3CE`（`<helmet><style>` に `input::placeholder{color:#DCD3CE;opacity:1}`）。
- 数字は `font-variant-numeric: tabular-nums`（地の 1 行に入っている）。

## 3. 余白・角丸・寸法

- 余白の刻み: 4・8・12・16・24・32。左右の余白は 20（下の帯とトレーの中は 16）。
  - 同じかたまりの中: 8。かたまりの間: 16。主ボタンの上下: 24。節の間: 24〜32。
- 角丸: 8（押せない小さな面・骨組み）／12（入力欄・画像の札）／20（吹き出し・面の札・大きい画像）／28（シートとトレーの上の角）／999（ボタン・丸薬・顔）。
  - 吹き出しは話し手の側の下の角だけ 8（相手＝左下、自分＝右下）。
- 高さ: 主ボタン 56／面のボタン 56 か 44／文字だけ 44／入力まわりの丸 48／入力欄 48／行 64（顔つき）・52（設定）・44（トレー）／タブ 64／ふつうの頭 56。
- 絵の高さ: トーク 264／ホーム 420／出会う 516。絵の縁 64。

## 4. 面の階層と灯の光（CSS はこのまま使う）

| 階層 | 何に | CSS |
|---|---|---|
| 0 地 | 画面・シート | 1.2 の地／シートのグラデーション。影なし |
| 1 面 | 吹き出し・設定の札・一覧の札 | `background: linear-gradient(180deg, #212941 0%, #1D253B 100%); box-shadow: inset 0 1px 0 rgba(255,255,255,0.07), 0 6px 16px rgba(4,6,14,0.30)` |
| 1 押せる面 | 面のボタン・丸薬・候補 | `background: linear-gradient(180deg, #262E49 0%, #212943 100%); box-shadow: inset 0 1px 0 rgba(255,255,255,0.10), 0 4px 12px rgba(4,6,14,0.28)` |
| 1 自分の面 | 自分の吹き出し | `background: linear-gradient(180deg, #3C2428 0%, #352024 100%); box-shadow: inset 0 1px 0 rgba(255,228,214,0.10), 0 6px 16px rgba(4,6,14,0.30)` |
| 2 浮いた札 | 絵の上の札・知らせ | `background: #0F1528; box-shadow: inset 0 0 0 1px rgba(255,255,255,0.14), 0 6px 16px rgba(4,6,14,0.40)` |
| 2 シート | 下からのシート・ひらいたトレー | `background: #1C171F; box-shadow: inset 0 1px 0 rgba(255,255,255,0.10), 0 -12px 32px rgba(4,6,14,0.55)`（後ろに暗幕 `rgba(6,8,16,0.6)`。トレーは暗幕なし） |
| 下の帯 | タブ・入力 | `background: #1C171F; box-shadow: inset 0 1px 0 rgba(255,255,255,0.08)` |

- 階層はこの 3 つ（0・1・2）だけ。面の上に面を重ねない（札の中の行は面なし＋細い線）。影は上の値だけ、ぼかし（backdrop-filter）は使わない。

**灯の光（1 画面に 1 つだけ）**

- 主ボタンに付ける時（ホーム・出会う・つくる等、塗りのボタンがある画面）:
  `background: linear-gradient(180deg, #FFCDB2 0%, #FFC4A4 100%); box-shadow: inset 0 1px 0 rgba(255,255,255,0.55), 0 10px 28px rgba(255,150,100,0.30), 0 2px 6px rgba(255,150,100,0.22)`
- 雰囲気の点に付ける時（トーク。塗りのボタンが無い画面）:
  `background: #FFC9AC; box-shadow: 0 0 0 4px rgba(255,170,125,0.16), 0 0 10px rgba(255,170,125,0.6)`（8px の点）
- 光らないピーチ（ひらいた「＋」の × など）:
  `background: linear-gradient(180deg, #FFCDB2 0%, #FFC4A4 100%); box-shadow: inset 0 1px 0 rgba(255,255,255,0.55), 0 4px 12px rgba(4,6,14,0.28)`
- 決まり: 暖かい光は 1 画面に 1 か所。主ボタンがあればそこ、無ければ雰囲気の点。シートを開いている間は、シートの主ボタンが光り、後ろの画面の光は暗幕の下。ネオンや縁取りの光、複数の光は使わない。

## 5. ボタンの 3 段の決まり

| 段 | 見た目 | 何に | 1 画面の数 |
|---|---|---|---|
| 塗り（主） | ピーチの面＋濃い文字＋灯の光、高さ 56 | その画面でいちばん進めたい 1 つ | **1 つまで**（シートを開いている間は、シートの中の 1 つ） |
| 面（副） | 枠なしの少し明るい面＋上端の光、高さ 56／44 | 主の次の操作、行の中の操作、「もう一度」 | 1 か所に 2 つまで |
| 文字だけ（静か） | 面なし、主の色の文字（図像は副の色）、高さ 44 | やめる・飛ばす・行き先（履歴 ›）・再生成・「…」 | 必要なだけ。ただし同じ操作を 2 か所に置かない |

- 消す操作は別枠（6 の「ボタン：消す」）。確かめのシートの中にだけ出し、その時はピーチの塗りを使わない。
- 2 つ並べる時は「左＝文字だけ（やめる）／右＝主（残りの幅ぜんぶ）」。半々にしない。
- 枠線のボタンは作らない。枠線は入力欄と切り替えの「切」だけ。
- 迷ったら 1 段下げる（塗り→面、面→文字だけ）。ボタンを減らす方を選ぶ。

## 6. 部品（断片はそのまま貼って、文言と絵だけ替える）

### 6.1 画面の地

- いつ使う: 全画面のいちばん外側。幅 390、高さは 844 か中身に合わせて伸ばす。
- する: この 1 行を板のルートに置く。しない: 単色の地・別のグラデーションを作る。

```html
<div style="width: 390px; height: 844px; box-sizing: border-box; position: relative; overflow: hidden; background: linear-gradient(180deg, #0E1425 0%, #10162A 46%, #191826 78%, #231B20 100%); color: #FBF6F1; font-family: 'Zen Kaku Gothic New', sans-serif; font-size: 16px; line-height: 28px; font-weight: 500; letter-spacing: 0.02em; font-variant-numeric: tabular-nums; -webkit-font-smoothing: antialiased">
<!-- 画面の中身 -->
</div>
```

### 6.2 絵の頭（絵がシートへ溶ける）

- いつ使う: キャラが主役の画面（ホーム・出会う・トーク・プロフィール・始まり方）。高さは トーク 264／ホーム 420／出会う 516 が基準。
- する: 絵は無加工で置き、下端 64px の縁だけでシートの色へつなぐ。文字は縁より下。しない: 絵に色かぶせ・ぼかし・透過、絵の上に直に文字。

```html
<div style="position: absolute; left: 0; top: 0; width: 390px; height: 264px; overflow: hidden; background: #191826">
<img src="img/suzu.jpg" alt="霜月 鈴" style="position: absolute; left: 0; top: -60px; width: 390px; height: 474px; max-width: none; display: block">
</div>
<div aria-hidden="true" style="position: absolute; left: 0; top: 200px; width: 390px; height: 64px; background: linear-gradient(180deg, rgba(16,22,42,0) 0%, rgba(16,22,42,0.72) 52%, #10162A 88%, #10162A 100%)"></div>
<div style="position: absolute; left: 0; top: 264px; width: 390px; height: 580px; box-sizing: border-box; background: linear-gradient(180deg, #10162A 0%, #131729 40%, #1B1925 74%, #231B20 100%); display: flex; flex-direction: column; padding: 0 20px">
<!-- シートの中身（文字はここから） -->
</div>
```

### 6.3 絵の上の札（戻る・題・図像）

- いつ使う: 絵の上に操作や題を置く時。左上＝戻る＋名前（か題）、右上＝図像 1〜2 個。
- する: 不透明の濃い札＋影にまとめる（高さ 44）。しない: 枠線つきの丸を並べる、半透明のガラスにする、札を 3 つ以上置く。

```html
<div style="position: absolute; left: 12px; top: 12px; height: 44px; border-radius: 999px; background: #0F1528; box-shadow: inset 0 0 0 1px rgba(255,255,255,0.14), 0 6px 16px rgba(4,6,14,0.40); display: flex; align-items: center; padding: 0 16px 0 0">
<a href="#" aria-label="戻る" style="font-family: inherit; font-weight: inherit; letter-spacing: inherit; margin: 0; border: 0; box-sizing: border-box; -webkit-appearance: none; appearance: none; text-decoration: none; width: 44px; height: 44px; padding: 0; border-radius: 999px; background: transparent; color: #FBF6F1; display: flex; align-items: center; justify-content: center"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.0" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex: none; display: block"><path d="M15 5l-7 7 7 7"/></svg></a>
<span aria-hidden="true" style="width: 8px; height: 8px; border-radius: 999px; background: #F5D58C; flex: none"></span>
<h1 style="margin: 0; padding: 0 0 0 8px; font-size: 16px; line-height: 24px; font-weight: 700; letter-spacing: 0.06em; white-space: nowrap">霜月 鈴</h1>
</div>
<div style="position: absolute; right: 12px; top: 12px; height: 44px; border-radius: 999px; background: #0F1528; box-shadow: inset 0 0 0 1px rgba(255,255,255,0.14), 0 6px 16px rgba(4,6,14,0.40); display: flex; align-items: center">
<button type="button" aria-label="通話" style="font-family: inherit; font-weight: inherit; letter-spacing: inherit; margin: 0; border: 0; box-sizing: border-box; -webkit-appearance: none; appearance: none; text-decoration: none; width: 44px; height: 44px; padding: 0; border-radius: 999px; background: transparent; color: #FBF6F1; display: flex; align-items: center; justify-content: center"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex: none; display: block"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/></svg></button>
<button type="button" aria-label="メニュー" style="font-family: inherit; font-weight: inherit; letter-spacing: inherit; margin: 0; border: 0; box-sizing: border-box; -webkit-appearance: none; appearance: none; text-decoration: none; width: 44px; height: 44px; padding: 0; border-radius: 999px; background: transparent; color: #FBF6F1; display: flex; align-items: center; justify-content: center"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex: none; display: block"><path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h16"/></svg></button>
</div>
<div style="position: absolute; left: 12px; top: 68px; height: 44px; box-sizing: border-box; padding: 0 16px; border-radius: 999px; background: #0F1528; box-shadow: inset 0 0 0 1px rgba(255,255,255,0.14), 0 6px 16px rgba(4,6,14,0.40); display: flex; align-items: center; gap: 8px">
<span style="font-size: 16px; line-height: 24px; font-weight: 700; letter-spacing: 0.06em">出会う</span>
<span style="color: #FFC9AC; font-size: 13px; line-height: 20px; font-weight: 500; letter-spacing: 0.02em">今夜ひま？</span>
</div>
```

### 6.4 ふつうの頭（絵のない画面）

- いつ使う: 設定・一覧・編集など絵のない画面。戻る＋題＋操作 1 つまで。
- する: 題は 16px 太字で左寄せ、右の操作は文字だけか図像 1 つ。しない: 右に 2 つ以上置く（残りは「…」のシートへ）、塗りのボタンを頭に置く。

```html
<header style="height: 56px; box-sizing: border-box; display: flex; align-items: center; gap: 4px; padding: 0 8px">
<a href="#" aria-label="戻る" style="font-family: inherit; font-weight: inherit; letter-spacing: inherit; margin: 0; border: 0; box-sizing: border-box; -webkit-appearance: none; appearance: none; text-decoration: none; flex: none; width: 44px; height: 44px; padding: 0; border-radius: 999px; background: transparent; color: #FBF6F1; display: flex; align-items: center; justify-content: center"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.0" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex: none; display: block"><path d="M15 5l-7 7 7 7"/></svg></a>
<h1 style="margin: 0; flex: 1; min-width: 0; font-size: 16px; line-height: 24px; font-weight: 700; letter-spacing: 0.06em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis">霜月 鈴との設定</h1>
<button type="button" style="font-family: inherit; font-weight: inherit; letter-spacing: inherit; margin: 0; border: 0; box-sizing: border-box; -webkit-appearance: none; appearance: none; text-decoration: none; flex: none; height: 44px; padding: 0 12px; border-radius: 999px; background: transparent; color: #FFC9AC; display: flex; align-items: center; font-size: 15px; line-height: 20px; font-weight: 700; letter-spacing: 0.04em">保存</button>
</header>
```

### 6.5 ボタン：塗り（主）

- いつ使う: その画面でいちばん進めたい操作 1 つ（ゆうべのつづき・話す・保存・つくる）。
- する: 1 画面に 1 つだけ。高さ 56、上下に 24 の余白。しない: 2 つ並べる、小さく使う、削除に使う。

```html
<a href="#" style="font-family: inherit; font-weight: inherit; letter-spacing: inherit; margin: 0; border: 0; box-sizing: border-box; -webkit-appearance: none; appearance: none; text-decoration: none; height: 56px; border-radius: 999px; background: linear-gradient(180deg, #FFCDB2 0%, #FFC4A4 100%); box-shadow: inset 0 1px 0 rgba(255,255,255,0.55), 0 10px 28px rgba(255,150,100,0.30), 0 2px 6px rgba(255,150,100,0.22); color: #1A0B08; display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 16px; line-height: 24px; font-weight: 700; letter-spacing: 0.06em">
<span>ゆうべのつづき</span>
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.0" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex: none; display: block"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg>
</a>
```

### 6.6 ボタン：面（副）

- いつ使う: 主の次に大事な操作（とっておく・プロフィール・もう一度）。行の中の小さい操作は高さ 44。
- する: 枠線なし、少し明るい面＋上端の光。しない: 枠線を足す、ピーチで塗る、1 か所に 3 つ以上並べる。

```html
<div style="display: flex; align-items: center; gap: 8px">
<button type="button" style="font-family: inherit; font-weight: inherit; letter-spacing: inherit; margin: 0; border: 0; box-sizing: border-box; -webkit-appearance: none; appearance: none; text-decoration: none; height: 56px; padding: 0 20px 0 16px; border-radius: 999px; background: linear-gradient(180deg, #262E49 0%, #212943 100%); box-shadow: inset 0 1px 0 rgba(255,255,255,0.10), 0 4px 12px rgba(4,6,14,0.28); color: #FBF6F1; display: flex; align-items: center; gap: 6px; font-size: 15px; line-height: 20px; font-weight: 700; letter-spacing: 0.04em"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex: none; display: block"><path d="M7 4h10a1 1 0 0 1 1 1v15l-6-4-6 4V5a1 1 0 0 1 1-1z"/></svg><span>とっておく</span></button>
<button type="button" style="font-family: inherit; font-weight: inherit; letter-spacing: inherit; margin: 0; border: 0; box-sizing: border-box; -webkit-appearance: none; appearance: none; text-decoration: none; height: 44px; padding: 0 16px; border-radius: 999px; background: linear-gradient(180deg, #262E49 0%, #212943 100%); box-shadow: inset 0 1px 0 rgba(255,255,255,0.10), 0 4px 12px rgba(4,6,14,0.28); color: #FBF6F1; display: flex; align-items: center; gap: 6px; font-size: 15px; line-height: 20px; font-weight: 700; letter-spacing: 0.04em"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex: none; display: block"><path d="M20 11a8 8 0 1 0-2.3 6.3"/><path d="M20 5v6h-6"/></svg><span>もう一度</span></button>
</div>
```

### 6.7 ボタン：文字だけ（静か）

- いつ使う: やめる・飛ばす・もっと・履歴・プロフィールなど、無くても進める操作と行き先の案内。
- する: 面なし、主の色の文字（図像は副の色）、高さ 44 を確保。行き先には右向きの山形。しない: 下線、ピーチの文字を多用（ピーチの文字は「保存」「元に戻す」など決める操作だけ）。

```html
<div style="display: flex; align-items: center; gap: 16px">
<button type="button" style="font-family: inherit; font-weight: inherit; letter-spacing: inherit; margin: 0; border: 0; box-sizing: border-box; -webkit-appearance: none; appearance: none; text-decoration: none; height: 44px; padding: 0 12px 0 0; background: transparent; color: #FBF6F1; display: flex; align-items: center; gap: 6px; font-size: 15px; line-height: 20px; font-weight: 700; letter-spacing: 0.04em"><span style="color: #DCD3CE; display: flex"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex: none; display: block"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg></span><span>飛ばす</span></button>
<a href="#" style="font-family: inherit; font-weight: inherit; letter-spacing: inherit; margin: 0; border: 0; box-sizing: border-box; -webkit-appearance: none; appearance: none; text-decoration: none; height: 44px; padding: 0; color: #FBF6F1; display: flex; align-items: center; gap: 2px; font-size: 15px; line-height: 20px; font-weight: 700; letter-spacing: 0.04em"><span>履歴</span><span style="color: #DCD3CE; display: flex"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex: none; display: block"><path d="M9 5l7 7-7 7"/></svg></span></a>
<button type="button" style="font-family: inherit; font-weight: inherit; letter-spacing: inherit; margin: 0; border: 0; box-sizing: border-box; -webkit-appearance: none; appearance: none; text-decoration: none; height: 44px; padding: 0 12px; background: transparent; color: #FBF6F1; display: flex; align-items: center; font-size: 15px; line-height: 20px; font-weight: 700; letter-spacing: 0.04em">やめる</button>
</div>
```

### 6.8 ボタン：消す

- いつ使う: 削除の確かめのシートの中だけ。画面の手前には置かない（削除は「…」の奥）。
- する: 暗い赤の面＋主の色の文字＋赤い図像。メニューの行では文字だけ（色は #DBA199）。しない: 画面に常駐させる、ピーチで塗る、赤い文字を面のボタン以外の小さい字に使う。

```html
<div style="display: flex; align-items: center; gap: 16px">
<button type="button" style="font-family: inherit; font-weight: inherit; letter-spacing: inherit; margin: 0; border: 0; box-sizing: border-box; -webkit-appearance: none; appearance: none; text-decoration: none; height: 56px; padding: 0 24px 0 20px; border-radius: 999px; background: linear-gradient(180deg, #4A2226 0%, #401C21 100%); box-shadow: inset 0 1px 0 rgba(255,200,190,0.12), 0 4px 12px rgba(4,6,14,0.28); color: #FBF6F1; display: flex; align-items: center; gap: 8px; font-size: 16px; line-height: 24px; font-weight: 700; letter-spacing: 0.06em"><span style="color: #DBA199; display: flex"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex: none; display: block"><path d="M5 7h14"/><path d="M9 7V5h6v2"/><path d="M7 7l1 12a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1l1-12"/></svg></span><span>削除する</span></button>
<button type="button" style="font-family: inherit; font-weight: inherit; letter-spacing: inherit; margin: 0; border: 0; box-sizing: border-box; -webkit-appearance: none; appearance: none; text-decoration: none; height: 44px; padding: 0; background: transparent; color: #DBA199; display: flex; align-items: center; gap: 8px; font-size: 15px; line-height: 20px; font-weight: 700; letter-spacing: 0.04em"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex: none; display: block"><path d="M5 7h14"/><path d="M9 7V5h6v2"/><path d="M7 7l1 12a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1l1-12"/></svg><span>会話を削除</span></button>
</div>
```

### 6.9 図像のボタン

- いつ使う: 面つき（48）＝入力まわりの「＋」・送信。面なし（44）＝発言の「…」、頭の戻る・閉じる。
- する: 必ず aria-label を付ける。面なしの図像は副の色。しない: 意味の伝わらない図像だけのボタンを増やす（迷ったら文字を添える）。

```html
<div style="display: flex; align-items: center; gap: 12px">
<button type="button" aria-label="ひらく" style="font-family: inherit; font-weight: inherit; letter-spacing: inherit; margin: 0; border: 0; box-sizing: border-box; -webkit-appearance: none; appearance: none; text-decoration: none; width: 48px; height: 48px; padding: 0; border-radius: 999px; background: linear-gradient(180deg, #262E49 0%, #212943 100%); box-shadow: inset 0 1px 0 rgba(255,255,255,0.10), 0 4px 12px rgba(4,6,14,0.28); color: #FBF6F1; display: flex; align-items: center; justify-content: center"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.0" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex: none; display: block"><path d="M12 5v14"/><path d="M5 12h14"/></svg></button>
<button type="button" aria-label="送信" style="font-family: inherit; font-weight: inherit; letter-spacing: inherit; margin: 0; border: 0; box-sizing: border-box; -webkit-appearance: none; appearance: none; text-decoration: none; width: 48px; height: 48px; padding: 0; border-radius: 999px; background: linear-gradient(180deg, #262E49 0%, #212943 100%); box-shadow: inset 0 1px 0 rgba(255,255,255,0.10), 0 4px 12px rgba(4,6,14,0.28); color: #FFC9AC; display: flex; align-items: center; justify-content: center"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.0" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex: none; display: block"><path d="M12 19V5"/><path d="M5.5 11.5L12 5l6.5 6.5"/></svg></button>
<button type="button" aria-label="返事を止める" style="font-family: inherit; font-weight: inherit; letter-spacing: inherit; margin: 0; border: 0; box-sizing: border-box; -webkit-appearance: none; appearance: none; text-decoration: none; width: 48px; height: 48px; padding: 0; border-radius: 999px; background: linear-gradient(180deg, #262E49 0%, #212943 100%); box-shadow: inset 0 1px 0 rgba(255,255,255,0.10), 0 4px 12px rgba(4,6,14,0.28); color: #FBF6F1; display: flex; align-items: center; justify-content: center"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.0" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex: none; display: block"><rect x="7" y="7" width="10" height="10" rx="2"/></svg></button>
<button type="button" aria-label="閉じる" style="font-family: inherit; font-weight: inherit; letter-spacing: inherit; margin: 0; border: 0; box-sizing: border-box; -webkit-appearance: none; appearance: none; text-decoration: none; width: 48px; height: 48px; padding: 0; border-radius: 999px; background: linear-gradient(180deg, #FFCDB2 0%, #FFC4A4 100%); box-shadow: inset 0 1px 0 rgba(255,255,255,0.55), 0 4px 12px rgba(4,6,14,0.28); color: #1A0B08; display: flex; align-items: center; justify-content: center"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.0" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex: none; display: block"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg></button>
<button type="button" aria-label="もっと" style="font-family: inherit; font-weight: inherit; letter-spacing: inherit; margin: 0; border: 0; box-sizing: border-box; -webkit-appearance: none; appearance: none; text-decoration: none; width: 44px; height: 44px; padding: 0; border-radius: 999px; background: transparent; color: #DCD3CE; display: flex; align-items: center; justify-content: center"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex: none; display: block"><circle cx="6" cy="12" r="1.1"/><circle cx="12" cy="12" r="1.1"/><circle cx="18" cy="12" r="1.1"/></svg></button>
<button type="button" aria-label="閉じる" style="font-family: inherit; font-weight: inherit; letter-spacing: inherit; margin: 0; border: 0; box-sizing: border-box; -webkit-appearance: none; appearance: none; text-decoration: none; width: 44px; height: 44px; padding: 0; border-radius: 999px; background: transparent; color: #DCD3CE; display: flex; align-items: center; justify-content: center"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.0" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex: none; display: block"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg></button>
</div>
```

### 6.10 札：押せない（しるし）

- いつ使う: 公式・#初対面・別の流れ など、状態や分類を添えるだけの時。
- する: 文字の行（# はピーチ）か、角丸 8 の小さな面。しない: 丸薬の形にする（押せる物に見える）、枠線を付ける。

```html
<div style="display: flex; align-items: center; gap: 16px; color: #DCD3CE; font-size: 13px; line-height: 20px; font-weight: 500; letter-spacing: 0.02em">
<span><span style="color: #FFC9AC">#</span> 初対面</span>
<span><span style="color: #FFC9AC">#</span> 甘々</span>
<span style="height: 24px; padding: 0 8px; border-radius: 8px; background: #1D253B; display: flex; align-items: center">別の流れ</span>
<span style="display: flex; align-items: center; gap: 6px"><span aria-hidden="true" style="width: 8px; height: 8px; border-radius: 999px; background: #F5D58C; flex: none"></span>起きてる</span>
</div>
```

### 6.11 札：選べる（絞り込み）

- いつ使う: 出会うの一覧・アルバムの絞り込みなど、選ぶと中身が変わる時。1 行に横並び（あふれたら横に送る）。
- する: 高さ 44 の丸薬。選んだ札は暮れ色の面＋ピーチの輪＋チェック、aria-pressed を付ける。しない: 選んだ札をピーチで塗る、2 段 3 段に積む。

```html
<div style="display: flex; align-items: center; gap: 8px">
<button type="button" aria-pressed="true" style="font-family: inherit; font-weight: inherit; letter-spacing: inherit; margin: 0; border: 0; box-sizing: border-box; -webkit-appearance: none; appearance: none; text-decoration: none; height: 44px; padding: 0 16px 0 12px; border-radius: 999px; background: linear-gradient(180deg, #3D2B2F 0%, #36262A 100%); box-shadow: inset 0 0 0 1.5px #FFC9AC; color: #FBF6F1; display: flex; align-items: center; gap: 6px; font-size: 15px; line-height: 20px; font-weight: 700; letter-spacing: 0.04em; white-space: nowrap"><span style="color: #FFC9AC; display: flex"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.0" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex: none; display: block"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span><span>職場</span></button>
<button type="button" aria-pressed="false" style="font-family: inherit; font-weight: inherit; letter-spacing: inherit; margin: 0; border: 0; box-sizing: border-box; -webkit-appearance: none; appearance: none; text-decoration: none; height: 44px; padding: 0 16px; border-radius: 999px; background: linear-gradient(180deg, #262E49 0%, #212943 100%); box-shadow: inset 0 1px 0 rgba(255,255,255,0.10), 0 4px 12px rgba(4,6,14,0.28); color: #FBF6F1; display: flex; align-items: center; font-size: 15px; line-height: 20px; font-weight: 500; letter-spacing: 0.02em; white-space: nowrap">再会</button>
<button type="button" aria-pressed="false" style="font-family: inherit; font-weight: inherit; letter-spacing: inherit; margin: 0; border: 0; box-sizing: border-box; -webkit-appearance: none; appearance: none; text-decoration: none; height: 44px; padding: 0 16px; border-radius: 999px; background: linear-gradient(180deg, #262E49 0%, #212943 100%); box-shadow: inset 0 1px 0 rgba(255,255,255,0.10), 0 4px 12px rgba(4,6,14,0.28); color: #FBF6F1; display: flex; align-items: center; font-size: 15px; line-height: 20px; font-weight: 500; letter-spacing: 0.02em; white-space: nowrap">初対面</button>
</div>
```

### 6.12 顔（写真）と頭文字の札

- いつ使う: 絵がある子は丸い顔写真（44／行、28／発言の先頭、64／プロフィール）。絵が無い子は頭文字の札（色は 4 つから、同じ子はいつも同じ色）。
- する: 写真は object-fit: cover で顔を中心に。頭文字は名前の 1 文字目。しない: 適当な顔の図を描く、頭文字の札に明るい色を使う。

```html
<div style="display: flex; align-items: center; gap: 12px">
<img src="img/sakura-face.jpg" alt="さくら" style="flex: none; width: 64px; height: 64px; border-radius: 999px; display: block; object-fit: cover">
<img src="img/hinata-face.jpg" alt="ひなた" style="flex: none; width: 44px; height: 44px; border-radius: 999px; display: block; object-fit: cover">
<span aria-hidden="true" style="flex: none; width: 44px; height: 44px; border-radius: 999px; background: #2E2A4A; box-shadow: inset 0 1px 0 rgba(255,255,255,0.10); color: #FBF6F1; display: flex; align-items: center; justify-content: center; font-size: 16px; line-height: 24px; font-weight: 700; letter-spacing: 0.06em; letter-spacing: 0">澪</span>
<span aria-hidden="true" style="flex: none; width: 44px; height: 44px; border-radius: 999px; background: #1E3437; box-shadow: inset 0 1px 0 rgba(255,255,255,0.10); color: #FBF6F1; display: flex; align-items: center; justify-content: center; font-size: 16px; line-height: 24px; font-weight: 700; letter-spacing: 0.06em; letter-spacing: 0">紬</span>
<span aria-hidden="true" style="flex: none; width: 44px; height: 44px; border-radius: 999px; background: #3B2630; box-shadow: inset 0 1px 0 rgba(255,255,255,0.10); color: #FBF6F1; display: flex; align-items: center; justify-content: center; font-size: 16px; line-height: 24px; font-weight: 700; letter-spacing: 0.06em; letter-spacing: 0">玲</span>
<span aria-hidden="true" style="flex: none; width: 44px; height: 44px; border-radius: 999px; background: #38291C; box-shadow: inset 0 1px 0 rgba(255,255,255,0.10); color: #FBF6F1; display: flex; align-items: center; justify-content: center; font-size: 16px; line-height: 24px; font-weight: 700; letter-spacing: 0.06em; letter-spacing: 0">夜</span>
</div>
```

### 6.13 節の見出し（右に行き先）

- いつ使う: 一覧や設定のかたまりの頭。右の行き先は 1 つまで。
- する: 見出し 16px 太字、行き先は文字だけ＋山形。しない: 見出しを大きくする（名前の 32px と競る）、見出しに面を敷く。

```html
<div style="display: flex; align-items: center; height: 44px">
<h2 style="margin: 0; flex: 1; font-size: 16px; line-height: 24px; font-weight: 700; letter-spacing: 0.06em; letter-spacing: 0.04em">つづきから</h2>
<a href="#" style="font-family: inherit; font-weight: inherit; letter-spacing: inherit; margin: 0; border: 0; box-sizing: border-box; -webkit-appearance: none; appearance: none; text-decoration: none; flex: none; height: 44px; padding: 0 0 0 12px; color: #FBF6F1; display: flex; align-items: center; gap: 2px; font-size: 15px; line-height: 20px; font-weight: 500; letter-spacing: 0.02em"><span>履歴</span><span style="color: #DCD3CE; display: flex"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex: none; display: block"><path d="M9 5l7 7-7 7"/></svg></span></a>
</div>
```

### 6.14 一覧の行（顔＋名前＋ひとこと＋日時）

- いつ使う: つづきから・履歴・キャラの一覧。行全体が 1 つのリンク。
- する: 高さ 64、行の間は上端の細い線。操作を足すなら行末に「…」1 つだけ。しない: 行ごとにボタンを 2 つ以上置く、行を枠で囲む。

```html
<div style="display: flex; flex-direction: column">
<a href="#" aria-label="さくらとの会話をつづきから話す" style="font-family: inherit; font-weight: inherit; letter-spacing: inherit; margin: 0; border: 0; box-sizing: border-box; -webkit-appearance: none; appearance: none; text-decoration: none; height: 64px; box-shadow: inset 0 1px 0 rgba(255,255,255,0.08); color: #FBF6F1; display: flex; align-items: center; gap: 12px">
<img src="img/sakura-face.jpg" alt="" style="flex: none; width: 44px; height: 44px; border-radius: 999px; display: block; object-fit: cover">
<span style="flex: 1; min-width: 0; display: flex; flex-direction: column">
<span style="font-size: 15px; line-height: 20px; font-weight: 700; letter-spacing: 0.04em; white-space: nowrap">さくら</span>
<span style="color: #DCD3CE; font-size: 13px; line-height: 20px; font-weight: 500; letter-spacing: 0.02em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis">「また、あのカフェで」</span>
</span>
<span style="flex: none; color: #DCD3CE; font-size: 13px; line-height: 20px; font-weight: 500; letter-spacing: 0.02em">火曜</span>
</a>
<a href="#" aria-label="霧島 澪との会話をつづきから話す" style="font-family: inherit; font-weight: inherit; letter-spacing: inherit; margin: 0; border: 0; box-sizing: border-box; -webkit-appearance: none; appearance: none; text-decoration: none; height: 64px; box-shadow: inset 0 1px 0 rgba(255,255,255,0.08); color: #FBF6F1; display: flex; align-items: center; gap: 12px">
<span aria-hidden="true" style="flex: none; width: 44px; height: 44px; border-radius: 999px; background: #2E2A4A; box-shadow: inset 0 1px 0 rgba(255,255,255,0.10); color: #FBF6F1; display: flex; align-items: center; justify-content: center; font-size: 16px; line-height: 24px; font-weight: 700; letter-spacing: 0.06em; letter-spacing: 0">澪</span>
<span style="flex: 1; min-width: 0; display: flex; flex-direction: column">
<span style="font-size: 15px; line-height: 20px; font-weight: 700; letter-spacing: 0.04em; white-space: nowrap">霧島 澪</span>
<span style="color: #DCD3CE; font-size: 13px; line-height: 20px; font-weight: 500; letter-spacing: 0.02em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis">「閉店の札はもう出したから」</span>
</span>
<span style="flex: none; color: #DCD3CE; font-size: 13px; line-height: 20px; font-weight: 500; letter-spacing: 0.02em">10月29日</span>
</a>
</div>
```

### 6.15 吹き出し（自分・相手・地の文・心の声）

- いつ使う: トーク・グループ・読む画面。相手＝左の面、自分＝右の暮れ色、地の文＝面なしの副の色、心の声＝ピーチの細い枠＋見出し。
- する: 本文は 16/28・500。話し手の側の角だけ 8。同じ返事の中は 8、発言の間は 16 あける。しない: 破線の枠（未送信と紛れる）、吹き出しに枠線、文字を 15px 以下にする。

```html
<div style="display: flex; flex-direction: column; gap: 8px">
<div style="display: flex; align-items: center; justify-content: flex-end; gap: 4px">
<button type="button" aria-label="自分の発言の操作（書き直す・ここから戻る）" style="font-family: inherit; font-weight: inherit; letter-spacing: inherit; margin: 0; border: 0; box-sizing: border-box; -webkit-appearance: none; appearance: none; text-decoration: none; flex: none; width: 44px; height: 44px; padding: 0; border-radius: 999px; background: transparent; color: #DCD3CE; display: flex; align-items: center; justify-content: center"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex: none; display: block"><circle cx="6" cy="12" r="1.1"/><circle cx="12" cy="12" r="1.1"/><circle cx="18" cy="12" r="1.1"/></svg></button>
<div style="box-sizing: border-box; padding: 12px 16px; border-radius: 20px 20px 8px 20px; background: linear-gradient(180deg, #3C2428 0%, #352024 100%); box-shadow: inset 0 1px 0 rgba(255,228,214,0.10), 0 6px 16px rgba(4,6,14,0.30); color: #FBF6F1; font-size: 16px; line-height: 28px; font-weight: 500; letter-spacing: 0.02em">ただいま。少しだけ、話を聞いて。</div>
</div>
<div style="color: #DCD3CE; font-size: 16px; line-height: 28px; font-weight: 500; letter-spacing: 0.02em; padding: 8px 0 0">鈴はペンを置き、ソファの端を空けた。</div>
<div style="flex: none; align-self: flex-start; max-width: 100%; display: flex; align-items: flex-end; gap: 4px"><div style="min-width: 0; max-width: 100%; box-sizing: border-box; padding: 12px 16px; border-radius: 20px 20px 20px 8px; background: linear-gradient(180deg, #212941 0%, #1D253B 100%); box-shadow: inset 0 1px 0 rgba(255,255,255,0.07), 0 6px 16px rgba(4,6,14,0.30); color: #FBF6F1; font-size: 16px; line-height: 28px; font-weight: 500; letter-spacing: 0.02em">「ん。…座れば。<br>コーヒー、ぬるいけど」</div><button type="button" aria-label="この返事を声で聞く" style="font-family: inherit; font-weight: inherit; letter-spacing: inherit; margin: 0; border: 0; box-sizing: border-box; -webkit-appearance: none; appearance: none; text-decoration: none; flex: none; width: 44px; height: 44px; padding: 0; border-radius: 999px; background: transparent; color: #DCD3CE; display: flex; align-items: center; justify-content: center"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex: none; display: block"><path d="M4 10v4h3l5 4V6L7 10H4z"/><path d="M16 9a4 4 0 0 1 0 6"/><path d="M18.5 6.5a7.5 7.5 0 0 1 0 11"/></svg></button></div>
<div style="align-self: flex-start; max-width: 100%; box-sizing: border-box; padding: 8px 16px 12px; border-radius: 20px; border: 1px solid #7A6058; color: #FBF6F1; font-size: 16px; line-height: 28px; font-weight: 500; letter-spacing: 0.02em">
<div style="display: flex; align-items: center; gap: 6px; color: #FFC9AC; font-size: 13px; line-height: 20px; font-weight: 500; letter-spacing: 0.02em"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex: none; display: block"><path d="M12 20s-7-4.4-7-9.6A3.9 3.9 0 0 1 12 8a3.9 3.9 0 0 1 7 2.4C19 15.6 12 20 12 20z"/></svg><span>心の声</span></div>
<div>来てくれて、ほっとした。</div>
</div>
</div>
```

### 6.16 返事の操作の 1 行

- いつ使う: 最新の返事のすぐ下に 1 回だけ。古い返事は「…」だけ。
- する: 別の返事 ‹2/3›（面）＋再生成（文字）＋もっと（図像）。しない: 音声・コピー・しおりをここに並べる（「もっと」のシートへ）。

```html
<div style="display: flex; align-items: center; gap: 4px">
<div style="flex: none; height: 44px; border-radius: 999px; background: linear-gradient(180deg, #262E49 0%, #212943 100%); box-shadow: inset 0 1px 0 rgba(255,255,255,0.10), 0 4px 12px rgba(4,6,14,0.28); display: flex; align-items: center">
<button type="button" aria-label="前の返事" style="font-family: inherit; font-weight: inherit; letter-spacing: inherit; margin: 0; border: 0; box-sizing: border-box; -webkit-appearance: none; appearance: none; text-decoration: none; width: 44px; height: 44px; padding: 0; border-radius: 999px; background: transparent; color: #FBF6F1; display: flex; align-items: center; justify-content: center"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex: none; display: block"><path d="M15 5l-7 7 7 7"/></svg></button>
<span style="color: #DCD3CE; font-size: 13px; line-height: 20px; font-weight: 500; letter-spacing: 0.02em; white-space: nowrap">別の返事</span>
<span style="padding: 0 0 0 8px; color: #FBF6F1; font-size: 15px; line-height: 20px; font-weight: 700; letter-spacing: 0.04em; white-space: nowrap">2/3</span>
<button type="button" aria-label="次の返事" style="font-family: inherit; font-weight: inherit; letter-spacing: inherit; margin: 0; border: 0; box-sizing: border-box; -webkit-appearance: none; appearance: none; text-decoration: none; width: 44px; height: 44px; padding: 0; border-radius: 999px; background: transparent; color: #FBF6F1; display: flex; align-items: center; justify-content: center"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex: none; display: block"><path d="M9 5l7 7-7 7"/></svg></button>
</div>
<span style="flex: 1"></span>
<button type="button" style="font-family: inherit; font-weight: inherit; letter-spacing: inherit; margin: 0; border: 0; box-sizing: border-box; -webkit-appearance: none; appearance: none; text-decoration: none; flex: none; height: 44px; padding: 0 12px; border-radius: 999px; background: transparent; color: #FBF6F1; display: flex; align-items: center; gap: 6px; font-size: 15px; line-height: 20px; font-weight: 500; letter-spacing: 0.02em"><span style="color: #DCD3CE; display: flex"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex: none; display: block"><path d="M20 11a8 8 0 1 0-2.3 6.3"/><path d="M20 5v6h-6"/></svg></span><span>再生成</span></button>
<button type="button" aria-label="もっと（この返事の操作）" style="font-family: inherit; font-weight: inherit; letter-spacing: inherit; margin: 0; border: 0; box-sizing: border-box; -webkit-appearance: none; appearance: none; text-decoration: none; flex: none; width: 44px; height: 44px; padding: 0; border-radius: 999px; background: transparent; color: #DCD3CE; display: flex; align-items: center; justify-content: center"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex: none; display: block"><circle cx="6" cy="12" r="1.1"/><circle cx="12" cy="12" r="1.1"/><circle cx="18" cy="12" r="1.1"/></svg></button>
</div>
```

### 6.17 場面と雰囲気の丸薬

- いつ使う: トークのいちばん上（絵のすぐ下）。左＝いまの場面を開く、右＝雰囲気を動かす（いまの値を表示）。
- する: 1 本の面の丸薬を細い線で 2 つに分ける。灯の点（光つき）はここだけ。しない: 雰囲気を入力欄のそばにもう 1 つ置く。

```html
<div style="height: 44px; border-radius: 999px; background: linear-gradient(180deg, #262E49 0%, #212943 100%); box-shadow: inset 0 1px 0 rgba(255,255,255,0.10), 0 4px 12px rgba(4,6,14,0.28); display: flex; align-items: center">
<button type="button" aria-label="いまの場面を開く 金曜の夜・鈴の部屋" style="font-family: inherit; font-weight: inherit; letter-spacing: inherit; margin: 0; border: 0; box-sizing: border-box; -webkit-appearance: none; appearance: none; text-decoration: none; flex: 1 1 0; min-width: 0; height: 44px; padding: 0 8px 0 16px; border-radius: 999px 0 0 999px; background: transparent; color: #FBF6F1; display: flex; align-items: center; gap: 8px; font-size: 15px; line-height: 20px; font-weight: 500; letter-spacing: 0.02em; text-align: left"><span style="color: #DCD3CE; display: flex"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex: none; display: block"><path d="M12 21s-6.5-5.6-6.5-10.5a6.5 6.5 0 0 1 13 0C18.5 15.4 12 21 12 21z"/><circle cx="12" cy="10.5" r="2.2"/></svg></span><span style="white-space: nowrap">金曜の夜・鈴の部屋</span></button>
<span aria-hidden="true" style="flex: none; width: 1px; height: 20px; background: rgba(255,255,255,0.16)"></span>
<button type="button" aria-label="雰囲気を動かす いまは親しい" style="font-family: inherit; font-weight: inherit; letter-spacing: inherit; margin: 0; border: 0; box-sizing: border-box; -webkit-appearance: none; appearance: none; text-decoration: none; flex: none; height: 44px; padding: 0 12px 0 14px; border-radius: 0 999px 999px 0; background: transparent; color: #FBF6F1; display: flex; align-items: center; gap: 8px; font-size: 15px; line-height: 20px; font-weight: 700; letter-spacing: 0.04em"><span aria-hidden="true" style="width: 8px; height: 8px; border-radius: 999px; background: #FFC9AC; box-shadow: 0 0 0 4px rgba(255,170,125,0.16), 0 0 10px rgba(255,170,125,0.6); flex: none"></span><span>親しい</span><span style="color: #DCD3CE; display: flex"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex: none; display: block"><path d="M5 9l7 7 7-7"/></svg></span></button>
</div>
```

### 6.18 返事の候補の 1 行と入力（＋つき）

- いつ使う: トークとグループの下。2 段まで（候補の 1 行＋入力の 1 行）。帯は画面の下に固定。
- する: 候補は横に送れる 1 行。画像・声・心の声・しおり・場面は「＋」のトレーへ。返事を待つ間は送信を「止める」に替える。しない: 3 段目を足す、候補を折り返す。

```html
<div style="width: 390px; box-sizing: border-box; background: #1C171F; box-shadow: inset 0 1px 0 rgba(255,255,255,0.08); display: flex; flex-direction: column; padding: 12px 0 16px">
<div role="group" aria-label="返事の候補" style="display: flex; gap: 8px; overflow: hidden; padding: 0 0 12px 16px">
<button type="button" style="font-family: inherit; font-weight: inherit; letter-spacing: inherit; margin: 0; border: 0; box-sizing: border-box; -webkit-appearance: none; appearance: none; text-decoration: none; flex: none; height: 44px; padding: 0 16px; border-radius: 999px; background: linear-gradient(180deg, #262E49 0%, #212943 100%); box-shadow: inset 0 1px 0 rgba(255,255,255,0.10), 0 4px 12px rgba(4,6,14,0.28); color: #FBF6F1; display: flex; align-items: center; font-size: 15px; line-height: 20px; font-weight: 500; letter-spacing: 0.02em; white-space: nowrap">隣に座る</button>
<button type="button" style="font-family: inherit; font-weight: inherit; letter-spacing: inherit; margin: 0; border: 0; box-sizing: border-box; -webkit-appearance: none; appearance: none; text-decoration: none; flex: none; height: 44px; padding: 0 16px; border-radius: 999px; background: linear-gradient(180deg, #262E49 0%, #212943 100%); box-shadow: inset 0 1px 0 rgba(255,255,255,0.10), 0 4px 12px rgba(4,6,14,0.28); color: #FBF6F1; display: flex; align-items: center; font-size: 15px; line-height: 20px; font-weight: 500; letter-spacing: 0.02em; white-space: nowrap">ぐちを言う</button>
<button type="button" style="font-family: inherit; font-weight: inherit; letter-spacing: inherit; margin: 0; border: 0; box-sizing: border-box; -webkit-appearance: none; appearance: none; text-decoration: none; flex: none; height: 44px; padding: 0 16px; border-radius: 999px; background: linear-gradient(180deg, #262E49 0%, #212943 100%); box-shadow: inset 0 1px 0 rgba(255,255,255,0.10), 0 4px 12px rgba(4,6,14,0.28); color: #FBF6F1; display: flex; align-items: center; font-size: 15px; line-height: 20px; font-weight: 500; letter-spacing: 0.02em; white-space: nowrap">もらうよ</button>
</div>
<div style="display: flex; align-items: center; gap: 8px; padding: 0 16px">
<button type="button" aria-label="ひらく（画像・電話・しおり・場面）" aria-expanded="false" style="font-family: inherit; font-weight: inherit; letter-spacing: inherit; margin: 0; border: 0; box-sizing: border-box; -webkit-appearance: none; appearance: none; text-decoration: none; flex: none; width: 48px; height: 48px; padding: 0; border-radius: 999px; background: linear-gradient(180deg, #262E49 0%, #212943 100%); box-shadow: inset 0 1px 0 rgba(255,255,255,0.10), 0 4px 12px rgba(4,6,14,0.28); color: #FBF6F1; display: flex; align-items: center; justify-content: center"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.0" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex: none; display: block"><path d="M12 5v14"/><path d="M5 12h14"/></svg></button>
<input type="text" aria-label="メッセージ" placeholder="なに話す？" style="font-family: inherit; font-weight: inherit; letter-spacing: inherit; margin: 0; border: 0; box-sizing: border-box; -webkit-appearance: none; appearance: none; text-decoration: none; flex: 1 1 0; min-width: 0; height: 48px; padding: 0 20px; outline: none; border-radius: 999px; background: #0B0F1A; border: 1px solid #8C8497; color: #FBF6F1; font-size: 16px; line-height: 24px; font-weight: 500; letter-spacing: 0.02em">
<button type="button" aria-label="送信" style="font-family: inherit; font-weight: inherit; letter-spacing: inherit; margin: 0; border: 0; box-sizing: border-box; -webkit-appearance: none; appearance: none; text-decoration: none; flex: none; width: 48px; height: 48px; padding: 0; border-radius: 999px; background: linear-gradient(180deg, #262E49 0%, #212943 100%); box-shadow: inset 0 1px 0 rgba(255,255,255,0.10), 0 4px 12px rgba(4,6,14,0.28); color: #FFC9AC; display: flex; align-items: center; justify-content: center"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.0" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex: none; display: block"><path d="M12 19V5"/><path d="M5.5 11.5L12 5l6.5 6.5"/></svg></button>
</div>
</div>
```

### 6.19 トレー（「＋」をひらいた時）のまとまり

- いつ使う: 「＋」や、項目の多い操作の集まり。よく使う物は大きい面 2 つ、残りは見出しつきの一覧の札。
- する: 意味でまとめて見出し（13px・副）を付ける。値は行の右に副の色（入っている物はピーチ）。しない: 同じ形の枠を 6 個以上並べる。

```html
<div style="display: flex; flex-direction: column; gap: 8px">
<div style="color: #DCD3CE; font-size: 13px; line-height: 20px; font-weight: 500; letter-spacing: 0.02em; padding: 0 4px">よく使う</div>
<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px">
<button type="button" style="font-family: inherit; font-weight: inherit; letter-spacing: inherit; margin: 0; border: 0; box-sizing: border-box; -webkit-appearance: none; appearance: none; text-decoration: none; height: 52px; padding: 0 16px; border-radius: 20px; background: linear-gradient(180deg, #262E49 0%, #212943 100%); box-shadow: inset 0 1px 0 rgba(255,255,255,0.10), 0 4px 12px rgba(4,6,14,0.28); color: #FBF6F1; display: flex; align-items: center; gap: 12px; text-align: left; font-size: 15px; line-height: 20px; font-weight: 700; letter-spacing: 0.04em"><span style="color: #FFC9AC; display: flex"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex: none; display: block"><rect x="3.5" y="5" width="17" height="14" rx="3"/><circle cx="9" cy="10" r="1.6"/><path d="M4.5 17l4.5-4.5 3.5 3.5 2.5-2.5 4.5 4.5"/></svg></span><span style="white-space: nowrap">画像をもらう</span></button>
<button type="button" style="font-family: inherit; font-weight: inherit; letter-spacing: inherit; margin: 0; border: 0; box-sizing: border-box; -webkit-appearance: none; appearance: none; text-decoration: none; height: 52px; padding: 0 16px; border-radius: 20px; background: linear-gradient(180deg, #262E49 0%, #212943 100%); box-shadow: inset 0 1px 0 rgba(255,255,255,0.10), 0 4px 12px rgba(4,6,14,0.28); color: #FBF6F1; display: flex; align-items: center; gap: 12px; text-align: left; font-size: 15px; line-height: 20px; font-weight: 700; letter-spacing: 0.04em"><span style="color: #FFC9AC; display: flex"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex: none; display: block"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/></svg></span><span style="white-space: nowrap">電話する</span></button>
</div>
<div style="color: #DCD3CE; font-size: 13px; line-height: 20px; font-weight: 500; letter-spacing: 0.02em; padding: 8px 4px 0">この会話</div>
<div style="border-radius: 20px; overflow: hidden; background: linear-gradient(180deg, #212941 0%, #1D253B 100%); box-shadow: inset 0 1px 0 rgba(255,255,255,0.07), 0 6px 16px rgba(4,6,14,0.30); display: flex; flex-direction: column">
<button type="button" aria-label="雰囲気を動かす いまは親しい" style="font-family: inherit; font-weight: inherit; letter-spacing: inherit; margin: 0; border: 0; box-sizing: border-box; -webkit-appearance: none; appearance: none; text-decoration: none; height: 44px; padding: 0 12px 0 16px; background: transparent; color: #FBF6F1; display: flex; align-items: center; gap: 8px; text-align: left; font-size: 15px; line-height: 20px; font-weight: 500; letter-spacing: 0.02em"><span style="flex: 1; min-width: 0; white-space: nowrap">雰囲気</span><span style="color: #DCD3CE; font-size: 13px; line-height: 20px; font-weight: 500; letter-spacing: 0.02em; white-space: nowrap">親しい</span></button>
<button type="button" aria-label="心の声を表示" style="font-family: inherit; font-weight: inherit; letter-spacing: inherit; margin: 0; border: 0; box-sizing: border-box; -webkit-appearance: none; appearance: none; text-decoration: none; height: 44px; padding: 0 12px 0 16px; background: transparent; box-shadow: inset 0 1px 0 rgba(255,255,255,0.08); color: #FBF6F1; display: flex; align-items: center; gap: 8px; text-align: left; font-size: 15px; line-height: 20px; font-weight: 500; letter-spacing: 0.02em"><span style="flex: 1; min-width: 0; white-space: nowrap">心の声</span><span style="color: #DCD3CE; font-size: 13px; line-height: 20px; font-weight: 500; letter-spacing: 0.02em; white-space: nowrap">オフ</span></button>
<button type="button" aria-label="返事の候補" style="font-family: inherit; font-weight: inherit; letter-spacing: inherit; margin: 0; border: 0; box-sizing: border-box; -webkit-appearance: none; appearance: none; text-decoration: none; height: 44px; padding: 0 12px 0 16px; background: transparent; box-shadow: inset 0 1px 0 rgba(255,255,255,0.08); color: #FBF6F1; display: flex; align-items: center; gap: 8px; text-align: left; font-size: 15px; line-height: 20px; font-weight: 500; letter-spacing: 0.02em"><span style="flex: 1; min-width: 0; white-space: nowrap">返事の候補</span><span style="color: #FFC9AC; font-size: 13px; line-height: 20px; font-weight: 500; letter-spacing: 0.02em; white-space: nowrap">オン</span></button>
</div>
</div>
```

### 6.20 画像の札と並び

- いつ使う: アルバム・この会話のアルバム・画像つきの返事。並びは 3 列・間 4、返事の中の 1 枚は幅いっぱい・角丸 20。
- する: 札は画像だけのボタン（aria-label 必須）、角丸 12。重ねる操作は不透明の札 1 つまで。しない: 画像の上に直に文字、角ごとに図像を散らす。

```html
<div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 4px">
<button type="button" aria-label="霜月 鈴の画像を全画面で見る" style="font-family: inherit; font-weight: inherit; letter-spacing: inherit; margin: 0; border: 0; box-sizing: border-box; -webkit-appearance: none; appearance: none; text-decoration: none; position: relative; overflow: hidden; height: 148px; padding: 0; border-radius: 12px; background: #191826; display: block"><img src="img/suzu.jpg" alt="" style="position: absolute; left: -40px; top: -40px; width: 196px; height: 238px; max-width: none; display: block"></button>
<button type="button" aria-label="ひなたの画像を全画面で見る" style="font-family: inherit; font-weight: inherit; letter-spacing: inherit; margin: 0; border: 0; box-sizing: border-box; -webkit-appearance: none; appearance: none; text-decoration: none; position: relative; overflow: hidden; height: 148px; padding: 0; border-radius: 12px; background: #191826; display: block"><img src="img/hinata.jpg" alt="" style="position: absolute; left: -1px; top: 0; width: 118px; height: 148px; max-width: none; display: block"></button>
<button type="button" aria-label="さくらの画像を全画面で見る" style="font-family: inherit; font-weight: inherit; letter-spacing: inherit; margin: 0; border: 0; box-sizing: border-box; -webkit-appearance: none; appearance: none; text-decoration: none; position: relative; overflow: hidden; height: 148px; padding: 0; border-radius: 12px; background: #191826; display: block"><img src="img/sakura-face.jpg" alt="" style="position: absolute; left: -17px; top: 0; width: 148px; height: 148px; max-width: none; display: block"></button>
</div>
```

### 6.21 待っている時のしるし

- いつ使う: 返事を待つ間＝相手の吹き出しに点 3 つ（送信は「止める」に替わる）。画像・4コマ・クリップなど、つくっている物＝待つ札（1 行目＋進み具合の線＋右に文字だけの「止める」。長引いたら「まだ描いています」＋ 2 行目「このまま待てます。」）。
- する: 静かに、画面の流れの中に置く。言葉は「描いています」「読み込んでいます」。つくっている間は、どの板でも「止める」を出す。しない: 画面全体を覆う、割合や秒数を出す、ポップアップで知らせる。

```html
<div style="display: flex; flex-direction: column; gap: 16px">
<div role="status" aria-label="返事を書いています" style="align-self: flex-start; height: 52px; box-sizing: border-box; padding: 0 20px; border-radius: 20px 20px 20px 8px; background: linear-gradient(180deg, #212941 0%, #1D253B 100%); box-shadow: inset 0 1px 0 rgba(255,255,255,0.07), 0 6px 16px rgba(4,6,14,0.30); display: flex; align-items: center; gap: 6px">
<span aria-hidden="true" style="width: 8px; height: 8px; border-radius: 999px; background: #DCD3CE; opacity: 0.9"></span>
<span aria-hidden="true" style="width: 8px; height: 8px; border-radius: 999px; background: #DCD3CE; opacity: 0.6"></span>
<span aria-hidden="true" style="width: 8px; height: 8px; border-radius: 999px; background: #DCD3CE; opacity: 0.35"></span>
</div>
<div role="status" style="display: flex; flex-direction: column; padding: 4px 4px 16px 16px; border-radius: 20px; background: linear-gradient(180deg, #212941 0%, #1D253B 100%); box-shadow: inset 0 1px 0 rgba(255,255,255,0.07), 0 6px 16px rgba(4,6,14,0.30)">
<div style="display: flex; align-items: center; gap: 8px"><span style="flex: 1; min-width: 0; color: #FBF6F1; font-size: 15px; line-height: 20px; font-weight: 500; letter-spacing: 0.02em">まだ描いています</span><button type="button" aria-label="画像を描くのを止める" style="font-family: inherit; font-weight: inherit; letter-spacing: inherit; margin: 0; border: 0; box-sizing: border-box; -webkit-appearance: none; appearance: none; text-decoration: none; flex: none; height: 44px; padding: 0 12px; border-radius: 999px; background: transparent; color: #FBF6F1; display: flex; align-items: center; font-size: 15px; line-height: 20px; font-weight: 700; letter-spacing: 0.04em">止める</button></div>
<div style="padding: 0 12px 0 0"><div aria-hidden="true" style="height: 4px; border-radius: 999px; background: #0B0F1A; overflow: hidden"><div style="width: 72%; height: 4px; border-radius: 999px; background: #FFC9AC"></div></div></div>
<div style="color: #DCD3CE; font-size: 13px; line-height: 20px; font-weight: 500; letter-spacing: 0.02em; padding: 8px 12px 0 0">このまま待てます。</div>
</div>
</div>
```

### 6.22 入力欄（見出し・欄・補足・エラー）

- いつ使う: つくる・編集・設定の 1 行の入力。見出しは欄の上。
- する: 欄は窪み＋ 1px の枠（角丸 12、高さ 48、文字 16px）。エラーは枠を赤にして下に 1 行。しない: 見出しを欄の中の薄い字だけで済ます、エラーをポップアップで出す。

```html
<div style="display: flex; flex-direction: column; gap: 16px">
<div style="display: flex; flex-direction: column; gap: 8px">
<label for="kit-name" style="color: #FBF6F1; font-size: 15px; line-height: 20px; font-weight: 700; letter-spacing: 0.04em">名前</label>
<input id="kit-name" type="text" value="霜月 鈴" style="font-family: inherit; font-weight: inherit; letter-spacing: inherit; margin: 0; border: 0; box-sizing: border-box; -webkit-appearance: none; appearance: none; text-decoration: none; height: 48px; padding: 0 16px; outline: none; border-radius: 12px; background: #0B0F1A; border: 1px solid #8C8497; color: #FBF6F1; font-size: 16px; line-height: 24px; font-weight: 500; letter-spacing: 0.02em">
<div style="color: #DCD3CE; font-size: 13px; line-height: 20px; font-weight: 500; letter-spacing: 0.02em">一覧とトークの上に出ます。</div>
</div>
<div style="display: flex; flex-direction: column; gap: 8px">
<label for="kit-title" style="color: #FBF6F1; font-size: 15px; line-height: 20px; font-weight: 700; letter-spacing: 0.04em">会話の名前</label>
<input id="kit-title" type="text" placeholder="例: 金曜の夜" aria-invalid="true" aria-describedby="kit-title-error" style="font-family: inherit; font-weight: inherit; letter-spacing: inherit; margin: 0; border: 0; box-sizing: border-box; -webkit-appearance: none; appearance: none; text-decoration: none; height: 48px; padding: 0 16px; outline: none; border-radius: 12px; background: #0B0F1A; border: 1px solid rgba(219,161,153,0.72); color: #FBF6F1; font-size: 16px; line-height: 24px; font-weight: 500; letter-spacing: 0.02em">
<div id="kit-title-error" style="display: flex; align-items: center; gap: 6px; color: #DBA199; font-size: 13px; line-height: 20px; font-weight: 500; letter-spacing: 0.02em"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex: none; display: block"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v5.5"/><path d="M12 16v.5"/></svg><span>名前を入れてください。</span></div>
</div>
</div>
```

### 6.23 長い入力欄

- いつ使う: 性格・あらすじ・秘めた面・記憶の書き換えなど、数行の文。
- する: 高さは 4 行ぶん（136）から。本文は 16/28。欄の右下に数え「M / N」（副の字 13px・数字は等幅。複数行の欄はいつも、1 行の欄は上限の 8 割を超えたら）。超えたら数えを失敗の色＋「!」の印にし、左に「◯◯は N 文字までです。いま M 文字です。」。上限は WORDING「文字数の上限」。しない: 残りの数だけを出す、欄の中にボタンを置く。

```html
<div style="display: flex; flex-direction: column; gap: 8px">
<label for="kit-secret" style="color: #FBF6F1; font-size: 15px; line-height: 20px; font-weight: 700; letter-spacing: 0.04em">秘めた面</label>
<textarea id="kit-secret" rows="4" style="font-family: inherit; font-weight: inherit; letter-spacing: inherit; margin: 0; border: 0; box-sizing: border-box; -webkit-appearance: none; appearance: none; text-decoration: none; height: 136px; padding: 12px 16px; outline: none; resize: none; border-radius: 12px; background: #0B0F1A; border: 1px solid #8C8497; color: #FBF6F1; font-size: 16px; line-height: 28px; font-weight: 500; letter-spacing: 0.02em; display: block">二人きりになると、先に袖をつかむ。</textarea>
<div style="display: flex; align-items: flex-start; gap: 12px; padding: 0"><span style="flex: 1; min-width: 0; display: flex; flex-direction: column"></span><span role="img" aria-label="17 文字。上限は 2,000 文字" style="flex: none; color: #DCD3CE; font-size: 13px; line-height: 20px; font-weight: 500; letter-spacing: 0.02em; font-variant-numeric: tabular-nums; white-space: nowrap; display: flex; align-items: center; gap: 4px"><span aria-hidden="true">17 / 2,000</span></span></div>
</div>
```

### 6.24 設定の札（選ぶ行・切り替えの行）

- いつ使う: 設定・その子との設定。行を押すと下からのシートで選ぶ（選ぶ行）か、その場で入切する（切り替え）。
- する: 意味の近い行を 1 つの札（面・角丸 20）にまとめ、行は高さ 52・間は細い線。切り替えは行全体を押せるように。しない: 行ごとに枠、同じ設定を別の画面にも置く。

```html
<div style="border-radius: 20px; overflow: hidden; background: linear-gradient(180deg, #212941 0%, #1D253B 100%); box-shadow: inset 0 1px 0 rgba(255,255,255,0.07), 0 6px 16px rgba(4,6,14,0.30); display: flex; flex-direction: column">
<button type="button" style="font-family: inherit; font-weight: inherit; letter-spacing: inherit; margin: 0; border: 0; box-sizing: border-box; -webkit-appearance: none; appearance: none; text-decoration: none; height: 52px; padding: 0 12px 0 16px; background: transparent; color: #FBF6F1; display: flex; align-items: center; gap: 8px; text-align: left; font-size: 16px; line-height: 28px; font-weight: 500; letter-spacing: 0.02em"><span style="flex: 1; min-width: 0; white-space: nowrap">返事の長さ</span><span style="color: #DCD3CE; font-size: 15px; line-height: 20px; font-weight: 500; letter-spacing: 0.02em; white-space: nowrap">ふつう</span><span style="color: #DCD3CE; display: flex"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex: none; display: block"><path d="M9 5l7 7-7 7"/></svg></span></button>
<button type="button" role="switch" aria-checked="true" style="font-family: inherit; font-weight: inherit; letter-spacing: inherit; margin: 0; border: 0; box-sizing: border-box; -webkit-appearance: none; appearance: none; text-decoration: none; height: 52px; padding: 0 16px; background: transparent; box-shadow: inset 0 1px 0 rgba(255,255,255,0.08); color: #FBF6F1; display: flex; align-items: center; gap: 8px; text-align: left; font-size: 16px; line-height: 28px; font-weight: 500; letter-spacing: 0.02em"><span style="flex: 1; min-width: 0; white-space: nowrap">通知の文を隠す</span><span aria-hidden="true" style="flex: none; width: 52px; height: 32px; box-sizing: border-box; padding: 4px; border-radius: 999px; background: linear-gradient(180deg, #FFCDB2 0%, #FFC4A4 100%); display: flex; justify-content: flex-end"><span style="width: 24px; height: 24px; border-radius: 999px; background: #1A0B08"></span></span></button>
<button type="button" role="switch" aria-checked="false" style="font-family: inherit; font-weight: inherit; letter-spacing: inherit; margin: 0; border: 0; box-sizing: border-box; -webkit-appearance: none; appearance: none; text-decoration: none; height: 52px; padding: 0 16px; background: transparent; box-shadow: inset 0 1px 0 rgba(255,255,255,0.08); color: #FBF6F1; display: flex; align-items: center; gap: 8px; text-align: left; font-size: 16px; line-height: 28px; font-weight: 500; letter-spacing: 0.02em"><span style="flex: 1; min-width: 0; white-space: nowrap">心の声を表示</span><span aria-hidden="true" style="flex: none; width: 52px; height: 32px; box-sizing: border-box; padding: 3px; border-radius: 999px; background: #0B0F1A; border: 1px solid #8C8497; display: flex; justify-content: flex-start"><span style="width: 24px; height: 24px; border-radius: 999px; background: #DCD3CE"></span></span></button>
</div>
```

### 6.25 つまみ（値つき）と増減

- いつ使う: 声の速さ・画像の変化の強さなど連続した値＝つまみ。人数・枚数など数えられる値＝増減。
- する: いまの値を言葉か小さい整数で右に出す。両端の意味を下に添える。しない: 0.95 のような小数や単位つきの技術の値を出す。

```html
<div style="display: flex; flex-direction: column; gap: 24px">
<div style="display: flex; flex-direction: column; gap: 4px">
<div style="display: flex; align-items: center"><span style="flex: 1; color: #FBF6F1; font-size: 15px; line-height: 20px; font-weight: 700; letter-spacing: 0.04em">話す速さ</span><span style="color: #FBF6F1; font-size: 15px; line-height: 20px; font-weight: 700; letter-spacing: 0.04em">ふつう</span></div>
<div role="slider" tabindex="0" aria-label="話す速さ" aria-valuemin="1" aria-valuemax="5" aria-valuenow="3" aria-valuetext="ふつう" style="position: relative; height: 44px">
<div aria-hidden="true" style="position: absolute; left: 0; right: 0; top: 20px; height: 4px; border-radius: 999px; background: #0B0F1A; box-shadow: inset 0 0 0 1px #8C8497"></div>
<div aria-hidden="true" style="position: absolute; left: 0; top: 20px; width: 50%; height: 4px; border-radius: 999px; background: #FFC9AC"></div>
<div aria-hidden="true" style="position: absolute; left: calc(50% - 12px); top: 10px; width: 24px; height: 24px; border-radius: 999px; background: #FBF6F1; box-shadow: 0 2px 8px rgba(4,6,14,0.5)"></div>
</div>
<div style="display: flex; color: #DCD3CE; font-size: 13px; line-height: 20px; font-weight: 500; letter-spacing: 0.02em"><span style="flex: 1">ゆっくり</span><span>はやい</span></div>
</div>
<div style="display: flex; align-items: center; gap: 12px">
<span style="flex: 1; color: #FBF6F1; font-size: 15px; line-height: 20px; font-weight: 700; letter-spacing: 0.04em">一度に描く枚数</span>
<div style="flex: none; height: 44px; border-radius: 999px; background: linear-gradient(180deg, #262E49 0%, #212943 100%); box-shadow: inset 0 1px 0 rgba(255,255,255,0.10), 0 4px 12px rgba(4,6,14,0.28); display: flex; align-items: center">
<button type="button" aria-label="減らす" style="font-family: inherit; font-weight: inherit; letter-spacing: inherit; margin: 0; border: 0; box-sizing: border-box; -webkit-appearance: none; appearance: none; text-decoration: none; width: 44px; height: 44px; padding: 0; border-radius: 999px; background: transparent; color: #FBF6F1; display: flex; align-items: center; justify-content: center"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.0" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex: none; display: block"><path d="M5 12h14"/></svg></button>
<span aria-live="polite" style="min-width: 24px; text-align: center; color: #FBF6F1; font-size: 15px; line-height: 20px; font-weight: 700; letter-spacing: 0.04em">2</span>
<button type="button" aria-label="増やす" style="font-family: inherit; font-weight: inherit; letter-spacing: inherit; margin: 0; border: 0; box-sizing: border-box; -webkit-appearance: none; appearance: none; text-decoration: none; width: 44px; height: 44px; padding: 0; border-radius: 999px; background: transparent; color: #FBF6F1; display: flex; align-items: center; justify-content: center"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.0" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex: none; display: block"><path d="M12 5v14"/><path d="M5 12h14"/></svg></button>
</div>
</div>
</div>
```

### 6.26 切り替え（2〜4 択）

- いつ使う: 同じ場所で見え方や種類を切り替える時（1 人ずつ／一覧、たっぷり／ふつう／短め）。5 択以上は選ぶ行＋シート。
- する: 窪みの溝の中で、選んだ物だけ面＋太字。全画面で形はこれ 1 つ。しない: 選んだ物をピーチで塗る、枠だけで示す。

```html
<div role="group" aria-label="返事の長さ" style="height: 52px; box-sizing: border-box; padding: 4px; border-radius: 999px; background: #0B0F1A; box-shadow: inset 0 0 0 1px rgba(255,255,255,0.10); display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 4px">
<button type="button" aria-pressed="false" style="font-family: inherit; font-weight: inherit; letter-spacing: inherit; margin: 0; border: 0; box-sizing: border-box; -webkit-appearance: none; appearance: none; text-decoration: none; height: 44px; padding: 0; border-radius: 999px; background: transparent; color: #DCD3CE; display: flex; align-items: center; justify-content: center; font-size: 15px; line-height: 20px; font-weight: 500; letter-spacing: 0.02em">たっぷり</button>
<button type="button" aria-pressed="true" style="font-family: inherit; font-weight: inherit; letter-spacing: inherit; margin: 0; border: 0; box-sizing: border-box; -webkit-appearance: none; appearance: none; text-decoration: none; height: 44px; padding: 0; border-radius: 999px; background: linear-gradient(180deg, #262E49 0%, #212943 100%); box-shadow: inset 0 1px 0 rgba(255,255,255,0.10), 0 4px 12px rgba(4,6,14,0.28); color: #FBF6F1; display: flex; align-items: center; justify-content: center; font-size: 15px; line-height: 20px; font-weight: 700; letter-spacing: 0.04em">ふつう</button>
<button type="button" aria-pressed="false" style="font-family: inherit; font-weight: inherit; letter-spacing: inherit; margin: 0; border: 0; box-sizing: border-box; -webkit-appearance: none; appearance: none; text-decoration: none; height: 44px; padding: 0; border-radius: 999px; background: transparent; color: #DCD3CE; display: flex; align-items: center; justify-content: center; font-size: 15px; line-height: 20px; font-weight: 500; letter-spacing: 0.02em">短め</button>
</div>
```

### 6.27 下からのシート（つまみ・題・閉じる）

- いつ使う: 雰囲気・しおり・いまの場面・「もっと」・選ぶ行の中身。記憶だけは全画面。
- する: 頭は全シート共通で つまみ＋題（左）＋閉じる（右）。後ろは暗幕 1 枚。中の行は高さ 52。しない: 題だけ・つまみだけの頭、シートの上にシート。

```html
<div aria-hidden="true" style="position: absolute; left: 0; top: 0; width: 390px; height: 100%; background: rgba(6,8,16,0.6)"></div>
<div role="dialog" aria-label="雰囲気" style="position: absolute; left: 0; bottom: 0; width: 390px; box-sizing: border-box; border-radius: 28px 28px 0 0; background: #1C171F; box-shadow: inset 0 1px 0 rgba(255,255,255,0.10), 0 -12px 32px rgba(4,6,14,0.55); display: flex; flex-direction: column; padding: 8px 16px 24px">
<div aria-hidden="true" style="align-self: center; width: 36px; height: 4px; border-radius: 999px; background: rgba(255,255,255,0.24)"></div>
<div style="display: flex; align-items: center; height: 52px; padding: 0 0 0 4px">
<h2 style="margin: 0; flex: 1; font-size: 16px; line-height: 24px; font-weight: 700; letter-spacing: 0.06em">雰囲気</h2>
<button type="button" aria-label="雰囲気を閉じる" style="font-family: inherit; font-weight: inherit; letter-spacing: inherit; margin: 0; border: 0; box-sizing: border-box; -webkit-appearance: none; appearance: none; text-decoration: none; flex: none; width: 44px; height: 44px; padding: 0; border-radius: 999px; background: transparent; color: #DCD3CE; display: flex; align-items: center; justify-content: center"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.0" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex: none; display: block"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg></button>
</div>
<div style="border-radius: 20px; overflow: hidden; background: linear-gradient(180deg, #212941 0%, #1D253B 100%); box-shadow: inset 0 1px 0 rgba(255,255,255,0.07), 0 6px 16px rgba(4,6,14,0.30); display: flex; flex-direction: column">
<button type="button" aria-pressed="false" style="font-family: inherit; font-weight: inherit; letter-spacing: inherit; margin: 0; border: 0; box-sizing: border-box; -webkit-appearance: none; appearance: none; text-decoration: none; height: 52px; padding: 0 16px; background: transparent; color: #FBF6F1; display: flex; align-items: center; text-align: left; font-size: 16px; line-height: 28px; font-weight: 500; letter-spacing: 0.02em">ふだん</button>
<button type="button" aria-pressed="true" style="font-family: inherit; font-weight: inherit; letter-spacing: inherit; margin: 0; border: 0; box-sizing: border-box; -webkit-appearance: none; appearance: none; text-decoration: none; height: 52px; padding: 0 16px; background: transparent; box-shadow: inset 0 1px 0 rgba(255,255,255,0.08); color: #FBF6F1; display: flex; align-items: center; gap: 8px; text-align: left; font-size: 16px; line-height: 28px; font-weight: 500; letter-spacing: 0.02em; font-weight: 700"><span style="flex: 1">親しい</span><span style="color: #FFC9AC; display: flex"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.0" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex: none; display: block"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span></button>
<button type="button" aria-pressed="false" style="font-family: inherit; font-weight: inherit; letter-spacing: inherit; margin: 0; border: 0; box-sizing: border-box; -webkit-appearance: none; appearance: none; text-decoration: none; height: 52px; padding: 0 16px; background: transparent; box-shadow: inset 0 1px 0 rgba(255,255,255,0.08); color: #FBF6F1; display: flex; align-items: center; text-align: left; font-size: 16px; line-height: 28px; font-weight: 500; letter-spacing: 0.02em">深まる</button>
</div>
<div style="color: #DCD3CE; font-size: 13px; line-height: 20px; font-weight: 500; letter-spacing: 0.02em; padding: 12px 4px 0">次の返事から、この雰囲気で進みます。</div>
</div>
```

### 6.28 確かめのシート（ふつう）

- いつ使う: 取り消しにくい操作の前（返事を再生成する、はじめから話す）。
- する: 題＝何が起きるか、文＝ 1〜2 行、右に主の操作（塗り）・左に「やめる」（文字だけ）。主の幅は残り全部。しない: ボタンを半々にする、3 つ並べる（3 つ目は文の下に文字だけで）。

```html
<div aria-hidden="true" style="position: absolute; left: 0; top: 0; width: 390px; height: 100%; background: rgba(6,8,16,0.6)"></div>
<div role="alertdialog" aria-labelledby="kit-confirm-title" style="position: absolute; left: 0; bottom: 0; width: 390px; box-sizing: border-box; border-radius: 28px 28px 0 0; background: #1C171F; box-shadow: inset 0 1px 0 rgba(255,255,255,0.10), 0 -12px 32px rgba(4,6,14,0.55); display: flex; flex-direction: column; padding: 8px 20px 24px">
<div aria-hidden="true" style="align-self: center; width: 36px; height: 4px; border-radius: 999px; background: rgba(255,255,255,0.24)"></div>
<h2 id="kit-confirm-title" style="margin: 0; padding: 20px 0 4px; font-size: 16px; line-height: 24px; font-weight: 700; letter-spacing: 0.06em">返事を再生成します。よろしいですか？</h2>
<div style="color: #DCD3CE; font-size: 16px; line-height: 28px; font-weight: 500; letter-spacing: 0.02em">いまの返事は「別の返事」に残ります。</div>
<button type="button" style="font-family: inherit; font-weight: inherit; letter-spacing: inherit; margin: 0; border: 0; box-sizing: border-box; -webkit-appearance: none; appearance: none; text-decoration: none; align-self: flex-start; height: 44px; padding: 0; background: transparent; color: #FBF6F1; display: flex; align-items: center; gap: 2px; font-size: 15px; line-height: 20px; font-weight: 500; letter-spacing: 0.02em"><span>流れを分けて再生成</span><span style="color: #DCD3CE; display: flex"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex: none; display: block"><path d="M9 5l7 7-7 7"/></svg></span></button>
<div style="display: flex; align-items: center; gap: 8px; padding: 16px 0 0">
<button type="button" style="font-family: inherit; font-weight: inherit; letter-spacing: inherit; margin: 0; border: 0; box-sizing: border-box; -webkit-appearance: none; appearance: none; text-decoration: none; flex: none; height: 56px; padding: 0 20px 0 4px; background: transparent; color: #FBF6F1; display: flex; align-items: center; font-size: 15px; line-height: 20px; font-weight: 700; letter-spacing: 0.04em">やめる</button>
<button type="button" style="font-family: inherit; font-weight: inherit; letter-spacing: inherit; margin: 0; border: 0; box-sizing: border-box; -webkit-appearance: none; appearance: none; text-decoration: none; flex: 1 1 0; min-width: 0; height: 56px; border-radius: 999px; background: linear-gradient(180deg, #FFCDB2 0%, #FFC4A4 100%); box-shadow: inset 0 1px 0 rgba(255,255,255,0.55), 0 10px 28px rgba(255,150,100,0.30), 0 2px 6px rgba(255,150,100,0.22); color: #1A0B08; display: flex; align-items: center; justify-content: center; font-size: 16px; line-height: 24px; font-weight: 700; letter-spacing: 0.06em">このまま再生成</button>
</div>
</div>
```

### 6.29 確かめのシート（消す時）

- いつ使う: 会話・キャラ・画像の削除の前だけ。
- する: 何が消えて元に戻せるかを 1〜2 行で。主は「消す」ボタン（暗い赤）。しない: ピーチの塗りを使う、消す操作を確かめなしで実行する。

```html
<div aria-hidden="true" style="position: absolute; left: 0; top: 0; width: 390px; height: 100%; background: rgba(6,8,16,0.6)"></div>
<div role="alertdialog" aria-labelledby="kit-delete-title" style="position: absolute; left: 0; bottom: 0; width: 390px; box-sizing: border-box; border-radius: 28px 28px 0 0; background: #1C171F; box-shadow: inset 0 1px 0 rgba(255,255,255,0.10), 0 -12px 32px rgba(4,6,14,0.55); display: flex; flex-direction: column; padding: 8px 20px 24px">
<div aria-hidden="true" style="align-self: center; width: 36px; height: 4px; border-radius: 999px; background: rgba(255,255,255,0.24)"></div>
<h2 id="kit-delete-title" style="margin: 0; padding: 20px 0 4px; font-size: 16px; line-height: 24px; font-weight: 700; letter-spacing: 0.06em">この会話を削除しますか？</h2>
<div style="color: #DCD3CE; font-size: 16px; line-height: 28px; font-weight: 500; letter-spacing: 0.02em">やり取りと、<br>この会話の記憶・アルバムが消えます。<br>元に戻せません。</div>
<div style="display: flex; align-items: center; gap: 8px; padding: 20px 0 0">
<button type="button" style="font-family: inherit; font-weight: inherit; letter-spacing: inherit; margin: 0; border: 0; box-sizing: border-box; -webkit-appearance: none; appearance: none; text-decoration: none; flex: none; height: 56px; padding: 0 20px 0 4px; background: transparent; color: #FBF6F1; display: flex; align-items: center; font-size: 15px; line-height: 20px; font-weight: 700; letter-spacing: 0.04em">やめる</button>
<button type="button" style="font-family: inherit; font-weight: inherit; letter-spacing: inherit; margin: 0; border: 0; box-sizing: border-box; -webkit-appearance: none; appearance: none; text-decoration: none; flex: 1 1 0; min-width: 0; height: 56px; border-radius: 999px; background: linear-gradient(180deg, #4A2226 0%, #401C21 100%); box-shadow: inset 0 1px 0 rgba(255,200,190,0.12), 0 4px 12px rgba(4,6,14,0.28); color: #FBF6F1; display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 16px; line-height: 24px; font-weight: 700; letter-spacing: 0.06em"><span style="color: #DBA199; display: flex"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex: none; display: block"><path d="M5 7h14"/><path d="M9 7V5h6v2"/><path d="M7 7l1 12a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1l1-12"/></svg></span><span>削除する</span></button>
</div>
</div>
```

### 6.30 知らせ（元に戻す つき）

- いつ使う: 保存した・とっておいた・しおりを付けた など、済んだ事の知らせ。下のタブ（か入力）のすぐ上に数秒。
- する: 濃い札 1 行＋「元に戻す」（ピーチの文字）。保存の知らせは全画面これに揃える。しない: 画面の上や中央に出す、2 つ重ねる、エラーに使う（エラーはその場に出す）。

```html
<div role="status" style="position: absolute; left: 16px; right: 16px; bottom: 16px; height: 52px; box-sizing: border-box; padding: 0 4px 0 20px; border-radius: 999px; background: #0F1528; box-shadow: inset 0 0 0 1px rgba(255,255,255,0.14), 0 6px 16px rgba(4,6,14,0.40); display: flex; align-items: center; gap: 8px">
<span style="flex: 1; min-width: 0; color: #FBF6F1; font-size: 15px; line-height: 20px; font-weight: 500; letter-spacing: 0.02em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis">ひなたをとっておきました</span>
<button type="button" style="font-family: inherit; font-weight: inherit; letter-spacing: inherit; margin: 0; border: 0; box-sizing: border-box; -webkit-appearance: none; appearance: none; text-decoration: none; flex: none; height: 44px; padding: 0 16px; border-radius: 999px; background: transparent; color: #FFC9AC; display: flex; align-items: center; font-size: 15px; line-height: 20px; font-weight: 700; letter-spacing: 0.04em">元に戻す</button>
</div>
```

### 6.31 空の時

- いつ使う: まだ何も無い一覧（とっておいた子・しおり・アルバム）。次の一手を必ず 1 つ出す。
- する: 灯の図像＋ 1 行の題＋ 1 行の文＋ボタン 1 つ（面。その画面に塗りが無ければ塗りでもよい）。しない: 起きない空の状態を描く（公式の子が居るので「1 人もいない」は無い）。

```html
<div style="display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 24px 0; text-align: center">
<span aria-hidden="true" style="width: 56px; height: 56px; border-radius: 999px; background: linear-gradient(180deg, #212941 0%, #1D253B 100%); box-shadow: inset 0 1px 0 rgba(255,255,255,0.07), 0 6px 16px rgba(4,6,14,0.30); color: #FFC9AC; display: flex; align-items: center; justify-content: center"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex: none; display: block"><path d="M9 17h6"/><path d="M10 20h4"/><path d="M8.5 14a6 6 0 1 1 7 0c-.6.5-1 1.2-1 2v1h-5v-1c0-.8-.4-1.5-1-2z"/></svg></span>
<div style="color: #FBF6F1; font-size: 16px; line-height: 24px; font-weight: 700; letter-spacing: 0.06em; padding: 8px 0 0">まだ、とっておいた子はいません</div>
<div style="color: #DCD3CE; font-size: 16px; line-height: 28px; font-weight: 500; letter-spacing: 0.02em">出会うで気になった子を、とっておけます。</div>
<a href="#" style="font-family: inherit; font-weight: inherit; letter-spacing: inherit; margin: 0; border: 0; box-sizing: border-box; -webkit-appearance: none; appearance: none; text-decoration: none; height: 44px; padding: 0 20px; border-radius: 999px; background: linear-gradient(180deg, #262E49 0%, #212943 100%); box-shadow: inset 0 1px 0 rgba(255,255,255,0.10), 0 4px 12px rgba(4,6,14,0.28); color: #FBF6F1; display: flex; align-items: center; gap: 6px; font-size: 15px; line-height: 20px; font-weight: 700; letter-spacing: 0.04em"><span>出会うへ</span><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.0" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex: none; display: block"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg></a>
</div>
```

### 6.32 読み込み中（骨組み）

- いつ使う: 一覧や画像が出るまでの間。出てくる物と同じ形・同じ場所に置く。
- する: 面の色の角丸（文字の代わりは高さ 12・角丸 8）。role=status と aria-label を付ける。しない: 画面まるごとのぐるぐる、文字を読ませる骨組み。

```html
<div role="status" aria-label="読み込んでいます" style="display: flex; flex-direction: column">
<div style="height: 64px; box-shadow: inset 0 1px 0 rgba(255,255,255,0.08); display: flex; align-items: center; gap: 12px">
<span aria-hidden="true" style="flex: none; width: 44px; height: 44px; border-radius: 999px; background: #2B3452"></span>
<span aria-hidden="true" style="flex: 1; display: flex; flex-direction: column; gap: 10px"><span style="width: 96px; height: 12px; border-radius: 8px; background: #2B3452"></span><span style="width: 200px; height: 12px; border-radius: 8px; background: #232C47"></span></span>
</div>
<div style="height: 64px; box-shadow: inset 0 1px 0 rgba(255,255,255,0.08); display: flex; align-items: center; gap: 12px">
<span aria-hidden="true" style="flex: none; width: 44px; height: 44px; border-radius: 999px; background: #2B3452"></span>
<span aria-hidden="true" style="flex: 1; display: flex; flex-direction: column; gap: 10px"><span style="width: 72px; height: 12px; border-radius: 8px; background: #2B3452"></span><span style="width: 168px; height: 12px; border-radius: 8px; background: #232C47"></span></span>
</div>
</div>
```

### 6.33 うまくいかなかった時

- いつ使う: その場所（返事の下・画像の枠・一覧の中）に出す。知らせの文は「〜できませんでした」＋「もう一度」に揃える。
- する: 赤い図像＋主の色の 1 文＋「もう一度」（面）。行き止まりにしない（戻る先か、もう一度が必ずある）。しない: 赤い面で塗る、技術の言葉や番号を出す、同時に 2 つ出す。

```html
<div role="alert" style="display: flex; flex-direction: column; gap: 12px; padding: 16px; border-radius: 20px; background: linear-gradient(180deg, #212941 0%, #1D253B 100%); box-shadow: inset 0 1px 0 rgba(255,255,255,0.07), 0 6px 16px rgba(4,6,14,0.30)">
<div style="display: flex; align-items: center; gap: 8px">
<span style="flex: none; color: #DBA199; display: flex"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex: none; display: block"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v5.5"/><path d="M12 16v.5"/></svg></span>
<span style="flex: 1; min-width: 0; color: #FBF6F1; font-size: 16px; line-height: 28px; font-weight: 500; letter-spacing: 0.02em">返事をつくれませんでした。</span>
</div>
<button type="button" style="font-family: inherit; font-weight: inherit; letter-spacing: inherit; margin: 0; border: 0; box-sizing: border-box; -webkit-appearance: none; appearance: none; text-decoration: none; align-self: flex-start; height: 44px; padding: 0 16px 0 12px; border-radius: 999px; background: linear-gradient(180deg, #262E49 0%, #212943 100%); box-shadow: inset 0 1px 0 rgba(255,255,255,0.10), 0 4px 12px rgba(4,6,14,0.28); color: #FBF6F1; display: flex; align-items: center; gap: 6px; font-size: 15px; line-height: 20px; font-weight: 700; letter-spacing: 0.04em"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex: none; display: block"><path d="M20 11a8 8 0 1 0-2.3 6.3"/><path d="M20 5v6h-6"/></svg><span>もう一度</span></button>
</div>
```

### 6.34 下のタブ（5 つ）

- いつ使う: ホーム／出会う／つくる／アルバム／マイ。トーク・読む画面・全画面の画像では出さない。
- する: 選んだタブはピーチ＋暮れ色の丸薬＋太字、aria-current を付ける。高さ 64 で画面の下に固定。しない: タブを増減する、選んだタブをピーチで塗る、数字のしるしを付ける。

```html
<nav aria-label="メイン" style="position: absolute; left: 0; bottom: 0; width: 390px; height: 64px; box-sizing: border-box; background: #1C171F; box-shadow: inset 0 1px 0 rgba(255,255,255,0.08); display: flex; padding: 0 8px">
<a href="#" aria-current="page" style="flex: 1; min-width: 0; height: 64px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; text-decoration: none; color: #FFC9AC; font-size: 12px; line-height: 16px; font-weight: 500; letter-spacing: 0.04em; font-weight: 700"><span style="width: 48px; height: 28px; border-radius: 999px; background: #3A292D; display: flex; align-items: center; justify-content: center"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex: none; display: block"><path d="M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1v-8z"/></svg></span><span>ホーム</span></a>
<a href="#" style="flex: 1; min-width: 0; height: 64px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; text-decoration: none; color: #DCD3CE; font-size: 12px; line-height: 16px; font-weight: 500; letter-spacing: 0.04em"><span style="width: 48px; height: 28px; border-radius: 999px; display: flex; align-items: center; justify-content: center"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex: none; display: block"><circle cx="12" cy="12" r="8.5"/><path d="M15.5 8.5l-2 5-5 2 2-5 5-2z"/></svg></span><span>出会う</span></a>
<a href="#" style="flex: 1; min-width: 0; height: 64px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; text-decoration: none; color: #DCD3CE; font-size: 12px; line-height: 16px; font-weight: 500; letter-spacing: 0.04em"><span style="width: 48px; height: 28px; border-radius: 999px; display: flex; align-items: center; justify-content: center"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex: none; display: block"><path d="M4 20l1-4L16 5l3 3L8 19l-4 1z"/><path d="M14 7l3 3"/></svg></span><span>つくる</span></a>
<a href="#" style="flex: 1; min-width: 0; height: 64px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; text-decoration: none; color: #DCD3CE; font-size: 12px; line-height: 16px; font-weight: 500; letter-spacing: 0.04em"><span style="width: 48px; height: 28px; border-radius: 999px; display: flex; align-items: center; justify-content: center"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex: none; display: block"><rect x="3.5" y="7" width="14" height="12" rx="2.5"/><path d="M7 7V5.5A1.5 1.5 0 0 1 8.5 4H19a1.5 1.5 0 0 1 1.5 1.5V14a1.5 1.5 0 0 1-1.5 1.5h-1.5"/><path d="M4.5 16.5l3.5-3.5 3 3 2-2 4 4"/></svg></span><span>アルバム</span></a>
<a href="#" style="flex: 1; min-width: 0; height: 64px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; text-decoration: none; color: #DCD3CE; font-size: 12px; line-height: 16px; font-weight: 500; letter-spacing: 0.04em"><span style="width: 48px; height: 28px; border-radius: 999px; display: flex; align-items: center; justify-content: center"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex: none; display: block"><circle cx="12" cy="8.5" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/></svg></span><span>マイ</span></a>
</nav>
```

### 6.35 状態の区切り（板に状態を積む時）

- いつ使う: 1 枚の板に状態違いを縦に積む時、状態ごとの頭に置く。画面の外の帯なので、アプリの部品ではない。
- する: 幅いっぱい・高さ 40・ほぼ黒の帯に 13px 太字で状態の名前だけ。しない: 説明や設計の覚え書きを書く、画面の中（地の上）に置く。

```html
<div style="width: 390px; height: 40px; box-sizing: border-box; padding: 0 20px; background: #05070D; color: #DCD3CE; display: flex; align-items: center; font-family: 'Zen Kaku Gothic New', sans-serif; font-size: 13px; line-height: 20px; font-weight: 700; letter-spacing: 0.04em">返事の「もっと」を開いた時</div>
```

## 7. 図像（線の SVG。色は親の color、線の太さは 1.75、矢印と「＋」「×」は 2）

使い方: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex: none; display: block">（下の中身）</svg>`

| 名前 | 中身 |
|---|---|
| back | `<path d="M15 5l-7 7 7 7"/>` |
| chevR | `<path d="M9 5l7 7-7 7"/>` |
| chevD | `<path d="M5 9l7 7 7-7"/>` |
| x | `<path d="M6 6l12 12"/><path d="M18 6L6 18"/>` |
| plus | `<path d="M12 5v14"/><path d="M5 12h14"/>` |
| minus | `<path d="M5 12h14"/>` |
| check | `<path d="M5 12.5l4.5 4.5L19 7.5"/>` |
| arrowR | `<path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>` |
| send | `<path d="M12 19V5"/><path d="M5.5 11.5L12 5l6.5 6.5"/>` |
| stop | `<rect x="7" y="7" width="10" height="10" rx="2"/>` |
| dots | `<circle cx="6" cy="12" r="1.1"/><circle cx="12" cy="12" r="1.1"/><circle cx="18" cy="12" r="1.1"/>` |
| refresh | `<path d="M20 11a8 8 0 1 0-2.3 6.3"/><path d="M20 5v6h-6"/>` |
| phone | `<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>` |
| menu | `<path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h16"/>` |
| pin | `<path d="M12 21s-6.5-5.6-6.5-10.5a6.5 6.5 0 0 1 13 0C18.5 15.4 12 21 12 21z"/><circle cx="12" cy="10.5" r="2.2"/>` |
| tack | `<path d="M9 4h6l-1 6 3 3H7l3-3-1-6z"/><path d="M12 13v7"/>` |
| image | `<rect x="3.5" y="5" width="17" height="14" rx="3"/><circle cx="9" cy="10" r="1.6"/><path d="M4.5 17l4.5-4.5 3.5 3.5 2.5-2.5 4.5 4.5"/>` |
| speaker | `<path d="M4 10v4h3l5 4V6L7 10H4z"/><path d="M16 9a4 4 0 0 1 0 6"/><path d="M18.5 6.5a7.5 7.5 0 0 1 0 11"/>` |
| bookmark | `<path d="M7 4h10a1 1 0 0 1 1 1v15l-6-4-6 4V5a1 1 0 0 1 1-1z"/>` |
| heart | `<path d="M12 20s-7-4.4-7-9.6A3.9 3.9 0 0 1 12 8a3.9 3.9 0 0 1 7 2.4C19 15.6 12 20 12 20z"/>` |
| face | `<circle cx="12" cy="12" r="8.5"/><path d="M9 10v.5"/><path d="M15 10v.5"/><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0"/>` |
| clock | `<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>` |
| search | `<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>` |
| alert | `<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v5.5"/><path d="M12 16v.5"/>` |
| trash | `<path d="M5 7h14"/><path d="M9 7V5h6v2"/><path d="M7 7l1 12a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1l1-12"/>` |
| gear | `<circle cx="12" cy="12" r="3"/><path d="M12 3v3"/><path d="M12 18v3"/><path d="M3 12h3"/><path d="M18 12h3"/><path d="M5.6 5.6l2.1 2.1"/><path d="M16.3 16.3l2.1 2.1"/><path d="M5.6 18.4l2.1-2.1"/><path d="M16.3 7.7l2.1-2.1"/>` |
| lamp | `<path d="M9 17h6"/><path d="M10 20h4"/><path d="M8.5 14a6 6 0 1 1 7 0c-.6.5-1 1.2-1 2v1h-5v-1c0-.8-.4-1.5-1-2z"/>` |
| home | `<path d="M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1v-8z"/>` |
| compass | `<circle cx="12" cy="12" r="8.5"/><path d="M15.5 8.5l-2 5-5 2 2-5 5-2z"/>` |
| pencil | `<path d="M4 20l1-4L16 5l3 3L8 19l-4 1z"/><path d="M14 7l3 3"/>` |
| album | `<rect x="3.5" y="7" width="14" height="12" rx="2.5"/><path d="M7 7V5.5A1.5 1.5 0 0 1 8.5 4H19a1.5 1.5 0 0 1 1.5 1.5V14a1.5 1.5 0 0 1-1.5 1.5h-1.5"/><path d="M4.5 16.5l3.5-3.5 3 3 2-2 4 4"/>` |
| user | `<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>` |
| list | `<path d="M9 7h11"/><path d="M9 12h11"/><path d="M9 17h11"/><path d="M4.5 7h.5"/><path d="M4.5 12h.5"/><path d="M4.5 17h.5"/>` |
| card | `<rect x="7" y="4" width="10" height="16" rx="2.5"/><path d="M3.5 8v8"/><path d="M20.5 8v8"/>` |

## 8. 言葉（呼び名の統一）

### 8.1 決まっている語（DECISIONS.md §4・DECISIONS-D.md の局長の判断）

| 使う語 | 使わない語・元の語 | 補足 |
|---|---|---|
| {名前}／この子／キャラ | 彼女・相手・キャラクター（画面の文として） | 相手は「彼女」とは限らない。名前が分かる所は名前 |
| いつもの子／いつもの子にする | お気に入り・ピン留め | プロフィールで自分で留める |
| 出会う／話す／とっておく／飛ばす | 探す・マッチ・いいね・スキップ | 出会うはタブだけ（ホームに帯を置かない） |
| つづきから／履歴 | 保存した会話 | 全件は「履歴」 |
| ゆうべのつづき | 前回の続き | いつもの子の主ボタン |
| ここから続ける | 戻した会話を進める | |
| 返事を再生成します。よろしいですか？／このまま再生成／流れを分けて再生成 | 上書き・分岐 | 自分の発言を書き直した時の確かめ |
| 別の返事 | 枝・枝操作 | ‹ 2/3 › |
| ここから別の流れ｜元の流れへ／ここから元の流れ｜別の流れへ | 分岐・ブランチ・枝 | 分かれ目の 1 行（TalkRewrite）。左は今居る流れ（字だけ）、右は移る先（押せる）。両わきに細い線 |
| 返事の候補 | おすすめ | |
| 雰囲気（ふだん／親しい／深まる／最高潮／余韻） | 段・フェーズ | |
| 心の声 | 本音・本心 | |
| しおり | ブックマーク | |
| いまの場面 | 台帳 | |
| セリフ | 台詞 | |
| 姿勢 | 体位 | |
| グループ | パーティ・宴 | |
| アルバム | 画像履歴 | |
| 秘めた面 | 裏の顔・隠し設定 | 欄の名前 |
| あらすじ | 世界観 | ストーリーの欄の名前 |
| あなたのこと | あなたの設定・ユーザー人物像 | |
| あなたの立場 | 役割・ロール | 始まり方を選ぶ画面 |
| AI がおぼえた好み | 学習内容・パーソナライズ | マイの中 |
| 書き換える | 消す・編集（記憶に対して） | 記憶は書き換えるのが主。削除は奥 |
| 返事の長さ（たっぷり／ふつう／短め） | チャットモード | |
| 文体（そのまま／地の文重め／会話重め） | 文体スタイル | |
| 声／声の種類 | ボイス設定・話者 ID | |
| {名前}から話しかける | キャラから話しかける | |
| 自分用にコピー | フォーク・複製 | |
| 編集 | 行の「設定」リンク | |
| 指示への忠実さ／再現番号／画像の形（縦長・正方形・横長）／元の画像からの変化／入れたくないもの | CFG／seed／幅・高さ／i2i 強度／ネガティブプロンプト | 技術の値は「くわしい設定」に畳む |

### 8.2 この KIT で揃えた語（検品 AUDIT.md「呼び名の揺れ」への当て。局長は未確認）

| 使う語 | 揺れていた語 |
|---|---|
| クリップ | 動画 |
| 再生成（返事。確かめの文も）／描き直す（画像）／つくり直す（キャラ・クリップ） | つくり直す・作り直す の混在 |
| 話す（始める時）／はじめから話す（最初に戻す時） | はじめる |
| 表情変更 | 表情を変える |
| 自由に書く | 自由に入力 |
| 〜できませんでした。＋「もう一度」 | 保存に失敗・保存できません・エラーが発生 |
| 描いています／読み込んでいます | 現像中・生成中 |
| やめる（確かめを閉じる）／閉じる（シートの ×） | キャンセル・戻る の混在 |
| この端末・ブラウザ・版・番号などの技術の語 | 画面に出さない（言い換えるか消す） |

### 8.3 言い回し

- 説明・確かめ・エラーは です・ます調。ボタンとラベルは短く言い切る。崩した言葉（「今夜ひま？」「なに話す？」）は見出しや薄い字に使ってよい。
- 関係を決めつける語（恋人・彼氏・彼女）、ハート、好感度、回数や上限、料金は出さない。
- アプリの側から「合意」「配慮」「安全」などの枠の文言を足さない。
- 同じ場面（オフライン・保存できなかった・つくれなかった・長引く・消している間・消せなかった・保存せずに閉じる・削除した子・許可が無い・読み込み）の文と形は、`WORDING.md` の 1 つだけを使う。

## 9. よくある間違い（しないこと）

- 枠線のボタンを並べる／同じ形の面を 6 個以上並べる／1 画面に塗りのボタンが 2 つ。
- 絵の上に直に文字、絵に暗い膜をかける、絵の上に札を 3 つ以上置く。
- 文字の大きさを足す（14・17・18・20）、丸ゴシックを名前以外に使う、薄い灰色の小さい字。
- 削除を赤いボタンで画面に常駐させる（削除は「…」やメニューの奥 → 確かめのシート）。
- 同じ設定・操作を 2 か所に置く。行ごとにボタンを付ける（行は 1 つのリンク＋必要なら「…」1 つ）。
- 絞り込みを 2 段 3 段に積む（1 行に横並び、残りはシート）。
- 知らせ（6.30）の形の帯を、下のタブのすぐ上以外に浮かべる。閉じるまで出しておく案内は、流れの中に置く帯にする（主ボタンの下・見出しの上。右端に閉じる「×」。Notifications「ホーム画面に追加の案内」）。
- 色の名前で場所を指す（「赤い所を直してください」）。色だけで赤と桃色を分ける部品を足す（P・D 型の色覚では 2 色の差が半分以下になる。必ず図像か字を添える）。
- 行き止まり（戻る・次の一手が無い画面）。

## 10. 実装へ渡す決まり（幅・高さ・板の外・字の差・明るさ）

前提: 板は、どれも幅 390・高さ 844 の 1 画面として描いてある（枠は `width: 390px` の決め打ち。高さ 844 を使い切っている）。実機の幅と高さは違うので、板の数をそのまま写さず、下の決まりで合わせる。合わせた見本は板 `Sizes`（「画面の大きさのちがい」。Main と Talk を 幅 360×高さ 740 と 幅 430×高さ 932 で並べた物。作り方は `tools/sizes.py`）。数の根拠は `DEVICE-CHECK.md`。

### 10.1 幅（360〜430）

- 左右の余白は 20px のまま（幅で変えない）。下の帯・頭の中の 16px・12px も変えない。
- 絵は幅いっぱいに伸ばす（縦横比は保つ。ホームの絵 390×420 は、幅 360 で 360×388、幅 430 で 430×463。トークの上の絵 390×264 も同じ比で伸ばす）。
- 幅を決め打ちした面・絵（350px など）は「幅 − 40px」にする（会話の中の画像・札・入力欄。高さは同じ比で伸ばす）。169px の 2 列は「（幅 − 40 − 12）÷ 2」。
- 札の列（返事の候補・出会うの札・アルバムの子の札）は折り返さず、横に送る。右端で切れて見えてよい。
- 1 行の字は、幅 360 で 2 行になってよい。切らない（「…」にしない）。名前・題など、板で「…」にしている字だけは 1 行のまま切る。
- そのまま幅 390 で出すと、幅 360 で右 30px が切れ、幅 430 で右に 40px 余る（DEVICE-CHECK 中 1）。

### 10.2 高さ

- 中身は送られる（縦に動く）。絵の高さは幅で決まり、画面の高さでは縮めない。
- 下のタブ・入力欄（返事の候補つき）・下の帯の主ボタンは、画面の下に固定する。
- トークの送信は、入力欄の右の送信ボタンでも、キーボードの「送信」でも送れる（改行はキーボードの改行で入れる）。持つ手が左の設定の時は、下の並びを左右入れ替える（送信・止めるが左、「＋」が右。返事の候補の送りは同じ。見本は板 `TalkLeft`）。グループの会話（GroupTalk）でも同じに入れ替える。
- 上下の安全域（時計や電池の帯・切り欠き、下のホームの線）のぶん、余白を足す。上に置いた札（ホームの「いつもの子」、トークの戻る・電話・メニュー）は「元の位置＋上の安全域」。下のタブと入力欄の帯は「元の高さ＋下の安全域」（中身は上に寄せ、足したぶんは帯の地の色）。
- トークは、いちばん新しい返事が見える所まで送った状態で開く（高さが足りない時、古い発言から絵の下へ送られる）。
- 板 `Sizes` の安全域は仮の数（幅 360×高さ 740 は上 24・下 16、幅 430×高さ 932 は上 59・下 34）。実装では端末の値を使う。
- 高さ 664 で、タブと入力欄を下に固定した時: ホームは、主ボタン「ゆうべのつづき」の下半分から先（「つづきから」の一覧）がタブの後ろへ送られる。トークは、返事の候補と入力欄は見えたままで、会話の古い側が絵の下へ送られる。どちらも送れば出るので、行き止まりにはならない。固定せずに板のまま開いた時の切れ方（タブや入力欄が画面の外）は DEVICE-CHECK 中 2。
- 中身が増えた時も同じ（例: Notifications「ホーム画面に追加の案内」は、案内のぶん「つづきから」の一覧がタブの後ろへ送られる。絵は 420 のまま）。

### 10.3 板の外の地の色

- 後ろに敷く色（`html`・`body` と、ブラウザの上の帯の色）は、上を `#0E1425`、下を `#231B20` にする（板の地の縦の移り変わりの両端）。白を出さない。引っ張って戻す時・読み込みの一瞬・幅 430 より広い時の左右の余りに見えるのは、この色（DEVICE-CHECK 中 5）。
- 安全域の色は、後ろに敷く色ではなく、そこに届いている物の色にする。下の安全域は、下に固定した帯（タブ・入力欄の帯）を伸ばして `#1C171F` で埋める（10.2。板 `Sizes` の 4 画面とも）。上の安全域は、絵のある画面（ホーム・トーク）では絵がそのまま入り、絵の無い画面では地の色 `#0E1425`。

### 10.4 字と後ろの面の差

- 主の色の字（`#FBF6F1`）は 12 以上。副の字（`#DCD3CE`・桃色）は 7 以上。失敗の字は下の行。確かめのシートの補足（「元に戻せません。」「保存していない変更が消えます。」）・地の文・押せない間のボタンの字・赤い「…を削除」は副。
- 失敗の字（`#DBA199`）は 6 以上（面の上 6.6・押せる面の上 6.1・地の上 8.2）。局長の実機コメント「超ちょっとだけ気持ち眩しい」を受けて、鮮やかさと明るさを下げた（はじめ `#FFA69A` 7.7 → 12 回目 `#EDAFA7` 7.7 → いま 6.6）。失敗の欄の枠は 1px のまま、ふつうの欄の枠と同じ見えやすさ（差 4.7〜5.0。`rgba(219,161,153,0.72)`）にする（13 回目に半分の濃さにしたら、ふつうの欄より見えにくくなったので戻した）。場所は「!」の印と文で伝える。
- 実測（全 54 板・見えている字 5,768 個）: 失敗の色を沈める前の数で、最小 7.66（赤）、7 未満 0 個。いまの失敗の字は面の上 6.6。主の色の字 3,317 個は最小 12.21（丸い顔の頭文字 1 個が 10.16。字の真下は 12.65）。副 2,004 個は最小 9.13、桃色 9.74、赤 7.66、タブの 12px は 11.92。
- 16px 以上でも、副の色の字は 12 に届かない物がある（235 個・9.21〜11.96 と、沈める前の赤 7.66〜7.88。いまの赤は実測 6.33〜8.72）。決まりは「主は 12・副は 7」で、これに合っている（DEVICE-CHECK 中 4）。
- 絵の上に直に字を置かない（実測 0 個）。

### 10.5 明るさ

- 絵は薄めない（暗い膜・`opacity`・フィルタをかけない。局長の決定）。画面の光の大半は絵になる（ホームの平均輝度 0.198 のうち絵が 71%。DEVICE-CHECK 中 3）。
- UI の面は、絵を除いて、明るい画素（輝度 0.6 超）を 1 割未満にする。実測の最大は 9.05%（Documents「資料がたくさんある時」）。明るい面は主ボタン 1 つと、選んだ切り替えのつまみだけ。
- 暗くした画面（明るさ 10%）では、面の縁・細い線・骨組みはほぼ見えなくなる。場所や状態を、縁や線だけで伝えない（字か図像を必ず添える。DEVICE-CHECK 軽 1・軽 2）。

## 11. 動き（局長の実機コメント 2026-11-13。見本は板 `Motion` と Meet の状態）

前提: 板は止まった絵。動きは、ここの数で実装する。動きを減らす設定（prefers-reduced-motion）の人には、横へ動かさず、薄くして替える（150ms）。

### 11.1 出会うの送り（左右に送る）

- 右へ送る＝とっておく、左へ送る＝飛ばす。下の小さいボタン（飛ばす・とっておく）を押しても同じ動き。「話す」は塗りのボタンのまま。
- 引いている間: 札（絵と、名前から下のボタンまで）が指について横に動く。かたむきは「引いた割合 × 16 度」で、最大 8 度（幅の 50% で 8 度。回る中心は札の下の端のまん中）。上の「出会う」の札・見え方の切り替え・下のタブは動かない。
- 印: 右へ引くと画面の右上に「とっておく」、左へ引くと左上に「飛ばす」。引くほど濃くなる（0% で透明、35% で不透明）。
- 後ろの札: 次の子の札が 96% の大きさ・6 割の明るさで見える。見せるのは、絵・名前・肩書き・ひとこと（と札）まで。下のボタンの段は出さない（前に来てから出す。塗りのボタンは 1 画面に 1 つ）。
- 離した時: 幅の 35% を超えているか、速く払った時（毎秒 600px 以上）は、そのまま外へ出る（250ms・減速）。超えていなければ元の位置へ戻る（180ms）。
- 次の札: 外へ出るのと同時に、200ms で 96% → 100% になる。
- 送ったあと: 知らせ「とっておきました」（押すと、とっておいた子の一覧へ）／「飛ばしました｜元に戻す」。
- 初めての時だけ: 絵の下の端に 1 行「左右に送れます」（1 回送ったら出さない）。
- 動きを減らす設定の時: 札を横へ動かさない。いまの札を薄くして消し、次の札を 100% の大きさのまま濃くする。

### 11.2 いまの板にある、ほかの動き

- シート（下から出る面）: 出る時は下から 240ms・減速、閉じる時は 200ms。後ろの暗幕は同じ時間で濃く・薄くなる。
- 知らせ（6.30）: 下のタブのすぐ上に、下から 8px 上がりながら 160ms で出る。数秒で 160ms かけて消える。
- 待ちの点（返事を書いています）: 3 つの点が順に明るくなる（1 周 1.2 秒）。動きを減らす設定の時は点を止めて、字だけにする。
- 骨組み（読み込み中）: 面の明るさがゆっくり行き来する（1 周 1.6 秒）。動きを減らす設定の時は止める。
- 声で聞くボタン: 再生中は印が「止める」（14px の四角）に替わる（動かさない）。止める所はこの印 1 つだけ。
- 進み具合の線（つくっています・描いています）: 左から右へ伸びる。進みが分からない時は、線の中を明るい所が行き来する（1 周 1.4 秒）。
