# Chat画面 実装 vs デザイン仕様（A案「燈」）コンプライアンス監査

対象実装: `src/component/ouse/`（`ou-app.tsx` の `OuStage variant="flat"` 経路が実際に描画するトーク画面）。トークンは `src/component/ouse/ouse-tokens.ts` の `OU2` オブジェクト、フォントは `src/index.css`。

**前提**: `src/component/chat/`（message-bubble.tsx 等）は本トーク画面では使われていない（別画面専用）。実際にA案を実装しているのは `src/component/ouse/` 配下一式。`ouse-tokens.ts` は「Claude Design 案A「燈」への完全踏襲（2026-07-14）」というコメント付きの専用セクションを持つ、意図的な移植実装。

## コンプライアンス表

| 要素 | デザイン仕様(A案) | 実装の値 | 判定 | 証拠(ファイル:行) |
|---|---|---|---|---|
| カード背景グラデーション | `radial-gradient(125% 78% at 50% -8%, #2c2522 0%, #1b1512 52%, #140f0d 100%)` | 同一（`OU2.ink/nightMid/night`） | ✅一致 | `ou-stage.tsx:26`, `ouse-tokens.ts:2-3,25` |
| カードのbox-shadow | `0 30px 70px -28px rgba(40,28,16,.55), 0 6px 20px rgba(0,0,0,.18)` | 未実装 | ❌未実装 | `ouse.css:2-17`, `ou-stage.tsx:18-31` |
| lamp glowアニメ装飾 | `radial-gradient(...rgba(214,160,84,.30)...)`, `lampGlow 7s`点滅 | 未実装（キーフレームは存在するがcreate-flow専用、チャット未接続） | ❌未実装 | `src/index.css:409-412`（適用先は`ou-create-flow.tsx:385`のみ） |
| 外側ページフォント | `'Zen Kaku Gothic New', sans-serif` | base fontは`--font-sans: "Geist Variable"`。Zen Kaku Gothic Newは`.font-sans-ui`ユーティリティのみ | ⚠️不一致 | `src/index.css:17-18,259-261,270` |
| ヘッダーcontainer padding | `14px 22px 16px` | `px-4 pb-3 pt-4` = `16px 16px 12px` | ⚠️不一致 | `talk-header.tsx:118` |
| ステータス行（`16px 28px 0`/`#c9bba6`） | 仕様に明記 | 完全未実装（該当色0件） | ❌未実装 | grep結果0件 |
| 戻る矢印 | `22px`, `#b79766` | 同一 | ✅一致 | `talk-header.tsx:123-124`, `ouse-tokens.ts:48` |
| ヘッダーアバター | `36×36px`, 円形, `border:1px solid rgba(201,180,140,.4)` | 同一 | ✅一致 | `talk-header.tsx:48-51`, `ouse-tokens.ts:46` |
| ヘッダータイトル | Noto Serif JP, `16.5px`, `600`, `#f1e7d6` | 同一 | ✅一致 | `talk-header.tsx:85-91`, `ouse-tokens.ts:50` |
| ヘッダーサブタイトル | `11px`, `.1em`, `#9a8a6f`, margin-top `3px` | 同一（ただし内容は`恋人・128回プレイ`固定literalでTODO配線待ち） | ✅一致 | `talk-header.tsx:93-98` |
| ヘッダー丸ボタン(⋯) | `34×34px`, border一致, 色`#c9b48c` | サイズ/枠線一致、色は`#9a8a6f`で別色 | ⚠️不一致 | `talk-header.tsx:22-31` |
| ヘッダー下divider | `1px`, margin`0 22px`, グラデ一致 | 色は一致だが margin `mx-4`=16px | ⚠️軽微不一致 | `talk-header.tsx:134-139`, `ouse-tokens.ts:47` |
| アシスタント名ラベル | Noto Serif JP, `13px`, `#cda86a`, `.06em` | 完全一致 | ✅一致 | `her-message.tsx:249-259`, `ouse-tokens.ts:52` |
| アシスタント台詞 | `18px`, `1.85`, `#f3ead9`, バブル背景なし | 完全一致 | ✅一致 | `her-message.tsx:76-82` |
| ナレーション段落 | `#b3a791`, `2.05`, `15px` | 完全一致 | ✅一致 | `her-message.tsx:93-99`, `ouse-tokens.ts:67` |
| 心の声(inner) | border-left一致, `#8c8270`, italic, `1.95`, `14.5px` | 完全一致 | ✅一致 | `her-message.tsx:83-92`, `ouse-tokens.ts:65-66` |
| 記憶チップ | padding/radius/border/色/サイズ全一致 | 完全一致 | ✅一致 | `her-message.tsx:265-284`, `ouse-tokens.ts:68-69` |
| ユーザー吹き出し | グラデ/border/radius/色/サイズ/max-width/padding全一致 | 完全一致 | ✅一致 | `you-message.tsx:163-176`, `ouse-tokens.ts:54-56` |
| ユーザー「あなた」ラベル | 右寄せ, `11px`, `.14em`, `#8a7f6c` | フォント値一致、右寄せはflex実現 | ✅実質一致 | `you-message.tsx:153-162` |
| メッセージ内アバター | `38×38px`, border一致 | 完全一致 | ✅一致 | `her-message.tsx:218-221`, `ouse-tokens.ts:64` |
| 再生成/ページャ行 色 | `#8a7f6c`(`OU2.label`) | `OU2.faint`(`rgba(243,234,217,.5)`)使用 | ⚠️不一致 | `her-message.tsx:404-409,437-455` |
| 再生成/ページャ行 gap | `16px` | `15px` | ⚠️軽微(1px差) | `her-message.tsx:406` |
| 画像メッセージ枠 | radius/border/shadow一致 | 完全一致 | ✅一致 | `her-message.tsx:656-661`, `ouse-tokens.ts:70` |
| 画像メッセージ高さ | `height:240px`固定, cover | `min-h-[240px]`+`max-h-[52dvh]`(可変) | ⚠️仕様と方式が異なる | `her-message.tsx:666` |
| 画像キャプション | italic, `#8c8270`, `13.5px` | 未実装（要素自体が存在しない） | ❌未実装 | `her-message.tsx:654-679`全体 |
| 入力バー外枠 | `#160f0d`, border-top一致, padding`10px 16px 22px` | 背景色一致。border-topは`var(--hairline)`=`rgba(243,234,217,.14)`で別色。paddingも別値 | ⚠️不一致(2点) | `input-bar.tsx:81-84`, `src/index.css:180` |
| クイックチップ(非選択) | 全一致 | 完全一致 | ✅一致 | `chips-panel.tsx:39-45` |
| クイックチップ(選択・ふつう) | 全一致 | 完全一致 | ✅一致 | `chips-panel.tsx:29-38` |
| クイックチップ(選択・たっぷり=強調段階) | `border.55/bg.2/#f0c879/700`（ふつうより強い専用スタイル） | 未実装（「たっぷり」でも「ふつう」と同じスタイルで区別なし） | ❌未実装 | `chips-panel.tsx:29-45,62-67` |
| 入力ピル | radius/bg/border/padding/gap全一致 | 完全一致 | ✅一致 | `input-bar.tsx:85-91`, `ouse-tokens.ts:61-62` |
| placeholder | `#8e8470`, `14px` | 色は`var(--ghost)`=`rgba(243,234,217,.32)`で別色。サイズは意図的に16px(iOS自動ズーム防止) | ⚠️不一致(色・サイズ) | `input-bar.tsx:93,102`, `src/index.css:179` |
| 画像ボタン | 全一致 | 完全一致 | ✅一致 | `input-bar.tsx:104-125`, `ouse-tokens.ts:57-58` |
| 送信ボタン | サイズ/形/グラデ/アイコン一致 | 色`#241a0e`は既存トークン`OU2.onLamp`(`#2a1c0c`)と別値のハードコード | ⚠️トークン化漏れ+微差 | `input-bar.tsx:132-149`, `ouse-tokens.ts:11` |
| Google Fontsインポート方式 | CDN `<link>` | `@fontsource`自前ホスティング(実質等価) | ⚠️方式相違(健全) | `src/index.css:1-12` |

