# 回帰テストカバレッジ表

git history と GitHub issues から確認した既知バグを、現在の回帰テストまたは手動ゲートに対応付ける監査用メモです。

## Chat/ストリーミング

| バグ | 症状 | Issue/PR | 回帰テスト | テスト層 |
| --- | --- | --- | --- | --- |
| afterglow final turn crash | `afterglow` キー欠落で最終ターンが空応答/サーバークラッシュ | #2 | `src/lib/emotional-arc-patterns.test.ts` | unit |
| scene-card character context 欠落 | 「誰として」が system prompt に乗らず会話品質が崩れる | #7 | `src/data/scene-cards.test.ts`, `src/lib/prompt-builder.test.ts` | unit |
| キャラ名ラベル欠落 | 発話者が曖昧になる | #9 | `src/component/chat/message-bubble.test.tsx` | component |
| AI 生成タイトル失敗 | 「新しい会話」が永続化される | #12 | `src/lib/conversation-summary.test.ts` | unit |
| long chat scene drift | 夜行バスがベッド/車など別場面へ変化 | #106, #318 | 手動ゲート: `pnpm e2e:long:safe` | LLM e2e |
| 過剰同意確認/謝罪文混入 | 「いいですか?」「申し訳ございません」など没入阻害文が混入 | #108, #109, #122, #156, #265 | `src/lib/quality-guard.test.ts`, 手動ゲート: `pnpm e2e:long:safe` | unit + LLM e2e |
| directive 表示漏れ | 「続き/行動/本音/急展開」の内部指示が user 発言として表示 | #115 | `src/component/chat/chat-view.test.ts`, `src/component/chat/solo-tools-panel.test.ts` | component/unit |
| background tab 空 bubble | background 中の AI 返信が空 bubble で終了 | #116, #213 | `src/component/chat/message-bubble.test.tsx`, `src/lib/api.test.ts` | component/unit |
| response XML/tag leak | streaming XML や未知タグが画面へ漏れる | #293, #305, #316, #327, #414, #415 | `src/lib/xml-response-parser.test.ts`, `src/lib/sanitize-injection.test.ts`, `src/component/chat/message-bubble.test.tsx` | unit/component |
| broken chat reply quality gate | 壊れた応答をユーザー表示前に止める | #324 | `src/lib/quality-guard.test.ts`, `src/lib/openrouter-chat-reply-guard.test.ts` | unit |
| cross-character contamination | 別キャラ名や人格が混入する | #325, #326 | `src/lib/quality-guard.test.ts` | unit |
| near-duplicate replies | 双葉そらなどで同じ返答が繰り返される | #336, #347 | `src/lib/anti-repetition.test.ts`, `src/lib/quality-guard.test.ts` | unit |
| empty stream silent close | 空ストリームが無言終了する | #410 | `src/lib/api.test.ts`, `src/component/chat/stream-sanity.test.ts`, `src/lib/stream-quality-meta-timeout.test.ts` | unit |
| quality meta timeout | quality check 待ちで stream 完了が遅延/固着 | git: `stream-quality-meta-timeout` | `src/lib/stream-quality-meta-timeout.test.ts` | unit |

## 画像生成

