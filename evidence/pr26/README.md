# PR 26 の画面証跡

対象: https://github.com/kouiso/character-chat/pull/26 （キャラ作成の下書き復元と、保存後に新しいキャラの会話を開く修正）

このブランチは証跡の保管専用で、main へはマージしない。

## 取り方

- 手元の vite dev へ Chromium（Playwright、幅 420×860）でつなぎ、`/api` はすべて偽の応答で返した。本番やモデルは呼んでいない。
- 台本: 生成は 1 回目成功・2 回目 500。保存（`POST /api/characters`）は 1・2 回目 500（React Query の自動再送 1 回を含む）、3 回目成功。
- 修正後は PR 26 の head（5cbe50a）、修正前は PR 前のコードで同じ台本を流した。
- 赤枠と上部の説明は、元のスクリーンショットに後から描き足した。画面の中身には手を入れていない。

## 手順ごとの画像

| 手順 | 画像 | 見えていること |
|---|---|---|
| 1 | [01-preview.png](01-preview.png) | おまかせ生成が成功し、「できあがり」プレビューを表示。下書き（step=preview、名前=あおい）を端末に保存 |
| 2 | [02-reloaded-preview.png](02-reloaded-preview.png) | 再読み込みしても、下書きから同じプレビューが復元される |
| 3 | [03-regenerate-failed-keeps-preview.png](03-regenerate-failed-keeps-preview.png) | 「別の顔」の作り直しが 500 で失敗。プレビューに留まり、「作り直せませんでした。今の内容は残っています。」を表示 |
| 4 | [04-save-failed-keeps-content.png](04-save-failed-keeps-content.png) | 保存が 2 回とも 500。内容を残したまま「もう一度保存してください」と通知。下書きも残る |
| 5（修正後） | [05-after-saved-moved-to-chat.png](05-after-saved-moved-to-chat.png) | 再試行で保存成功。作ったキャラの会話 `/chat/char-e2e-1` へ移動し、下書きは削除 |
| 5（修正前） | [05-before-saved-moved-to-discover.png](05-before-saved-moved-to-discover.png) | 再試行で保存成功しても、移動先は `/discover`（さがす一覧）。会話は開かれない |
| 5（前後比較） | [05-pair-before-after.png](05-pair-before-after.png) | 左が修正前（/discover）、右が修正後（/chat/char-e2e-1） |

手順 1〜4 は修正前のコードでも同じ結果だった（ログが一致）ため、前後の差は手順 5 の移動先だけ。手順 5 の画面は遷移の途中で撮っているので、前の画面が薄く重なって写っている。

## 実行ログ（修正後）

```
1. 生成: プレビュー表示。下書き step=preview name=あおい
2. 再読み込み: プレビュー復元。表示名=true
3. 作り直し失敗: プレビューに留まる=true 下書き step=preview
4. 保存失敗: プレビューに留まる=true 下書き name=あおい
5. 再試行で保存成功: 移動先=/chat/char-e2e-1 下書き=消えた
   POST /api/characters の回数=3、POST /api/generate-character の回数=2
```

修正前は手順 5 が `移動先=/discover` になる。ほかの行は同じ。
