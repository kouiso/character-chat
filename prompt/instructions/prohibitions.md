---
applyTo: "**/*.ts,**/*.tsx,**/*.js,**/*.jsx,**/*.py,**/*.dart"
---

# Absolute Prohibitions (Project-Specific)

グローバル共通ルールと ECC 側の一般禁止事項を前提とし、本ファイルでは `adult-ai-app` 固有の禁則だけを定義する。

## コメント

- 英語コメント禁止。framework config など外部事情で必要な場合を除き、日本語で書く。
- 自明な What コメント禁止。Why、制約、外部要因、非自明な state/streaming 理由だけを書く。

## 目視確認の義務（スクリーンショット必須）

**Detection Criterion**: UI/画像/会話品質に影響する変更の完了報告で、`mcp__claude-in-chrome__*` ツール呼び出しが存在しない、またはスクリーンショットが添付されていない → 違反
**Detection Criterion 2（unit test 達成感による流れ停止）**: 画像プロンプト・重み・アンカー設定など画像出力品質に影響するファイルを変更した完了報告で、unit tests PASS のみを根拠として完了宣言し、実画像生成と目視確認を行っていない → 違反（unit test は「コードが正しいか」を確認するが「絵が白飛びしないか」は確認しない）

- UI・画像・キャラ会話品質に影響する変更は、完了報告の直前に `mcp__claude-in-chrome__*` で実画面を確認しスクリーンショットを証拠として添付する。
- 自動テスト（Playwright / e2e / unit）は品質補助ゲート。スクリーンショットなしの「テストが通っています」は完了報告として無効。
- 有効なスクリーンショットの条件：① UI が表示されている（ローディング中・エラー画面は無効）② 変更した機能・画面が視認できる。
- 画像生成変更の場合は追加で：構図・シーン適合性・NSFW 度・キャラ一貫性を主観評価してから報告する。
- Chrome MCP がブロックされる（Profile 3 / 1Password Nightly 干渉）場合は `chrome-incognito-cdp` skill に従い incognito ウィンドウで確認する。
- 目視確認ツールの優先順位と競合時の対処（諦め禁止）：
  1. Chrome MCP（通常ウィンドウ）→ 失敗なら
  2. Chrome MCP incognito ウィンドウ（`chrome-incognito-cdp` skill）→ 失敗なら
  3. `pnpm exec playwright screenshot --browser=chromium http://localhost:5173 /tmp/verify-$(date +%s).png` → 失敗なら
  4. 上記全て失敗した場合のみ「全手段試行済み → BLOCKED」と明示してユーザーに委任
- **モーダル・年齢ゲート等でページが隠れた場合（諦め禁止の典型ケース）**：
  - `pnpm exec playwright screenshot` は静的キャプチャのみ＝モーダルをクリックできない。
  - スクリーンショットに 18+ / ゲート / ローディング が映ったら「blocked」ではなく**手順 1（Chrome MCP）に戻る**。
  - Chrome MCP でゲートボタン（「はい、18歳以上です」等）を click → screenshot を取り直す。
  - ❌「headless では IndexedDB を通過できない」と書いて終了 = 諦め禁止違反
  - ✅ Chrome MCP → click ゲート → 再スクリーンショット → 本来の画面を確認
- **e2e 実行中でも playwright screenshot は常に並行実行可能（実証済み）**：
  - e2e は `chromium.connectOverCDP("http://127.0.0.1:9222")` でユーザーの Chrome に接続する
  - `playwright screenshot` は別プロセスの headless Chromium を新規 launch するため CDP 9222 を使わない
  - 2026-05-11 に e2e smoke 実行中に `playwright screenshot` を同時実行し、干渉なし・134KB PNG 生成を実証済み
  - 「Playwright が使われているので確認できません」は禁止。e2e 実行中こそ `playwright screenshot` を使う
- e2e 実行中の確認: `ps aux | grep 'tsx.*e2e' | grep -v grep`
- dev server (5173) が未起動の場合は `pnpm dev` を起動してから screenshot を撮る（8788 は API のみで UI は表示されない）
- コードレベルの証拠チェーン（「ロジック上 blur は false だから表示される」等）は目視確認の代替として無効。補足として添えるのみ許可。
- 連続変更は最終状態で 1 回確認すればよい（変更のたびに毎回スクリーンショットを撮る必要はない）。
- 例外（目視不要）：D1 マイグレーション・Cloudflare 設定・TypeScript 型定義のみ・環境変数のみの変更。`prompt/` 以下のテキスト変更であっても会話・画像品質に影響する場合は目視対象。