## トークン化されていないハードコード色

| 箇所 | 値 | 問題 |
|---|---|---|
| `her-message.tsx:73` | `rgba(243,234,217,0.86)` | `OU2`のどのトークンとも一致しない独自値 |
| `her-message.tsx:56-57` (`READ_SHADOW`系) | `rgba(5,3,2,.92)`等 | 仕様にtext-shadow規定なし。A案完全踏襲コメントがある一方でこの装飾は仕様書に存在しない独自追加 |
| `her-message.tsx:690-691` | `oklch(0.72 0.16 14 / 0.4)` / `/ 0.08` | `OU2.rose`と同色相だが再利用せず別途ハードコード（重複管理） |
| `you-message.tsx:92` | `rgba(214,169,87,.1)` | 未送達バブル背景。完全一致トークンなし |
| `input-bar.tsx:144` | `#241a0e` | `OU2.onLamp="#2a1c0c"`と同じ意味の別値。ドリフトの疑い |

## 深刻度ランキング

1. **【重大】lamp glowアニメ装飾＋カードbox-shadowの完全欠落** — A案の世界観訴求の核。
2. **【重大】ヘッダー「ステータス行」(`#c9bba6`)が完全未実装**
3. **【中】クイックチップ「たっぷり」専用の強調スタイル未実装** — 4段階中最強が視覚的に区別できない
4. **【中】外側ページのbaseフォントがGeist Variable**（日本語がZen Kaku Gothic Newにならない）
5. **【中】画像メッセージのキャプション未実装**
6. **【軽微〜中】色の取り違え3件**（ヘッダー⋯ボタン／再生成行／入力バーborder-top）
7. **【軽微】placeholder色・各種padding/marginの数px〜色ズレ**
8. **【軽微】送信ボタン文字色のトークン重複ドリフト**