| バグ | 症状 | Issue/PR | 回帰テスト | テスト層 |
| --- | --- | --- | --- | --- |
| missing image API key 500 | Novita key 未設定で Internal Server Error | #260 | `src/lib/image-gen/novita-provider.test.ts`, `src/lib/image-gen/router.test.ts` | unit |
| image error raw text | 画像生成失敗時に raw error が利用者へ見える | #333 | `src/component/chat/chat-view.test.ts`, `src/component/chat/message-bubble.test.tsx` | component/unit |
| unexpected Novita JSON | ZodError/parse error が unhandled 500 になる | #311, #398, #422 | `src/lib/image-gen/novita-provider.test.ts`, `src/lib/image-gen/runware-provider.test.ts` | unit |
| Cloudflare 1010 no-UA block | User-Agent 無しで Novita が CF bot block | #373 | `src/lib/image-gen/novita-provider.test.ts` | unit |
| workerd fetch illegal invocation | global fetch の束縛で local workerd が例外 | #376 | `src/lib/image-gen/novita-provider.test.ts` | unit |
| provider fallback/timeout | Runware fallback, timeout, swallowed error が復旧不能 | #393 | `src/lib/image-gen/runware-provider.test.ts`, `src/lib/image-gen/router.test.ts` | unit |
| profile/chat image mismatch | profile 画像と会話上画像が乖離する | #104, #117, #242, #392, #412 | `src/lib/chat-image-prompt.test.ts`, `src/lib/image-phase-guardrails.test.ts`, 手動ゲート: `pnpm e2e:long:safe` | unit + LLM e2e |
| R2 image display failure | 画像が読み込まれない/TTL URL が死ぬ | #227, #250 | `src/lib/avatar-url.test.ts`, `src/lib/r2-image-cache.test.ts`, `src/component/chat/message-bubble.test.tsx` | unit/component |
| R2 IDOR/avatar upload | 他人の R2 key 参照や upload path 混線 | #323, #390, #400 | `src/lib/avatar-url.test.ts`, `src/component/chat/message-bubble.test.tsx` | unit/component |
| duplicate image generation | 同一 content で R2 キャッシュを使わず再生成 | #408 | `src/lib/r2-image-cache.test.ts` | unit |
| imageMeta missing | upload avatar から visual metadata が埋まらない | #399, #406 | `src/schema/character.test.ts`, `src/lib/chat-image-prompt.test.ts` | unit |
| NSFW blur/skeleton/onError | 黒画像、blur 未配線、fallback 不足 | #330, #391, #396 | `src/component/chat/message-bubble.test.tsx`, `src/lib/avatar-url.test.ts` | component/unit |

## D1/データ

| バグ | 症状 | Issue/PR | 回帰テスト | テスト層 |
| --- | --- | --- | --- | --- |
| D1 100 variable limit | `inArray` が多すぎて character/conversation が消える | #198, #199, #201 | `src/lib/__tests__/d1-chunk.test.ts`, `src/lib/__tests__/d1-chunk-coverage.test.ts` | unit |
| profile images invisible after migration | production migration 未適用で profile 画像が全件非表示 | #149, #151 | `script/verify/pages-deploy-readiness.ts`, `pnpm verify:pages-deploy-readiness` | ops gate |
| scene bookmark migration | legacy bookmark/state の移行漏れ | git: `scene-bookmark` | `src/lib/scene-bookmark-migration.test.ts` | unit |
| conversation preview/title fallback | 履歴に中身なし/不安定な fallback が出る | #223, #235 | `src/lib/conversation-summary.test.ts`, `src/component/chat/conversation-list.test.tsx` | unit/component |
| message image metadata | 画像 URL/key/task metadata の保存経路が混線 | #250, #372, #386 | `src/schema/character.test.ts`, `src/component/chat/message-bubble.test.tsx` | unit/component |
| memory relevance drift | memory 注入で焦点がぼやける | #157, #215 | `src/lib/memory-relevance.test.ts`, 手動ゲート: `pnpm e2e:long:safe` | unit + LLM e2e |

## UI/ルーティング

| バグ | 症状 | Issue/PR | 回帰テスト | テスト層 |
| --- | --- | --- | --- | --- |
| discover scroll reset | キャラ選択から戻ると一覧スクロール位置がリセット | #183 | `e2e/char-list.spec.ts` | Playwright |
| sticky search/filter | mobile 検索バーや filter chips が固定されない | #180, #181, #226 | `e2e/char-list.spec.ts` | Playwright |
| chat greeting offscreen | chat open 時に avatar/greeting が初期 viewport に出ない | #184 | `e2e/chat.spec.ts` | Playwright |
| conversation recovery weak | 過去会話に復帰しづらい | #306, #307 | `src/component/chat/conversation-recovery.test.ts`, `src/component/chat/conversation-list.test.tsx` | component/unit |
| back button drawer/navigation | 戻るボタンで drawer/list へ戻らない | #230, #352, #358 | `src/lib/hash-navigation.test.ts`, `src/component/chat/chat-view.test.ts` | unit/component |
| hash rewrite loop crash | hash rewrite が hashchange を再 dispatch して無限 render | #411, #415 | `src/lib/hash-navigation.test.ts`, `src/lib/app-route.test.ts` | unit |
| blank PWA on render crash | back-button crash などで白画面になる | #409, #411 | `src/component/error-boundary.test.tsx` | component |
| iOS age gate black screen | 年齢確認後に body scroll が戻らず真っ暗 | #351, #357 | `src/lib/app-route.test.ts`, 手動 mobile smoke | unit/manual |
| character modal stale route | modal が navigation 後も残る | #240 | `src/lib/app-route.test.ts`, `src/component/chat/scene-card-picker.test.tsx` | unit/component |
| share/social/support leftovers | fake social metrics, support/charge/pricing が残る | #236, #257, #262, #416, #423, #424 | `src/component/chat/message-bubble.test.tsx`, `pnpm verify:no-github-actions-deploy` | component/ops |