## 生成系・会話系品質

- chat / image の品質問題を見つけたのに黙って「完了」と報告するのは禁止。
- 部分完了を完了と偽装しない。未完了項目や既知の劣化があれば明示する。
- 同じ upstream service error を会話だけ変えて連続リトライしない。OpenRouter / Novita / external API 側の問題を疑い、原因と代替案を先に整理する。

## エロ品質バーは辛口 — 80点は「童貞にしか効かない」不合格ライン

**Detection Criterion**: e2e/dogfood の生成会話を「合格」「抜ける」「採用」と評価する報告で、スコアが90点未満、または減点軸（下記8点）の点検が欠落している → 違反

NEVER 生成会話を「抜ける/合格」と甘く採点する
WHEN 90点未満、または減点軸の具体点検をせずに点数だけ出す
BECAUSE このアプリの存在理由は「抜ける質」。80点は経験者には刺さらない＝童貞にしか効かないレベルで不合格。合格ラインは90点以上。甘い自己採点は局長の時間を浪費する。

採点前に必ず点検する減点軸（該当があれば具体的に減点理由を明示してから点数を出す）:
1. AI臭い言い回し（「快感に襲われる」「絶頂を迎える」等の定型・説明的フレーズ）
2. あえぎ・台詞が定型（「あっ…んっ」だけで個性・キャラ一貫性なし）
3. エスカレーション不足（climax が erotic と同程度の強度で、登り詰めが無い）
4. telling（説明）過多・showing（五感の具体描写）不足
5. 短い（responseLength 指定に対し明らかに短い）
6. 反復・使い回し表現
7. 解剖学的に曖昧・不整合
8. 相手視点への語りかけ・没入演出が無い

**e2e シナリオの「ユーザー側ターン」も AI臭さ点検対象**: AIが代理生成するユーザー発話が定型・不自然だとテスト自体が非現実的になりスコアの意味が消える。ユーザーターンも実在の人間の生々しさ（口語・要求の具体性・キャラへの反応）を満たすこと。

## 発見した壊れ・欠落は放置せず即修正（「直す?」で止まらない）

**Detection Criterion**: 作業中に機能の破損・欠落・バグを発見した報告で、「直しますか?」「やりましょうか?」等の提案・委任で終わり、同セッションで修正に着手していない（局長の明示ストップが無い）→ 違反

NEVER 発見した壊れ・欠落・バグを「直す?」と提案して止まる
WHEN 修正が技術的に可能（コード編集で閉じる・破壊的でない・局長の subjective 判断や課金や D1 破壊を要さない）
BECAUSE 「壊れてるのを見つけた→提案した」は解決ではない。drive-to-zero では発見＝着手。ultracode 中は尚更、Workflow で即実装に回す。提案で止めるのは Zero User Burden 違反。
例外: 局長の主観判断・D1 破壊操作・課金を伴う場合のみ提示して待つ。

## UX は常に使う立場で考え、課題があれば自発的に評価・提案する

**Detection Criterion**: `src/component/` または `src/app.tsx` に触れる変更の報告に「UX 評価」の明示（課題あり/なし のどちらか）が欠落している → 違反

- UI・フロー・インタラクションに触れる変更を報告する際、UX 評価を必ず付記する。
- UX 課題を発見した場合：登録済みスキル（`frontend-design`・`fitts-law`・`visual-hierarchy`・`gesture-patterns`・`navigation-patterns`・`animation-principles`・`aesthetic-usability`・`color-system`・`taste-skill`）を参照し「現状の問題点：〇〇 → 改善案：〇〇 → 優先度：High/Mid/Low」で提案する。
- UX 課題がない場合：「UX 評価：課題なし（理由：〇〇）」と明示する（無言で省略禁止。「なし」の報告も必要）。
- 提案はあくまで提案。実装は別途指示があった場合のみ行う。
- ユーザーから「UX も見て」と言わせることは禁止。自発的に評価・提案する。
- 適用除外：D1 マイグレーション・API エンドポイントのみ・型定義のみ・環境変数のみ・インフラ設定のみの変更。

## chat と image は常にセットで考える

**Detection Criterion**: chat または image のいずれかに影響する変更の報告で、もう一方への言及（影響確認の結果、またはスコープ外宣言）が完全に欠落している → 違反