## 修正方向

- lamp glow: `.ou-stage-flat-bg`内に既存`lampGlow`キーフレーム流用のdiv要素を追加
- カードbox-shadow: `.ou-stage`（flat variant時）に指定box-shadowを追加（全画面PWAでは視覚効果ゼロの可能性、要検証）
- ステータス行: `TalkHeader`に新設（表示データソースの検討が先に必要）
- クイックチップ強調段階: `chipStyle`に強調フラグを追加し`very_long`時のみ専用スタイル
- 外側フォント: `--font-sans`を`"Zen Kaku Gothic New"`に変更、またはルート要素に`.font-sans-ui`明示適用
- 画像キャプション: `HerMessage`の画像ブロック直下に追加（データソース配線が前提）
- ヘッダー⋯ボタン色・再生成行色・入力バーborder-top色: 該当トークンを仕様値に合わせて新規token化
- 送信ボタン文字色: `"#241a0e"`ハードコードを`OU2.onLamp`に統一（またはonLamp自体を`#241a0e`に更新——要確認）
- placeholder色: 新規token（`#8e8470`）を`OU2`に追加

## 総評（コード差分のみの時点）

`src/component/ouse/` は「デザイン欠落」ではなく「A案の意欲的な移植実装」であり、メッセージバブル・チップ・入力ピルなど視覚的に最も目立つ要素はほぼ全てトークンレベルで完全一致（10箇所以上）。ズレは (a) 装飾レイヤー（lamp glow・box-shadow・ステータス行）の丸ごと未着手と、(b) 個別の色トークンの取り違えの2系統。(b)は機械的に洗い出し・修正可能な軽作業、(a)はステータス行のデータソース設計を要する中規模タスク。

---

## ③ 実スクショ突き合わせ（2026-07-21）

`pnpm dev`(5173) + `pnpm dev:worker`(8788) を起動し、Playwrightで390px幅の実チャット画面（柚月との会話）と、A案原本HTMLを直接ブラウザ描画したスクショを取得して並べて目視した。