## 認証/CF Access

| バグ | 症状 | Issue/PR | 回帰テスト | テスト層 |
| --- | --- | --- | --- | --- |
| CF Access expired cookie loop | Access 期限切れで reload loop または無限失敗 | #206, #208, #222 | `e2e/cf-access-guard.spec.ts`, `src/lib/api-transport.test.ts` | Playwright/unit |
| avatar blocked by CF Access | public avatar API が Access に遮断される | #216 | `src/lib/avatar-url.test.ts`, `src/lib/api-transport.test.ts` | unit |
| app-level JWT/API auth | API auth が CF Access cookie に依存して壊れる | #211, #367, #368, #370 | `src/lib/get-user-email.test.ts`, `src/lib/api-transport.test.ts` | unit |
| common_name email fallback | service token の common_name が email として扱えない | #369 | `src/lib/get-user-email.test.ts` | unit |
| missing secrets cryptic 500 | 必須 secret 未設定が Internal Server Error になる | #311 | `src/lib/config.test.ts`, `src/lib/api-transport.test.ts` | unit |
| team domain empty env | CF Access team domain env 空文字で検証不能 | git: `fix/auth-team-domain-fallback` | `src/lib/config.test.ts`, `src/lib/get-user-email.test.ts` | unit |

## インフラ/CI

| バグ | 症状 | Issue/PR | 回帰テスト | テスト層 |
| --- | --- | --- | --- | --- |
| GitHub Actions deploy path | GitHub Actions から Pages deploy して運用経路が混線 | #245, #279, #319 | `script/verify/no-github-actions-deploy.ts`, `pnpm verify:no-github-actions-deploy` | ops gate |
| regression tests not gating CI | 既存 unit/component regression が PR merge gate に入っていない | #429, #431 | `.github/workflows/ci.yml` `build` job の `pnpm test` | CI |
| Playwright not gating CI | browser regression が PR merge gate に入っていない | #185, #429, #431 | `.github/workflows/ci.yml` `e2e` job の `pnpm test:e2e` | CI/Playwright |
| local CI parity missing test | `task ci` が lint/build 中心で unit test を含まない | #429, #431 | `Taskfile.yml` `ci`, `ci:fast`, `_test` | local CI |
| wrangler OAuth TOML/TTY | migration/deploy workflow が OAuth TOML または non-interactive guard で失敗 | #160, #419 | `pnpm verify:pages-deploy-readiness`, deploy runbook/manual gate | ops gate |
| SLSA unavailable | free org plan で attestation step が失敗 | #380 | `.github/workflows/ci.yml` review + `pnpm verify:no-github-actions-deploy` | CI review |
| production smoke unavailable | CF Access 保護下の production smoke が AI だけで完走できない | #367, #370, #382 | `pnpm verify:prod`, `pnpm verify:prod:browser` | ops/e2e |

## LLM e2e gate procedure

LLM 品質バグ（scene drift、refusal leak、persona drift、画像文脈崩れなど）は deterministic unit test だけでは再現性が不足するため、release 前に `pnpm e2e:long:safe` を 1 tab / cooldown 付きで実行し、失敗時は該当 issue 行に実行ログと seed/scenario を追記する。

## 本番バグ → ガードするテスト（#487 以降のログ）