- chat 系ファイル（`src/lib/api.ts` の `/api/chat` 系・`prompt/instructions/` 等）を変更した場合：image 生成プロンプトへの適用可否を確認し結果を報告する。
- image 系ファイル（`src/lib/api.ts` の `/api/image` 系・`functions/` の image 周り等）を変更した場合：chat 品質への波及がないか確認し結果を報告する。
- image をスコープ外とする場合：「image 側：スコープ外（理由：[具体的かつ検証可能な理由]）」と明示する。「関係ないため」「chat のみの変更のため」は理由として不十分（循環論法）。
- 「考慮」とは影響確認のみを指す。改善実装はユーザーが明示的に指示した場合のみ行う。
- 「image もやって」とユーザーに言わせることは禁止。
- 定義 — chat：OpenRouter 経由の会話テキスト生成（`/api/chat` 系）。image：Novita → R2 → ブラウザ表示（`/api/image` 系）。TTS・認証・D1 は対象外。
- 適用除外：D1 マイグレーション・インフラ設定・TTS のみ・認証のみ・型定義のみの変更。

## 良質な生成物はシードとして積極的に保存する

**Detection Criterion**: e2e スコア 85+ またはブラウザ目視で「良い」と判断した生成物を記録せずに次の変更で上書き・消失させた → 違反

- 画像・シーン・会話トークで「これは良い」と判断した出力は、ユーザーに言われる前に自発的に seed として保存する。
- **画像 seed**：使用したプロンプト・seed 値・Novita/R2 URL を `.work/seeds/images/YYYYMMDD-{description}.md` に記録する。
- **シナリオ seed**（会話・シーン共通）：e2e・目視・ユーザーとのやり取りで生まれた良質な会話トーン・文体・エロ描写・シーン遷移例を `.work/seeds/scenarios/YYYYMMDD-{description}.md` に保存する。保存フォーマット：
  ```
  # シナリオ種別: [会話トーン / シーン遷移 / エロ描写 / その他]
  # キャラ: [キャラ名]
  # 評価: [スコアまたは主観]
  ## ターン例 / シーン内容
  [実際の出力テキストをそのまま貼る]
  ## 何が良かったか
  [1〜3点]
  ```
- 「良質」の判定基準：e2e スコア 85 以上、または目視・主観で「これは抜ける」と判断したもの。
- 確認作業中に良い出力を発見したら、その場で即時保存する。「あとでまとめて」は禁止。

## ファイル運用

- repo 内に ad-hoc な temp / debug / backup ファイルを置かない。
- 一時検証が必要でも既存テストや既存コマンドで済ませ、不要なファイルは残さない。

## サーバー・プロセス管理

- `task up` や既存 workflow がある場合、`&` 付きの ad-hoc な dev server 起動で状態を壊さない。
- Playwright や手動検証のためにサーバーが必要なら、まず既存の起動手順と使用ポートを確認する。

## 指示スコープの無断変更禁止

- ユーザーが特定の手段・ツール・サービスを指定した場合、その手段での実現を最低 3 つの異なるアプローチで試行すること。
- 「技術的に困難」は「不可能」ではない。CAPTCHA、権限不足、API 制限等に遭遇しても、別経路（別 MCP、別ブラウザ、API Token 生成、CLI ツール等）を試す。
- 全手段を尽くした上でなお不可能な場合のみ、Gap 宣言（達成率 %、不足要素、代替案）を提示する。
- 「別のアプローチの方が早い」は指示変更の理由にならない。

## 調査前の「わからない」禁止

- `.work/e2e-results/`・`/tmp/dev-worker.log`・過去の manifest.json など手元に証拠ファイルが
  存在する場合、参照せずに「わからない」「確認できない」「根拠が不明」と答えることを禁止する。
- 品質・完成度・動作状況に関する質問を受けたら、まず過去の e2e 結果・worker ログ・スコア履歴を
  参照し、証拠ベースで回答せよ。
- 証拠を参照した上でなお不明な場合のみ「調査したが判断できない」と言ってよい。

## ブラウザ CDP ブロック時の並行安全な代替検証

**Detection Criterion**: ローカルサーバーが起動中で、以下の代替手段をいずれも試さずに「実機での確認はお願いします」「ブラウザで確認してください」と委任する → 違反

NEVER ユーザーに検証を委任する WHEN ローカルサーバーが起動中 AND 以下の手段が未試行の場合:

| 代替手段 | 用途 | 並行安全性 |
|---------|------|----------|
| `curl -s -X POST http://localhost:8788/api/chat -H "Authorization: Bearer test"` | API 応答テキスト検証 | ✅ ユーザーセッションと無干渉 |
| `mcp__claude-in-chrome__read_page` (accessibility API) | DOM テキスト・状態確認（CDP 不使用） | ✅ ユーザーのブラウザ操作と干渉しない |
| `pnpm exec playwright screenshot <url>` | ヘッドレスUIスクリーンショット | ✅ Chrome とは別プロセス |
| wrangler ログ (`/tmp/dev-worker.log` 等) | サーバーサイドエラー確認 | ✅ 読み取り専用 |

BECAUSE ユーザーが別の Claude Code セッションや別ブラウザウィンドウでアプリを使用中であっても、ヘッドレスブラウザ・curl・read_page はユーザーセッションに干渉しない。「他で使っているので確認できない」は禁止理由にならない。

## Playwright スクリプト失敗時の継続試行義務

NEVER ユーザーに視覚確認を委任する WHEN Playwright スクリプト/コマンドが修正可能なエラーで失敗した BECAUSE 1回の失敗は委任理由にならない。修正して再試行するのが AI の責務。

修正可能なエラーと対処例:

| エラー | 修正手段 |
|--------|---------|
| "element is outside of the viewport" | `{ force: true }` オプション追加、または `locator.scrollIntoViewIfNeeded()` |
| "Timeout waiting for selector" | セレクタ変更・待機時間延長・`waitUntil: 'networkidle'` |
| "locator resolved to multiple elements" | `.first()` / `.nth(n)` で絞り込み |
| "element is not visible" | `{ force: true }` または表示条件を確認 |

全修正手段を試した上でなお不可能な場合のみ「全手段試行済み → BLOCKED」と明示してユーザーに委任してよい。

## 検証スクリプトの直接実行禁止

**Detection Criterion**: Write ツールで `/tmp/*.js` または `/tmp/*.ts` を作成し Bash で実行した → 違反

NEVER Write ツールで `/tmp/` 配下に `.js` / `.ts` 実行スクリプトを作成して Bash で直接実行する
WHEN Playwright・Node.js・検証スクリプト等で動作確認を行う場合
BECAUSE MEMORY.md 司令塔ルール違反。「短いから自分でやる」は禁止パターン。
検証スクリプトも codex に委譲する（`/tmp/codex-task-<name>.md` に仕様を書いて `codex exec` で投入）。

- 例外: `pnpm exec playwright screenshot <url>` の単発 Bash 呼び出しは許可（スクリーンショット1枚取得のみ）
- 例外: `/tmp/codex-task-*.md` や `/tmp/*-plan*.txt` への Write は正規フロー（codex への仕様渡し）

## 調査タスクでの技術証拠の自己否定禁止

**Detection Criterion**: 調査/研究タスクの完了報告で、uiautomator XML / logcat / curl output / adb shell 結果 / DB クエリ結果 などの技術的テキスト証拠を「目視確認していない」「見ていない」と自己否定してユーザーに再確認を求める → 違反

NEVER `uiautomator dump` XML・logcat・curl 出力・adb shell 結果・DB クエリ結果などのテキストベース技術証拠を「目視確認していない」として自己否定し、ユーザーに視覚的再確認を求める
WHEN タスクが実機調査・ログ解析・ADB 操作・API 検証・第三者アプリ調査である
BECAUSE テキスト技術証拠はこれらタスクの正規一次証拠であり、自己否定は Zero User Burden 違反。「目視確認必須」ルールは adult-ai-app への UI 実装変更に対するものであり、第三者アプリ調査・ログ解析には適用しない。

## 認証情報取得は 1Password を最優先 (MCP > CLI > ユーザー介入)

**Detection Criterion**: パスワード・API キー・OAuth トークン等の認証情報をユーザーに口頭・手動入力で要求した、または実機の biometric/PIN 認証フローに進めようとした、その同じターン内で `ToolSearch query="1password"` または `which op` / `op item list` の呼び出しが一切ない → 違反

NEVER ユーザーに認証情報を口頭で要求する OR 実機 (ADB / Chrome MCP) の biometric/PIN auth フローに進める
WHEN 当該認証情報が 1Password に存在する可能性がある (Google アカウント・各種サービスログイン・OpenRouter/Novita/Anthropic 等 API key・GitHub PAT 等)
AND 以下の探索が同ターン内で未試行:
1. `ToolSearch query="1password"` で MCP 確認
2. `which op` で 1Password CLI 確認
3. WSL: `source /home/kouiso/ghq/getozinc/.envrc` / macOS: `source /Users/kouiso/ghq/getozinc/.envrc` でサービスアカウントトークン load → その後 `op item list --format=json` でアイテム検索
4. `op item get <ID> --fields password --reveal` で取得

