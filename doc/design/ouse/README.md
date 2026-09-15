# Ouse 設計ファイル

Claude Design プロジェクト `3e6b2653` から書き出した設計資料。
Devin が実装 issue を参照する際のブリッジとして使う。

## ファイル一覧

| ファイル | 内容 |
|---|---|
| `PRODUCT_MEMO.md` | プロダクトメモ（Claude Design CLAUDE.md から） |
| `ouse-conversation-screen.html` | 会話画面モックアップ（モバイル402×874、4層メッセージ・インライン写真・モードChips・入力バー） |

## 実装ギャップ表（#1–#20）

Gen2実装（`src/component/ouse/`）対 設計 の差分。Devin issue はこの表と上記ファイルを参照する。

| # | 画面/機能 | 状態 | 設計参照 | 担当 |
|---|---|---|---|---|
| 1 | Arrive（初回greeting・ゆうべのつづき継続文） | △PARTIAL | `ouse-conversation-screen.html` | Devin |
| 2 | Talk 4層メッセージ（状況/描写/セリフ/本心） | ✅HAVE | `ouse-conversation-screen.html` | — |
| 3 | Talk thinking（「ことばを探している…」点線） | △PARTIAL | `ouse-conversation-screen.html` | Devin |
| 4 | 文字送りcadence（時間ベース/層遅延） | ✅HAVE | `src/component/ouse/use-paced-reveal.ts` | — |
| 5 | 写真 全画面A（到着時画面占有） | △PARTIAL | `ouse-conversation-screen.html` | Devin+副長(G4) |
| 6 | 写真 カードB（会話内インライン） | ✅HAVE | `ouse-conversation-screen.html` | — |
| 7 | 動画（再生輪/進捗） | ❌MISSING | 設計v2未完成 | Devin |
| 8 | ねだるシート（写真/動画/しおり/漫画化 4項目） | △PARTIAL | 設計v2未完成 | Devin |
| 9 | 指先操作Chips（続き/行動/本音/急展開/覚えて/セリフ/ふるまい） | ✅HAVE | `src/component/ouse/chips-panel.tsx` | — |
| 10 | ふたりの抽斗Drawer（記憶/場面/写真/漫画/分岐 5タブ） | ❌MISSING | 設計v2未完成 | Devin |
| 11 | アルバム（写真+動画・キャラ絞り） | △PARTIAL | 設計v2未完成 | Devin |
| 12 | 今夜のはじまり（筋書きピッカー） | ❌MISSING | 設計v2未完成 | Devin |
| 13 | 設定 | ✅HAVE(流用) | `src/component/ouse/ou-rail.tsx` | — |
| 14 | キャラ切替（faces/rail） | ✅HAVE | `src/component/ouse/ou-faces-sheet.tsx` | — |
| 15 | 出会い/Discover（web-portal削除で消失） | ❌MISSING | 設計=旧proto参照 | Devin |
| 16 | その人/Profile（CharacterDetailPage削除で消失） | ❌MISSING | 設計=旧proto参照 | Devin |
| 17 | したてる/作成+ウィザード(3step) | ❌MISSING | 設計=旧proto参照 | Devin |
| 18 | 宴/うたげ（グループ・旧group-view未統合） | ❌MISSING | 設計=旧proto参照 | Devin |
| 19 | 漫画ビューア（旧comic-viewer未統合） | ❌MISSING | 設計=旧proto参照 | Devin |
| 20 | 分岐/Branch | ❌MISSING | screenshots参照のみ | Devin |

## 設計完成度の注記

`#7〜#14`（動画/ねだる/抽斗/アルバム/はじまり）は Claude Design v2 ソース（`ouse2-app.jsx`）で描き起こし済み → Devin が忠実移植可能。  
`#15〜#20`（出会い/その人/したてる/宴/漫画/分岐）は Claude Design 側も旧proto止まりで v2 デザイン未完 → Devin issue に「旧proto＋screenshot を参照素材に v2 ビジュアルへの描き起こし込みで実装」と明記する。

## Gen2ベースブランチ

`origin/wip/20260626-w1-eval-recovery` @ `4920dfb` に Gen2一式（19ファイル）保全済み。
Issue 0（基盤移植）はここから `src/component/ouse/*` を現main起点ブランチへ移植する。
