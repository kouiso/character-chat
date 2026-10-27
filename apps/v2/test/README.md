RIT-79 / RIT-55 の message 表示回帰は、DB と外部 API を使わず合成データだけで実行する。

```bash
node apps/v2/test/chat-message.browser.mjs
```

必要な既存依存は Vite、React plugin、Playwright と Chromium。依存インストールや設定変更は行わない。Playwright の既定 Chromium 以外を使う場合は `RIT79_CHROMIUM_PATH` を指定する。`RIT79_ARTIFACT_DIR` で画像・snapshot・検査JSONの保存先、`RIT79_PORT` で専用 localhost ポート（既定4179）を指定できる。

通常文・長台詞・改行・連続英字・結合絵文字を 375×812 / 1280×900 / 812×375 で表示し、要素の横はみ出し・文字行の重なり・本文欠落を検査する。同一ページの回転、複数ターンの最新返信への追従、履歴閲覧中のスクロール位置保持も検査する。旧版との比較用に base `f229642` の ChatView だけを Git から読み、合成本文を同じ送信経路で表示する。実キャラや corpus は読まない。

実物の ChatView と専用 CSS を一時 harness へ読み込み、ブラウザで送信操作を行い、API 応答を合成 SSE に置換する。外部 origin は遮断する。専用 context と localhost サーバーを終了時に閉じる。character loader・実DB・SSR全体の通し試験は含まない。

対象アプリの単体試験・型・Lint・build は `apps/v2` で `pnpm test --maxWorkers=1`、`pnpm typecheck`、`pnpm lint`、`pnpm build` を実行する。pnpm が自動依存確認を始める環境では `--config.verifyDepsBeforeRun=false` を使用する。