**⛔ STOP GATE (step 2 失敗後)**: `op` が "not signed in" / "desktop app is not running" を返しても、ユーザーに聞く前に **必ず step 3 を試す**。WSL 環境では `source /home/kouiso/ghq/getozinc/.envrc` でサービスアカウントトークンが有効化され `op` が使えるようになる（2026-06-24 実証: RUNWARE_API_KEY 取得成功）。「op が応答しない = ユーザー介入必須」は誤り — step 3 で解決できる。
BECAUSE 1Password CLI/MCP で 1 コマンド (`op item get <ID> --vault <V> --fields password --reveal`) で取得できる情報をユーザー介入経由で取らせるのは Zero User Burden 違反。手動入力は最終手段。

詳細は `~/.claude/rules/credential-lookup-1password-first.md` と同 skill (`~/.claude/skills/credential-lookup-1password-first/SKILL.md`) を参照。

### この repo で特に頻発する適用先

- adult-ai-app の e2e/実機検証: テスト用 Pixel への Google ログイン (sukererion@gmail.com 等)
- OpenRouter / Novita / Anthropic API key の取得 (`.dev.vars` 編集時)
- Cloudflare API Token (CLOUDFLARE_API_TOKEN — wrangler 認証時)
- GitHub PAT (gh CLI 再認証時)

### 取得後の取り扱い

- シェル変数にキャプチャし、`adb shell input text "$PW"` 等の consumer に直接渡す
- `echo "$PW"` / stdout 出力 / chat に貼り付け は禁止。検証ログは `${#PW}` (長さ) または `head -c 2` (先頭 2 文字 + ***) のみ
- 単一ターンで使い終わったら shell 変数のスコープ内で消滅させる (export しない)

## Cloudflare エッジコードを認証失敗と誤診断禁止

**Detection Criterion**: 外部 API が HTTP 403/503 を返し、レスポンスボディに `error code: 1010`/`1015`/`1020`/`1009` が含まれるのに「API キーが無効」「アカウント停止」と結論付けた → 違反

NEVER 外部 API の HTTP 403/503 を「API キー無効/アカウント停止」と結論付ける
WHEN レスポンスボディに `error code: 1010`/`1015`/`1020`/`1009` が含まれる（Cloudflare WAF/bot ブロック）
BECAUSE これらはエッジの bot ブロックシグナルであり、認証エラーではない。修正手段はリクエスト成形（browser User-Agent の付与・別 HTTP クライアント・実ブラウザ経由）であって、キー再発行やユーザーへの dashboard 操作委任ではない。

NEVER 1 経路の失敗を受けてユーザーに「キー再発行をしてください」「ダッシュボードで確認してください」と委任する
WHEN 以下の代替手段を試行していない場合:
1. browser User-Agent 付与でリトライ (`Mozilla/5.0 ... Chrome/...`)
2. 別 HTTP クライアント（python urllib 等）でリトライ
3. Playwright / CDP 経由の実ブラウザで API を叩く

BECAUSE 2026-05-29 の実証で確認: Novita API は no-UA → `403 error code: 1010`、browser UA → `200 task_id` → `TASK_STATUS_SUCCEED`。キーもアカウントも有効だった。「諦めるの早すぎ」は禁止。

## 本番 verification で0件は即調査必須

NEVER 本番でキャラ・会話・ユーザー等のコアエンティティが0件の状態を
「データが入っていないから」と理由づけして調査なしに完了報告する
WHEN 本番動作確認を行っている
BECAUSE 0件はDBバインディング誤り・マイグレーション未適用・環境誤認・データ消失の
シグナルであり、`wrangler d1 execute` でのクエリ確認が必須。

## 把握済みの重大ギャップを但し書きに留める禁止

**Detection Criterion**: 完了報告に「但し書き/注記/limitation/正直さギャップ」が含まれる AND 同ターンの計画・実行中にその内容を「重大/H/critical」と格付けしていた AND そのギャップを解消するアクション提案がない → 違反

NEVER 重大と格付けした課題を「但し書き」として完了報告に添えるだけで終わらせる
WHEN そのギャップを同ターンの計画・調査・実行中に自分で特定・格付けしていた
BECAUSE 「知っている → 書いた」は解決ではない。ギャップを把握しているなら:
  (a) そのターン内で閉じる（追加検証を実行する）、または
  (b) 「このギャップを閉じるには○○が必要です。やりますか？」と明示的に提案する
  のどちらかにしかならない。「知っているけど残す」は選択肢にない。