> `docs/regression-coverage.md` と `doc/regression-coverage.md` が同名で内容が分岐していたため統合した
> （2026-08-05）。以下は元 `docs/` 側のログをそのまま移した節。上の表と issue 番号が一部重なる行
> （#357, #411, #175 など）があるが、記録時期・記述粒度が異なるため機械的な重複排除はせず両方残す。

CI マトリクス（lint / test / build、#433 で導入）が全 PR のマージをゲートする。
下表のテストはすべて `pnpm test`（vitest）で実行され、test ジョブで毎回走る。
新しい本番バグを直したら、修正と同じ PR でガードするテストを足し、この表に1行追加する。

| 本番で起きた不具合 | 原因 | ガードするテスト | 関連 |
|---|---|---|---|
| 画像生成が間欠的に 502 で落ち、リトライもフォールバックもしなかった | Novita init の一時エラー（429 / 5xx）でabort・リトライ・別プロバイダ移行が効いていなかった | `src/lib/image-gen/novita-provider.test.ts`（502 を fallback-eligible と判定）, `src/lib/image-gen/router.test.ts`（auto モードで 429 / 503 時に secondary へ移行） | #496, #532 |
| 画像生成が Cloudflare WAF に 403 で弾かれた | User-Agent なしの fetch が bot ブロック（`error code: 1010`）を受けていた | `src/lib/image-gen/novita-provider.test.ts`（全リクエストに browser UA を付与） | #493 |
| キャラ会話に AI の拒否文・OOC ナレーターが漏れた | 拒否文やペルソナ崩壊を検知してリトライ・モデル昇格する仕組みが無かった | `functions/api/__tests__/refusal-detect.test.ts`（日英の拒否文・空応答・スタール検知）, `functions/api/__tests__/persona-break-detect.test.ts`（謝罪漏れ・過剰同意の検知） | #487 |
| エロ進行中に敬語へ後退し、身体描写が薄い短文返答になった（register-drop） | erotic / climax フェーズで戸惑いに退いた応答を品質ゲートが通していた | `src/lib/quality-guard.test.ts`（erotic / climax で register_drop を fail 判定し、身体感覚のある応答は通す） | #527 |
| 画像のシーン背景が指定と違う構図で生成された | チャット側でシーンが指定済みでも、別のポーズ・背景コンテキストを上書き注入していた | `functions/api/__tests__/image-scene-context.test.ts`（シーン指定済みプロンプトに余計なポーズを注入しない、未指定時のみ多様化） | #491 |
| レート制限が同時リクエストで超過した | 日次・月次コストの予約が atomic でなく、並行リクエストで上限を越えられた | `functions/api/__tests__/request-counter.test.ts`（`atomicReserveRequest` が並行時も日次・月次上限を超えない） | #517, #523 |
| iOS で戻るボタン操作後に PWA が真っ黒になった | レンダリング中の例外が握られず画面全体が白／黒になった | `src/component/error-boundary.test.tsx`（子の throw を fallback でキャッチし真っ黒画面を防ぐ） | #357, #411 |
| CF Access のクッキー期限切れでアプリが固まった | `/api/*` が CF ログイン HTML を返した際に再認証へ進めなかった | `src/lib/api-transport.test.ts`（`cf-access-expired` イベント発火と60秒ループガード）, `e2e/cf-access-guard.spec.ts`（アプリバンドル経由の統合パス） | #175 |

## e2e テストの CI 実行

Playwright の e2e spec（`e2e/*.spec.ts`）は ライブ API シークレットを必要としない。
spec は Vite dev サーバーのみを対象にし、API 依存のステップはアプリがエラー状態のとき
graceful に skip する（`e2e/chat.spec.ts` の冒頭コメント参照）。
`playwright.config.ts` の `webServer` が CI で dev サーバーを自動起動するため、
OpenRouter / Novita などの鍵は不要。

このため CI に e2e ジョブを追加した（`.github/workflows/ci.yml` の `e2e` ジョブ）。
ジョブはオフラインで完結する smoke サブセットだけを走らせ、flaky を避けるため
PR が draft でない場合のみ実行する。

ライブ API を使う重い e2e（`script/e2e/run.ts` 系のシナリオランナーや
`pnpm e2e:long`）は鍵とコストが必要なので CI には載せていない。
これらは手元・本番 verify インフラ（`pnpm verify:prod` 系）で回す。