証拠ファイル: `.work/qa/screenshot-actual-chat-390.png`（実装） / `.work/qa/screenshot-reference-variant-a.png`（原本）

### コード差分の再確認（視覚的に裏取りできた項目）

| 項目 | 結果 |
|---|---|
| ステータス行(`#c9bba6`)の欠落 | ✅視覚的に確認。実装画面はヘッダーの上に何も無く、いきなりヘッダーから始まる |
| ヘッダー下divider(境界線)の低コントラスト | ✅視覚的に確認。原本は薄いグラデーション線がはっきり見えるが、実装は境界がほぼ視認できない |
| lamp glow演出の欠落 | ✅視覚的に確認。原本は背景上部にランプの滲むような明るさのムラがあるが、実装は均一なグラデーションのみ |

### コード差分では拾えなかった新規発見（スクショ突き合わせで判明）

1. **「ゆうべのつづき」前回セッションプレビューがA案仕様に存在しない独自UI、かつフォントも仕様外**
   実装（`ou-app.tsx:246-279`）には、会話を開いた直後に前回の最後のメッセージを振り返る「ゆうべのつづき」プレビューブロックがある。border-left+背景`rgba(204,161,72,.04)`の枠付きカードで、スクショ上では吹き出しのように見えて紛らわしい。フォントに`"Zen Maru Gothic"`と`"Shippori Mincho"`を使用しているが、この2書体はA案仕様（Noto Serif JP / Zen Kaku Gothic Newのみ）に一切登場しない。
   判定: A案の「監査対象範囲外」の機能追加ではあるが、**仕様にない書体を新規導入している点は要確認**（意図的な演出なら良いが、フォント統一の観点では逸脱）。
   証拠: `src/component/ouse/ou-app.tsx:246-279`

2. **メッセージ下のコピー/読み上げ(TTS)ボタンはA案仕様に存在しない機能追加**
   実装のアシスタントメッセージ下に、コピーアイコンと再生(TTS)アイコンが表示される（`her-message.tsx:3,337` — `lucide-react`の`Copy`/`Play`/`Square`、`useSpeechSynthesis`フック使用）。A案の「再生成/ページャ行」（↻再生成・‹N/N›・⋯）とは別物で、design原本には一切描かれていない。
   判定: **これはデザイン違反ではなく、アプリの実機能（コピー・読み上げ）の追加**。監査対象は「静的モックアップとの視覚一致」なので、機能面のUIは対象外として扱う。ただし見た目のトーン（アイコン色・サイズ）が仕様の色系統から浮いていないかは別途確認の価値あり。
   証拠: `src/component/ouse/her-message.tsx:3,337`

3. **カードのbox-shadow欠落は実運用上は無効な指摘（訂正）**
   コード差分レポートの「カードのbox-shadow未実装」は、A案原本が「スマホをカードとして中央に浮かせて背景に影を落とす」という**モックアップの見せ方**（`doc/design/ouse/handoff/project/Chat Screen Explorations.dc.html:42`のbox-shadowはキャンバス上の演出）であって、実際にブラウザ全画面で動くアプリには適用しようがない装飾だった。**この項目は「未実装」ではなく「対象外」に格下げする。**

### 総評（最終）

視覚突き合わせの結果、コード差分レポートの指摘（ステータス行欠落・divider低コントラスト・lamp glow欠落）は3件とも実際に目で見て分かるレベルで再現した。加えて、コード差分だけでは見えなかった「前回セッションプレビュー」ブロックの仕様外フォント使用が新たに見つかった。box-shadowの指摘は実機に適用不能な項目だったため対象外に訂正する。

**最終的な修正優先度（実装する場合）:**
1. ステータス行の追加（データソース設計要）
2. lamp glow演出の接続
3. ヘッダーdivider・⋯ボタン・再生成行・入力バーborder-topの色トークン修正（機械的作業）
4. クイックチップ「たっぷり」強調スタイル追加
5. 「ゆうべのつづき」プレビューのフォントをNoto Serif JP系に統一するか要検討
6. （対象外）box-shadow、コピー/TTSボタン