## 本番デプロイの動作確認は実アクセス証拠必須

NEVER 本番デプロイを「完了」「正常稼働中」と報告する
WHEN 本番 URL（`https://adult-ai-chat.pages.dev`）への実際のアクセス証拠が存在しない
（スクリーンショット、curl レスポンスボディ、DOM テキスト取得のいずれか）
BECAUSE ビルド成功 ≠ 本番稼働。CF Pages デプロイは失敗・旧ビルド継続・CF Access 設定破損など
「build OK だが prod が壊れる」シナリオが実証済み（2026-05-23 以降の停止事例）。

試みるべき手段（この順で全て試してから BLOCKED 宣言）:
0. **【最優先・確立済み】** `.prod-verify.vars` + `pnpm verify:prod:browser` で Playwright CF バイパス実行 → スクリーンショットが `.work/e2e-results/browser-smoke-*.png` に生成される。この方法が最初の選択肢。`pnpm verify:prod` (reachable/auth モード) で API 疎通も確認可能。
1. Chrome MCP で `https://adult-ai-chat.pages.dev` へ navigate → スクリーンショット（CF Access cookie が既存タブにある場合）
2. CF Access 認証済みの既存タブ（tabs_context で確認）経由でナビゲーション
3. curl で JS バンドル URL を直接取得して対象文字列を grep
全て失敗した場合のみ「全手段試行済み → BLOCKED」と宣言し、ユーザーに本番確認を依頼する。

**NEVER「以前見れるようにした」発言があった場合に past-session-audit をスキップして BLOCKED を宣言する。**
まず `grep -r "verify:prod\|browser-smoke\|prod-smoke" ~/.claude/projects/-Users-kouiso-ghq-kouiso-adult-ai-app/` で確立済み手段を探してから判断すること。

## 本番 verify インフラを使わずに「CF Access でブロック」と宣言禁止

**Detection Criterion**: 本番動作確認タスクで、`.prod-verify.vars` の存在確認と `pnpm verify:prod` / `pnpm verify:prod:browser` の実行を試みずに「CF Access でブロック」「本番にアクセスできない」「ユーザーにログインしてもらう必要がある」と宣言する → 違反

NEVER 本番確認を「CF Access 認証が必要でブロック」と宣言しユーザーに委任する
WHEN `.prod-verify.vars` / `pnpm verify:prod` / `pnpm verify:prod:browser` の実行を同ターン内で試行していない
BECAUSE このプロジェクトには CF Access サービストークンによる AI 自律的本番 verify インフラが確立済み（`script/verify/prod-smoke.ts` + `script/verify/browser-smoke.ts`）。「CF Access = 人間ログイン必須」は **誤った前提**。`pnpm verify:prod` を実行すれば AI 単独で本番 API・UI の動作確認が完結する。

必須手順:
1. `.prod-verify.vars` の存在確認: `ls .prod-verify.vars`
2. API 疎通確認: `pnpm verify:prod`（課金なし）
3. UI ブラウザ確認: `pnpm verify:prod:browser`（課金なし、スクリーンショット生成）
4. 上記全て失敗した場合のみ「全手段試行済み → BLOCKED」と宣言

ローカル dev 同等証拠について（`remote-ci-down-local-equivalent-ok` 原則の適用）:
- 変更が **純粋ロジック変更**（DB/インフラ/環境変数の差がない）の場合はローカル `[実機目視]` スクショも証拠として有効
- ただし、これはフォールバック。`pnpm verify:prod` が使える限り本番確認を優先すること

## セッション内承認済みタスクの再確認禁止

NEVER 「直す？」「やりますか？」「進めますか？」「始めていいですか？」等の再承認を求める質問をする
WHEN 同セッション内でユーザーが既にそのタスクを明示的に指示していた
（割り込み作業を挟んでいても指示は有効のまま）
BECAUSE 承認済み指示の再確認はユーザーの時間を浪費し Zero User Burden 違反。
作業が終わったら次の承認済みタスクを即座に開始せよ。


## 実行可能な本番操作をユーザーに委ねる禁止

**Detection Criterion**: 完了報告に「ユーザーが実施」「手動で設定してください」「〜してください」と書いて、自分で実行できる操作（wrangler secret put / gh CLI / curl 等）を委ねた → 違反

**Detection Criterion 2（選択肢提示も違反）**: 提案・完了報告で「ユーザーが手動で実施する」を選択肢・option・代替案として提示した AND 自律的に取れる経路（API 別経路・cron 自動リトライ・待機後再試行・別ツール）が1つでも残っている → 違反。「自動でやる / 君が手動でやる」の2択を出すこと自体が禁止。

NEVER 完了報告の残件として wrangler / gh / curl 等のコマンドをユーザーに書き残す
WHEN そのコマンドが現在のシェル環境で実行可能（wrangler 認証済み・必要な鍵が `.dev.vars` にある等）
BECAUSE 実行できる操作を委ねるのは Zero User Burden 違反。「本番っぽい」「確認が要る気がする」は委ねる理由にならない。

NEVER 「ユーザーが手動でやる」を選択肢として提示する
WHEN 自律経路（別 API・WAF クールダウン後の自動リトライ・別ブラウザ/ツール・待機）が1つでも残っている
BECAUSE WAF ブロックや SPA 不描画などの障害でも、別経路を取り続けるのが AI の責務。ブロック時は「ユーザーがやる選択肢」ではなく「〇〇で自動リトライ中（完了したら報告）」と宣言する。ユーザーに選ばせた時点で Zero User Burden 違反。

適用除外：
- biometric / PIN / OAuth ブラウザログインが必要な操作
- 請求・支払いを伴う操作
- 実行に明示的なユーザー意思確認が必要な破壊的操作（本番 DB drop 等）
- 全自律経路を試行し尽くした証拠がある場合のみ「全手段試行済み → BLOCKED」と宣言してよい（ただし「選択肢」ではなく状態報告として）

## 妥協案を選択肢として出す禁止（品質を下げる許可を求めるな）

**Detection Criterion**: ユーザーへの質問・提案・完了報告の選択肢に、
「既知の欠陥を残す案」「品質を下げる案」が1つでも含まれている → 違反。
選択肢の説明文に「工数がかかる」「作業が1日ほど」「時間が惜しい」等、
**自分の工数を理由にした比較**が書かれていたら、それが動かぬ証拠。

NEVER 品質を下げる案・欠陥を残す案を選択肢としてユーザーに提示する
WHEN その欠陥がゴール（局長が抜ける）を損なう
BECAUSE ゴールに照らせば答えは一つに決まる。二択にした時点で、
決まっとる答えから逃げて自分の工数を守っとる。
ユーザーは「品質を下げてよいか」を判断する係やない。

**判定の順番（これを踏めば二択は自然に消える）**

1. ゴールは何か。このアプリなら「局長が抜ける」
2. その欠陥はゴールを損なうか。損なうなら**直す一択**。工数は判断材料に入らん
3. 損なわんなら**要件から落とす一択**。残して監視する必要も無い
4. 1〜3 を踏んでも答えが割れるのは、**ゴールが2つ以上あって優先順位が未定**の時だけ。
   その時に初めて聞いてええ。聞く時は「どっちの工数が安いか」やのうて
   **「どっちのゴールを取るか」**を聞く

**質問してよい唯一の形**

- ✅「Sakura の清楚さを保つのと、絶頂の激しさを取るのは両立せん場面がある。どっちを優先しますか」
  （ゴール同士の衝突。ワイには決められん）
- ❌「Aは安く済むが品質が落ちる / Bは高品質だが工数がかかる」
  （工数の話。ワイが決めるべきこと）
- ❌「今のままでも許容できますか」
  （欠陥を残す許可を求めとる）

**「測ってから決める」も逃げになる場合がある**

計測が答えを変えるなら正しい。
計測結果がどちらでも「直す」に決まっとるなら、計測は着手を遅らせる口実でしかない。
測る前に「この数字がこう出たら何をするか」を両方書けること。書けんなら測らずに直せ。

## 個別タスクの完了をゴールの達成として報告する禁止

**Detection Criterion**: 完了報告・区切りの報告の中で、**ゴールの達成条件が全部満たされたか**に
触れずに「〜が終わりました」で止まっとる → 違反。
あるいは、ゴールの条件表に ❌ / 🔄 が残っとるのに手を止めた → 違反。
機械判定: 報告に「ゴールの条件のうち何が残っとるか」と「次に自分が何をするか」の
**両方**が書かれとるか。片方でも欠けたら違反。

NEVER 個別タスクを終えた時点で手を止める / 完了として報告する
WHEN ゴールの達成条件（このアプリなら L1 全部 ✅ かつ L2 PASS）がまだ揃っとらん
BECAUSE タスクは通過点であってゴールやない。**手段（PR マージ・テスト緑・issue クローズ・
リリース）が目的化した瞬間、ゴールへ届かんまま「終わった」ことになる。**
局長は「次どれやりますか」を決める係やない。優先順位は既に渡されとる。

### 節目ごとに問うこと

1. ゴールは何か。手段と取り違えとらんか
2. ゴールの条件表のうち、まだ ❌ / 🔄 はどれか
3. それを潰すために**次に自分が**何をするか

3 が書けん時だけ、初めて聞いてええ。

### 待ちは止まる理由にならん

CI 待ち・実測待ち・デプロイ待ち・レビュー待ちは、**他の独立タスクへ着手するトリガー**。
「待ちです」とだけ報告して止まるのは、聞かずに止まるのと同じ怠慢。

### 詰まった時

§ 罠を疑う → 別の手を 3 つ試す → それでも駄目なら**他の独立タスクへ移る**。
「解けんかったので止まりました」は、他に進める作業がある限り違反。

## 引き継ぎ成果物を「本体は別ファイル、入口は要約」で作る禁止

**Detection Criterion**: 引き継ぎ・依頼・仕様として**単体で渡される成果物**（GitHub issue /
PBI / PR 本文 / handoff）の中に、**受け取る側が仕事を始めるのに要る情報**が入っとらず、
「詳細は `<ファイル>` を読め」で外へ出しとる → 違反。
機械判定: その成果物だけを読んで、(1) ゴール (2) 完了判定の基準の**実物**
(3) 次にやることの具体 (4) 踏んだらあかん既知の罠 (5) 実行に要る手順・環境
の 5 つが全部答えられるか。1 つでも「別ファイルを見んと分からん」なら違反。

NEVER 引き継ぎ成果物の本体を別ファイルへ出し、渡す物を要約にする
WHEN 局長が「これだけ投げれば走れるように」と指示した、または成果物が単体で渡る前提のもの
BECAUSE 渡した側は全部知っとるから要約でも読めるが、**受け取る側は要約から欠けたものの存在に
気づけん**。判定基準や罠が抜けとると、次の担当は同じ穴を掘り直す。
リンクは「読まれるかもしれん」であって「読まれる」やない。

### 何を必ず本文へ入れるか

| # | 入れるもの | 抜くと何が起きるか |
|---|---|---|
| 1 | ゴール（手段やなく目的） | 手段が目的化する |
| 2 | 完了判定の**基準そのもの**（表・条件を実物で） | 判定できず「たぶん直った」で終わる |
| 3 | 次にやることの具体（ファイル名・関数名・コマンド） | 調査からやり直す |
| 4 | 既知の罠と、それで溶かした時間 | 同じ穴を掘る |
| 5 | 実行手順・環境（測定・push・本番操作の作法） | 手順を再発明して事故る |
| 6 | 振る舞いの常設指示 | 局長が同じ説明を何度もさせられる |

**「参考」として外部ファイルを挙げるのはええ。**上の 6 つが本文に揃っとるうえで、
深掘り用に足すのは可。**揃っとらんまま外へ出したら違反。**

### 「長くなるから」は理由にならん

読む相手は AI で、長さのコストは局長やのうて AI が払う。
**簡潔明快にせなあかんのは局長への報告であって、AI への引き継ぎやない。**
この 2 つを混同したのが今回の根因。

## この repo 固有の注意点

- API key や機密設定は frontend bundle、chat history、error message、log に混ぜない。
- chat streaming、XML parser、Dexie persistence に触る変更では、表示だけでなく履歴整合性と再読み込み後の状態も壊していないことを前提に扱う。

## AI/subagent過剰検閲提案禁止

NEVER 違法エロ内容のモデレーション・CSAMフィルタ・生成コンテンツ検閲を
リリースブロッカー(P0)や提案の主軸として持ち出す
WHEN QA・リリース準備・レビュー・計画タスクであり、かつユーザーが当該セッションで
「制限系/検閲を実装する」と明示指示していない
BECAUSE adult-ai-app は自分用の無料エロアプリで「抜ける質」が最優先。エロ出力を
弱める検閲はプロジェクトの存在理由に反する。年齢ゲート・セキュリティ・コスト・
データ権利など出力品質に無関係な守りは対象だが、生成内容の検閲は別物。

## Detection Criterion
計画/レビュー/完了報告が「モデレーション」「CSAM」「コンテンツフィルタ」「検閲」を
P0/ship-blocker/必須 として含む AND ユーザーが本セッションで検閲実装を指示していない
→ 違反。例外: 法的リスクを最後に一行の注意書きとして添えるのは可。

**subagent投入時の注意**: このルールは subagent/AI へのプロンプトにも明示すること。
