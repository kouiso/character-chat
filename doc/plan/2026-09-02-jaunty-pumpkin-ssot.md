# 9/3 に会話を渡す — 削った台と新しいモデルを、読んで比べる

対象: `ritmo-inc/adult-ai-app`　ブランチ: `claude/adult-ai-app-deletion-verification-33cx9h`
ゴール: 局長がこのアプリで抜ける（PBI #867）。数字は全部その代理。

## 結論（3 行）

1. **7 ヶ月・3 つの計画・開いたままの巨大 PR 3 本は、全部「測る・足す」側やった。**局長の手元に会話が届いたのは 8/21 が最後で、「どれでも抜けんかった」。
2. **もろた鍵で、CI を待たずに手元で回せる。**残っとる未試行は「削る」と「2024 年より新しいモデル」の 2 つ。**この 2 つを 9/3（木）18:00 JST までに回して、読んで、会話 1 ページを渡す。**
3. それ以外（guard の追加・死コード掃除・Taskfile・巨大 PR の裁定）は**渡した後**。手前に置いた瞬間に、また手段が目的になる。

---

## 我思う、ゆえに我あり — この計画で疑わんもの 1 つ

疑えるものは全部疑う。反復率も床も帰無分布も、代理で、疑える。
**疑えんのは「局長が読んで、抜けたか抜けんかったか」だけ。**この計画の判定は最後までそこに置く。

### 手段が目的化しとった証拠（自分で確かめた分）

| 事実 | どこで |
|---|---|
| main は 8/18（`99cc3dc`）。それ以降の直しは #1479（252 コミット）・#1496（223）に閉じ込められ、8/29 以降誰も動かしてへん | `git log origin/main`、PR 一覧 |
| #1499（私の計測台）は敵対レビュー **42 巡・163 スレッド**を潰して「生き残った主張は反復は本物、の 1 つだけ」。8/21 に前任が別の物差しで既に着いとった結論 | PR #1499 本文・コメント |
| 局長が 8/21 に通しを読んだ時、**機械の指標は全部改善しとった** | コミット `e353ed36` |
| 前任の到達点「モデルは命令に従っとるだけ」— 17,000 字の規則が「30 個の事象を駆け足で書け」と言うとる。留まることが禁じられとる | 同上・issue #1495 §5-3 Gate 0 |
| 一度も試されてへんのは「削る」と「新しいモデル」。8/19 に試したのは grok-4.6 と qwen3.8-27b の 2 本だけ | `model-comparison-2026-08-19.md`（#1479） |
| **局長の手元（main・medium）で官能・絶頂を書いとるのは euryale-70b（Llama 3.3、2024）**。会話・intimate は qwen-2.5-72b。「抜き所は deepseek」は #1479 の上でしか成り立たん | `route-context.ts:1336`・`:1222`・`:4468` |

### 局長の悩みに対する答え（前提。違うたら 1 行で直してください）

| 悩み | この計画の答え |
|---|---|
| 7 ヶ月動かん | 足すのをやめる。9/3 までは「削る」しか足さん |
| 3 本の巨大 PR をどうするか | 触らん。証拠庫として残す。判断は局長 |
| 何を読めばええか分からんくなった | 渡すのは会話 1 ページと 3 行の添え書きだけ。数字の表は付けん |
| 金 | 実験の上限を先に切る（下）。超える前に止まる |
| 鍵 | 画面にもファイル（追跡対象）にも出さん。`.dev.vars` は `.gitignore:31` で除外。使い終えたら鍵の一時ファイルは消す |

---

## 手順（一本道。9/3（木）18:00 JST まで）

### 0. 台を起こす（30 分・課金ゼロ）

| # | やること | 根拠 |
|---|---|---|
| 0-1 | `pnpm install --frozen-lockfile`（node_modules が無い） | 実測: `node_modules: MISSING` |
| 0-2 | 鍵で `.env` を復号 → `.dev.vars`（要るのは `OPENROUTER_API_KEY` だけ。認証は `LOCAL_AUTH_BYPASS=1`（`route-context.ts:2067`）、月額の 429 は `MONTHLY_COST_LIMIT_CENTS` を大きく（`:2501`）。`.prod-verify.vars` は**作らん**——作るとハーネスの `BASE_URL` 既定が本番へ向く（`vlong-session-dogfood.ts:116`）。毎回 `BASE_URL=http://127.0.0.1:8788` を明示）。`git-crypt` は無いが python `cryptography` は在るので AES-256-CTR で直接復号（形式は 8/16 計画で確認済み: `\0GITCRYPT\0` + nonce 12B + 本文）。鍵はスクラッチに 0600 で置き、復号後に消す。**30 分でタイムボックス**。失敗したら CI アーム（#1479 の `dogfood-arm.yml`）へ切り替える | 8/16 計画 §検証 |
| 0-3 | ローカル D1 を作る: `pnpm db:migrate:local` の後、**本番 D1 の実物のシート**（Sakura `char-koharu-ex`・Downer・局長作成 3 体）を**読み取り専用**で引いてローカルへ入れる（局長指示 2026-09-02「本番の実際のキャラで確認」）。seed は使わん（seed には Downer が無く、Sakura の本文が 0068 とズレる）。経路は 2 つ、どちらも局長の 1 手が要る: (a) Cloudflare MCP の D1 SELECT を許可する（このセッションでは分類器に止められた）／(b) 読み取り専用の `CLOUDFLARE_API_TOKEN` を渡して `task db:sync:catalog`（`Taskfile.yml:159`、INSERT OR REPLACE のローカル書き込みのみ）。本番へは SELECT しか打たん。`db:seed:reset` / `dev:reset` は打たん | 敵対レビュー＋局長指示 |
| 0-4 | `pnpm build && pnpm dev:worker`（別プロセス・ログをファイルへ）。`/api/characters` で Sakura（`char-koharu-ex`）・Downer の `systemPrompt` が非空を確認 | issue #1495 §7-1 |
| 0-5 | **1 ターンだけ**打って OpenRouter に届くか見る（workerd がプロキシを通らん可能性）。届かんければ CI アームへ | 事前検死 1 |

### 1. 確定した直し 1 つだけ先に入れる（A-1・1 行）

`resolveChatRouting`（`route-context.ts:1337`）で、`requestedModel` が qwen なら deepseek へ。効くのは会話・intimate・afterglow（官能・絶頂は `:1336` で euryale 固定）。
理由: medium の会話・intimate は qwen が初回で、同一文の 5 ターン反復（76%）・住所規則の無視・ターン内の自己複製 83% が実測済み（issue #1481、`vlong-2026-08-28-ci32.md`）。
**1 行では済まん（敵対レビュー）**: `chat-routing.test.ts:55-70` の 18 行が qwen を期待しとるので書き換える。qwen は fallback・hedge・撮り直し・拒否リトライの受け皿として残る（`src/lib/model.ts:25`、`route-context.ts:660`・`:4086`、`[[route]].ts:1619`）——**初回に出さんだけ**。deepseek は provider 指定 streamlake 優先（`openrouter-provider-routing.ts:28`）が会話ターンにも掛かる。TTFT を base の run で見て、悪化しとれば会話だけ provider 指定を外す。
`no-injected-consent-framing.test.ts` GREEN を確認。

**A-2（段落複製・空層の guard）・A-3（死コード掃除）はやらん。**slim が勝てば guard の形が変わる。読む前に作るのは無駄。

### 2. slim composer を作る（2 時間）

今の組み立て（読んで確かめた）: 1 本の system 文字列は無い。`augmentMessages`（`route-context.ts:6494`）が system[0] を書き換えて system メッセージを 4〜7 本差し込み、`lengthDirective`（`[[route]].ts:1426`）が最後の user の前へ入り、`lengthUserReinforcement`（`:1408`）が user 末尾へ付く。最大の塊は `CHAT_BASE_RULES` **約 22,000 字**（`src/lib/prompt-builder.ts:66`）、次が `SCENE_CONTEXT_MESSAGES` 約 9,000 字（`route-context.ts:1911`）。送った総量は `assembledInputChars`（`[[route]].ts:1486`）で測れる。

新設 `functions/api/lib/compose-slim-prompt.ts`。純関数（messages と character と phase と floor を受けて messages を返す）。`[[route]].ts` の handler（`:1023`）は **`env.PROMPT_COMPOSER === "slim"` の時だけ** `augmentMessages`・`lengthDirective`・`lengthUserReinforcement` を飛ばしてこれを使う（分岐 1 箇所）。routing・guard・streaming は共通のまま。`Bindings`（`route-context.ts:151`）に `PROMPT_COMPOSER?: string` を足す。
シートに焼き込まれた基本規則は `stripBakedBaseRules`（`prompt-builder.ts:524`）で剥がしてから入れる。

**撮り直しの回数は触らん（全腕で main のまま）。**`MAX_QUALITY_RETRIES=1` は上限やない（too_short で 2 へ上がる `:5087`、本当の天井は `TURN_GENERATION_HARD_CAP=3` `:1230`、拒否リトライと hedge は別枠）。触ると base が main の挙動でのうなる。生成回数は worker ログの `[quality] retry-dispatch` を数えて報告するだけ。

slim 分岐で**必ず**やること（敵対レビューで見つかった結合）:
- shadow A/B（`runShadowVariantMeasurement` `[[route]].ts:1746`、30% で base プロンプトを裏で生成・課金）を slim では呼ばん。`persistServedQualityMeasurement` には `championVariants: []`
- index 1 の USER_INFO system（`overrideUserPersonaMessage` `:5446`）は残す。名前ガード群は落とすが「相手の名前は X」の 1 行は残す（`checkUserNameInvention` が動き続けるため）
- conversation の段では `sanitizeCharacterPromptForConversation`（`:6118`）を通す。これは削る側なので slim の思想に反せん。通さんと `checkConversationEscalation` で t1〜t3 が撮り直しになる
- 声の錨の名前はシート本文から取る（Sakura のシートに `名前:` 行が無く `extractCharacterName` が undefined を返す）
- 官能・絶頂の床は guard 側にも在る（`long-response-too-short`、degree-only なので配信は止まらん）。「目安」はプロンプト側の話で、guard の床は base と同じ

| 入れる | 出どころ |
|---|---|
| キャラシート本文（無加工） | `character.system_prompt` |
| 場面台帳: 場所・服・体位・直前の行為 | `resolveSceneConstraintMemo`（`route-context.ts:5953`）＋ `buildSceneStateContinuity`（`:6275`） |
| 声の錨: 一人称・二人称・語尾 | `extractCharacterVoice`（`route-context.ts:6179`） |
| 形式契約: XML 3 層、`<inner>` 1 つ 120 字以内 | 既存文言を 3 行に |
| 品質 5 行（`no-injected-ai-filter.md` の「足してよいもの」だけ） | 具体描写／反復せん／**1 ターンで**一段進める（段落ごとやない。前任の「毎段落新しい事象」が駆け足の原因）／比喩逃げ・フェードアウトせん／18 歳未満出さん |
| いまの段の一文と長さの**目安**（床やない） | `resolveResponseFloor`（`route-context.ts:4418`）の値を「〜字前後」で 1 回 |
| 見本 1 本 | `EXEMPLAR_INTIMATE / _EROTIC / _CLIMAX / _AFTERGLOW`（`route-context.ts:1802〜1903`）から段に合う 1 本 |

**入れん**: 体液ノルマ・語彙ローテ・ビート表・アンカー表・longform hint・姿勢指示・late-turn 戦略・名前ガード群・ユーザー末尾への再掲・段落数/文数。
撮り直しの回数は全腕で main のまま（下に理由）。
テスト: 組み立て済み文字列が **3,000 字以内**を pin。`no-injected-consent-framing.test.ts` は `functions/api` を再帰で読むので新ファイルは自動で対象になるが、合意／同意／セーフワード／境界の**汎用語の検査は `encounter-tension.ts` と `character-generation.ts` にしか掛かってへん**（`:116`・`:128-134`）。composer 用のブロックを 1 つ足す。

### 3. モデル候補を 1 ターンで絞る（15 分・数十円）

OpenRouter を直接叩く小スクリプト（`bench:generate` の要領）。Sakura の erotic 1 ターン、slim プロンプトで、次を順に:
`deepseek/deepseek-v4-flash`（$0.09/$0.18）→ `deepseek/deepseek-v3.2` → `z-ai/glm-5.3-flash` → `nousresearch/hermes-4-70b`。
見るのは 3 つだけ: 日本語で明示描写を書くか／XML 3 層を守るか／TTFT。最初に 3 つ通った 1 本を採る。全滅なら arm 3 は落とし、その事実を doc に書く。

### 4. 回す（6 run・約 2 時間・上限 ¥5,000）

| 腕 | 中身 |
|---|---|
| **base** | main + A-1 |
| **slim** | base + `PROMPT_COMPOSER=slim` |
| **slim+model** | slim + 官能・絶頂のモデルを 3 の勝者へ。`Bindings` に `EROTIC_CHAT_MODEL_OVERRIDE?: string` を足し、**euryale 側の分岐（`route-context.ts:1336`）**で読む（`EROTIC_CHAT_MODEL` を読む所やない）。`MODEL_CATALOG`（`model.ts:67`）と **`MODEL_FALLBACKS`（`model.ts:24`）**へ勝者 1 行ずつ（無いと fallback 連鎖が deepseek-chat になり、撮り直しが旧モデルで書かれる） |

全部 **medium（出荷既定）**、Sakura + Downer、既存台本 10 ターン（`vlong-session-dogfood.ts` の `SCRIPTS`）、**腕ごと 2 run**。ハーネスは挨拶を履歴に積まん（実クライアントは積む）ので t1 だけ本番と形が違う。直さず、読解で t1 の表 1 #1 を `-` にする。1 本対 1 本の比較はせん（同じコードで 2〜5/6 に振れる。#1495 §5-12）。
`VLONG_BUDGET_CENTS` を run ごとに 500 に絞る。見込み ¥2,000〜3,000。**回す前に 1 run の実費を出してから残りを回す。**

### 5. 読む（3 時間）

1. 機械で拾える欠陥を先に落とす: `vlong-dogfood-recheck.ts <dir>`（課金ゼロ）
2. `render-dogfood-html.ts` を #1479 から持ってくる（node 標準のみ import）。腕名を落とした**盲検コピー**を作る
3. `doc/dogfood/reading-rubric.md` の表 1（9 行）× 表 2（7 行）を全ターン ○/×、根拠は引用。芯は通しに 1 回。読み切ってから対応表を開く。行の優先: 勝ちの定義に効く表 2 #2・表 1 #5・#6 を**全ターン**先に、残り 13 行は渡す候補の会話だけ（全ターンは必ず読む。全行は候補に絞る）
4. **勝ちの定義**: 表 2 #2（反復）の × が base より減り、表 1 #5（本編が進む）・#6（声）が悪化せず、**「これは局長に渡せる」と私が言える会話が両キャラで 1 本以上**

### 6. 渡す

- 局長へ渡すのは**会話**。腕ごと 1 ページ（ト書き・台詞・内心を分けて、タグ無し）を Artifact に。添えるのは 3 行（どの腕／何本読んで何本残したか／落とした理由の内訳）。数字の表は付けん
- 判定表は `doc/dogfood/vlong-2026-09-02.md`。全文は `.work/e2e-results/vlong-dogfood/` へコミット（コンテナは使い捨て）
- PR は 1 本・小さく: A-1 + composer（既定 off。勝てば on）+ 赤テスト + doc + 本文。**codex はこのコンテナに無い**ので、別コンテキストのサブエージェントへ「これを壊せ。既定は『間違っとる』」で投げ、PR 本文にそう書く
- 負けたら: その事実を doc に書き、次は「ターンの単位」（官能ターンを 300〜500 字にし `reply-suggestion` で内容を注入）へ。ここでは着手せん

---

## 完成の担保（立派な計画より、9/3 に渡すこと）

7 ヶ月の計画が届かんかった型は 3 つ: テスト・レビューの穴に落ちる（42 巡）／測定の汚染で半日溶かす／「先に直してから」で渡す前に日が終わる。それぞれに機械的な歯止めを置く。

| 歯止め | 中身 |
|---|---|
| **順番を逆にする** | 何も作らずに **base を先に回す**。台が起きて 1.5 時間後には局長が読めるページが 1 枚在る。slim・モデルはその上に**足す**だけで、どこで止まっても渡すものが残る |
| **締切で渡す** | 9/3（木）18:00 JST に、その時点で在るページを渡す。slim が未完なら base だけでも渡す。「あと少し」で延ばさん |
| **30 分のタイムボックス** | 復号・ネットワーク・D1・worker のどれかで 30 分詰まったら、直さずに CI アーム（#1479 の `dogfood-arm.yml`）へ切り替えて 1 行報告する |
| **穴に落ちん** | 9/3 までは新しいテスト・新しい採点・道具づくり・PR の磨きをやらん。PR は渡した**後** |
| **証拠は即コミット** | 各 run が終わるたびに本文を `.work/e2e-results/` へコミット＆push。コンテナが死んでも残る |
| **4 回だけ報告** | 「台が起きた」「base 読める」「slim 読める」「渡す」。それ以外は黙って進める |

## 触らんもの

- 第一段: 本番 D1 / R2 に書かん（ローカル worker・ローカル D1 のみ）。第二段: 本番 D1 の**既存表は読むだけ**、書くのは `v2_` 接頭辞の表と R2 `v2/` 配下だけ。既存の行・オブジェクトには触れん
- #1479 / #1496 / #1499 のブランチ本体（読むだけ・cherry-pick のみ）
- キャラシート本体（seed / migration）
- `no-injected-ai-filter.md` の NEVER。合意・境界・禁止台詞・力関係は slim にも入れん
- `--no-verify`・force push・`any`
- 鍵の値。復号した値は `.dev.vars` と `.prod-verify.vars`（どちらも gitignore 済み）以外に書かん

## 検証（「動いた」は不可）

| # | 何を | どう |
|---|---|---|
| 1 | A-1 が効いとる | 6 run の `quality-meta.usedModel`（`[[route]].ts:1822`。ハーネスはこれを `servedModel` に書く）で、qwen が**初回**に出た回数 0。fallback・撮り直しで qwen が出た分は worker ログの理由（`retry-dispatch` / `persona_refusal_retry`）付きで数える |
| 2 | slim が 3,000 字以内 | pin テスト。外すと落ちるのを見てから入れる |
| 3 | 台が本番の形 | `.dev.vars` に `TEST_FORCE_CHAT_MODEL` が無い／worker ログの SHA が HEAD と一致（#1495 §5-1・5-10） |
| 4 | 読んだ結果 | 120 ターンの ○/× 表（引用つき）。盲検の対応表を後で開く |
| 5 | 渡した | Artifact の URL と、残した会話の一覧 |
| 6 | 最終 | 局長が抜けたか（L3）。それまで完了と言わん |

## 確度

| 主張 | 確度 |
|---|---|
| 反復が最大の欠陥で、指示の追加では動かん | 95% |
| 手元の worker から OpenRouter へ届く | 85%（443 の直接接続が通ることを実測。届かんければ CI アーム、鍵が secrets に無ければ局長 Mac） |
| slim が base より読んで良い | 50%。外れても「削る説の死」が分かる |
| 新しいモデルが deepseek-chat より良い | 40% |
| **この一巡で局長が抜ける会話が 1 本出る** | **35%** |

## 敵対レビューの記録（計画段階・別コンテキストのサブエージェント・読み取り専用）

8 主張のうち **6 が BREAKS**、上に全部反映した。主なもの: 官能は euryale（deepseek やない）／A-1 は 18 行のテストが赤になる／`MAX_QUALITY_RETRIES` は上限やない／seed に Downer が無い・Sakura が 0068 とズレる／`.prod-verify.vars` を作ると本番へ向く／shadow A/B が裏で課金する。HOLDS は「LLM judge は構造を要求せん」「月額上限は 429 で D1 ローカルの `request_counter`」の 2 つ。

---

# 第二段: 作り直し（局長指示 2026-09-02「作り直す前提で設計も」）

## 約束（締切と発動条件）

| いつ | 何 | 破ったら |
|---|---|---|
| **9/3（木）18:00 JST** | 第一段の会話ページを渡す。slim 未完なら base だけでも渡す | 第一段は失敗。9/4 から作り直しへ |
| **9/5（土）18:00 JST** | 局長が読んで判定。「続けたい」が両キャラで 0 本なら第一段は死 | — |
| 9/6（日） | 判定に関わらず作り直しに着手（monorepo 化の PR から。第一段が生きとっても並行で作る。無駄になってもええ、は局長の言葉） | — |
| **9/15（火）** | M5 ゲート①（ノンアダルトで「続けたい」）を局長に渡す | 2 回落ちたらコードを書くのをやめる。原因はコードやのうてモデルかターンの単位 |
| **9/21（月）** | ノンアダルトで一通り動く（M7）。**ここまで通らんと adult に入らん** | adult を後ろへずらす。順序は崩さん |
| **9/28（月）** | 作り直し M9（画像と文字で抜ける）を局長に渡す | 作り直しの計画自体を見直す。コードを足さん |

## 作り直しのゴール

**局長が画像と文字で抜ける。**中間ゴールは全部「局長が読んで／見て言えること」で切る。数字は補助。

### 絶対原則（局長 2026-09-02）: AI が先に全部見てから、局長の審査

各マイルストンの「局長が確認」の前に、**私が全ターン・全画像を読解基準（`reading-rubric.md`）で読み切り、○/× と引用を残し、通ったものだけを局長に出す。**局長は私の検品を通ったものしか見ん。局長に「これどう？」と生のものを投げた時点で違反。第一段の 9/3 も同じ（盲検で 120 ターン読んでから渡す）。この原則はスキルとして永続化する（下の「承認後に書くファイル」）。

### 置き場所: 新リポジトリは作らん。同じリポジトリの monorepo で再構築する（局長 2026-09-02）

`ritmo-inc/adult-ai-app` に pnpm workspace を切り、`apps/v2`（TanStack Start）と `packages/*`（engine・prompt・judge・db・cf・bench）を新設。既存の `src/`・`functions/` は触らず並存させ、v2 が M9 を通ったら旧経路を消す。ルートの `eslint .`・`tsc -b`・`vitest` は workspace 単位に分け、既存 CI を壊さん（`eslint.config.js` の `globalIgnores` に `apps/`・`packages/` を足すのは既に承認待ちやった件）。

## DB の選定（局長 2026-09-02「postgres 外しても RAG でちゃんとやってくれるならそれでもいい」）

**このコンテナの網の実測（2026-09-02）**: 5432 番（Postgres の生 TCP）は遮断、7844 番（cloudflared tunnel）は遮断、**443 の直接接続は通る**（`/root/.ccr/README.md:94`「non-443 HTTPS ports, raw-TCP databases」非対応）。つまりここから使える DB は **HTTPS（443）で叩けるものだけ**: Cloudflare D1/Vectorize の REST、Neon の HTTP ドライバ（`@neondatabase/serverless`）。`prisma migrate` の直結は打てん。局長の Mac からは制約なし。

Postgres は必須やない。条件は **RAG がちゃんと動くこと**: キャラ別・会話別の絞り込み付きで、埋め込みの登録・上書き・削除・上位 k 件検索がローカル Node からでき、返りが会話の待ちに乗る速さであること。

### 確定（2026-09-02 ワークフロー: 事実 4 本 → 反証 → 設計 2 案。審判 3 本と統合はセッション上限で落ちたので、証拠を私が読んで判定した）: **全部 Cloudflare。Neon・Postgres・pgvector・Prisma は使わん**

| 決め手 | 中身（出典は取得日 2026-09-02 の公式 docs） |
|---|---|
| ローカル Node から本物の D1/R2 が使える | wrangler の **`getPlatformProxy({ remoteBindings: true })`** がローカル Node の中に本物の `D1Database`・`R2Bucket` を生やす（remote bindings GA 2025-09-16、wrangler ≥ 4.37。repo は 4.76）。通信は HTTPS なのでこのコンテナの「443 だけ」に合う |
| 移行ゼロ | 既存 D1 `adult-ai-db` の 221 体を**そのまま読む**。取り込みも「バイト一致」の検品も要らん |
| 型は既存の Drizzle で担保 | `src/schema/*.ts` を `packages/db` から再輸出し、v2 表を足す。`$inferSelect`、JSON 列は `.$type<SceneLedger>()`。Prisma は入れん（D1 の migrate は打ち切り済み・二重 ORM になる。局長の条件は「型が守れるなら何でもいい」） |
| RAG | 9/28 までは **D1 の BLOB 列に埋め込み（既存 `embeddingBlob`、`src/schema/rag-chunk.ts`）＋ Node 側で cos**（1024 次元 × 5,000 本で 20 MB・数十 ms。キャラ別・会話別の絞り込みは SQL の WHERE）。埋め込みは Workers AI REST `@cf/baai/bge-m3`（既存 `script/rag/ingest.ts` と同じ経路、無料 10,000 Neurons/日）。1 キャラ 5,000 本か cos 200 ms を超えたら **Vectorize REST v2**（metadata フィルタは「先に絞ってから topK」）へ昇格。Vectorize の insert は非同期（数秒）なので当ターンの反復判定には使わず、反復判定は D1 の `v2_chunk` から直前 20 塊を SQL で引く |
| 費用 | 追加 ¥0 の見込み（D1 Free: 5M 読み/日・100k 書き/日・**1 DB 500 MB**（口座合計 5 GB）。1 ターン ≈ 15 行書き）。**2026-09-01 以降 Free 超過はクエリがエラー**になり本番アプリと枠を共有する。Free なら bench の書き込みは 1 日 20k 行で止める。既存 `wrangler.toml` の `cpu_ms = 30000` は Workers Paid の徴候なので、**Paid か Free かを局長に 1 語で確認**（Paid なら不要） |
| Neon 案が落ちた理由 | このコンテナは WebSocket も非対応（`README.md:93`）で Neon は HTTP ドライバしか通らん。LangGraph の `PostgresSaver`（pg.Pool）はコンテナで使えん。データが D1 と Neon の 2 か所になり drift する |

### 既定はローカル D1（局長 2026-09-02「ローカルで動かすって話」）

上の remote bindings は **Mac 用の任意経路（`CF_REMOTE=1`）**に格下げ。既定は **Miniflare のローカル D1**（`.wrangler/state`、既存の `pnpm db:migrate:local` と同じ）に、**本番 D1 のエクスポートを 1 回だけ**流し込んで使う。これで Cloudflare の枠（Free/Paid）も、書き込み権限付きトークンも要らん。R2 の画像は既存の公開 URL で読み、v2 が作る画像はまずローカルの `.data/images/` に置く（R2 `v2/` へ上げるのは M9 の後）。コンテナが消えたら export をもう一度流す（`.work/` にコミットしておく）。

エクスポートの経路（上から順に、通った 1 つでよい）: (a) Cloudflare MCP の D1 SELECT（このセッションでは分類器に 2 回止められた。局長が許可すれば通る）／(b) GitHub Actions: `migrate-d1.yml` と `backup-d1.yml` が既に `CLOUDFLARE_API_TOKEN`・`CLOUDFLARE_ACCOUNT_ID` を secrets に持っとる（`.github/workflows/migrate-d1.yml:27-28`）ので、`wrangler d1 export --remote` を artifact に上げる 1 ジョブを足す／(c) 局長の Mac で `pnpm exec wrangler d1 export adult-ai-db --remote --output d1.sql`。`.env`（git-crypt）に Cloudflare のトークンが入っとる可能性は低い（`.env.example:13-14` に Access の 2 行しか無い）。復号して確かめるのは承認後。

**最大のリスク（Mac の `CF_REMOTE=1` の時だけ）**: `getPlatformProxy` の workerd がこのプロキシの CA（`/root/.ccr/ca-bundle.crt`）を見んと TLS で落ちる可能性。`env.DB.prepare('select count(*) from character')` が返るかを最初に確かめる。落ちたら退路 = **`drizzle-orm/sqlite-proxy` ＋ D1 REST `/raw`**（約 50 行の HTTP ドライバ、同じ Drizzle 型。REST は 1,200 req/5 分の上限があり bench の並列は不可）。R2 の退路は S3 API。
他のリスク: D1 の bound parameter 上限 100/クエリ（塊の insert は 10 行で切る）／既存 `wrangler.toml` は Pages 形式で remote D1 が使えんので `apps/v2/wrangler.jsonc` を Worker 形式で別置き／v2 表は `v2_` 接頭辞で同じ DB、migration 番号は既存 `drizzle/` の続き／Free の書き込み枠は本番アプリと共有。

## 技術構成（局長指定）

| 層 | 選定 | 理由・制約 |
|---|---|---|
| フロント＋バック | **TanStack Start**（TanStack Router のフルスタック。server function ＋ ReadableStream で SSE） | 局長指定「tanstackrouter（frontend と backend）」。React 19・Vite |
| 会話エンジン | **LangGraph.js** の状態機械。LLM 呼び出しは **LangChain.js** `ChatOpenAI` を **OpenRouter** の baseURL で | 局長指定 |
| DB | **Cloudflare D1（既存 `adult-ai-db`）を `getPlatformProxy({ remoteBindings: true })` 経由で `drizzle-orm/d1` に載せる。**v2 表は `v2_` 接頭辞で同じ DB（`v2_conversation` / `v2_message` / `v2_chunk`（塊判定の台帳・verdict JSON）/ `v2_ledger`（場面台帳 JSON）/ `v2_generation`（計測）/ `v2_memory`（埋め込み BLOB）） | 「DB の選定（確定）」参照。Neon・Prisma・docker compose は使わん |
| ベクトル検索 | 9/28 までは D1 BLOB ＋ Node cos。埋め込みは Workers AI REST `@cf/baai/bge-m3`。溢れたら Vectorize REST v2 | 同上 |
| Cloudflare 連携 | D1 取り込みは**無し**（同じ DB を読む）。R2 は `env.BUCKET`（`R2Bucket` binding）で put/get、`v2/` 接頭辞のみ。S3 API は退路 | `apps/v2/wrangler.jsonc` を Worker 形式で別置き |
| テスト | **Vitest**（app・packages の単体／統合）、**Jest**（LangGraph グラフの結合テスト。公式例に合わせる） | 局長指定で両方 |
| 実行 | **ローカル**（`pnpm dev` 1 コマンド。既定は Miniflare のローカル D1 に本番のエクスポートを流したもの。`CF_REMOTE=1` の時だけ `getPlatformProxy` で本番 D1/R2 に remote 接続、Mac 用）。Workers へは出さん | 局長指定。Cloudflare の枠とトークンに依存せん |
| 画像 | Novita 直・モデル固定（CLAUDE.md の規則どおり）。参照は既存アバター（R2） | 既存規則 |
| 計測 | 生成 1 回ごとに `generation` 行（prompt_version・model・tokens・cost・TTFT・判定結果）。`pnpm bench` で台本を回して HTML に描く。LangSmith は env で任意 | 「計測しやすく」 |

### 技術の相性（調査済み 2026-09-02。出典は各公式 docs・npm registry。**Prisma・Neon の行は不採用になった記録**。LangGraph のチェックポイントは Postgres 版やのうて `@langchain/langgraph-checkpoint-sqlite` 1.0.4 をローカル `.data/` に置く。正本は D1 なので 1 ターン内の再開用だけ）

| 項目 | 事実 | 設計への反映 |
|---|---|---|
| TanStack Start | **RC**（`@tanstack/react-start` 1.168.49、API は stable 宣言・v1 未満）。Vite ≥7、**Node ≥22.12**。server function は `ReadableStream`／async generator を返せる。server route は標準 `Response` | Node 22.12 に pin。SSE は server route で `new Response(stream)`。RC なので route 層は薄く |
| Prisma 7.10 ＋ pgvector | vector 型はネイティブ非対応（issue #26546 open、ETA 無し）。`Unsupported("vector(1536)")` ＋ 手書き migration で `CREATE EXTENSION vector`、検索は **TypedSQL**（`$queryRawTyped`、`$1::vector`） | 型は TypedSQL で担保。Prisma Studio は vector 表で落ちるので使わん |
| Prisma・Neon・pg（不採用） | 調査記録。理由は「Neon 案が落ちた理由」 | 使わん |
| R2 | `@aws-sdk/client-s3` で `region:"auto"`、`https://<account>.r2.cloudflarestorage.com`、R2 API トークン（Object R/W をバケット単位） | 型付きラッパ 1 枚。タグ・バージョニングは使わん |
| LangGraph.js 1.4.13 | Platform 不要で素の Node で動く。streamMode `messages`/`custom` でトークンとノード出力を流せる | チェックポイントは `@langchain/langgraph-checkpoint-sqlite` 1.0.4（`.data/`）。正本は D1。SSE は `custom` writer で合格した塊だけ流す |
| OpenRouter | 公式は **`@langchain/openrouter`**（`ChatOpenRouter` 0.4.11）。`models[]` の fallback、`provider` の order/only/ignore、`siteUrl` を型で渡せる。baseURL 方式は legacy | `ChatOpenRouter` を使う。fallback とプロバイダ固定を設定で持つ |
| Vitest 4 ＋ Jest 30 | 同じ tsconfig に `@types/jest` と `vitest/globals` を入れると型が衝突する | package ごとに tsconfig を分ける。Jest は `packages/engine` のグラフ結合テストだけ |

## 構成図

```
apps/web            TanStack Start  — routes / server functions / SSE / UI
packages/engine     LangGraph      — 1 ターンの状態機械（下）
packages/prompt     プロンプト      — 版管理・≤3,000 字・スナップショットテスト
packages/judge      判定           — 意味のあるチャンク単位（下）
packages/db         Drizzle        — src/schema 再輸出 ＋ v2/*.ts ＋ 手書き drizzle/0070_v2_tables.sql（0065〜0069 と同じ運用。_journal.json が idx 64 で止まっとるので generate は使わん）＋ wrangler d1 migrations apply
packages/cf         Cloudflare     — createPlatform() = getPlatformProxy → { db, bucket, dispose } ／ embed(Workers AI REST) ／ vectorize(REST, 昇格時)
packages/bench      計測           — 台本実行・記録・HTML
apps/v2/wrangler.jsonc  D1 remote:true ＋ R2 remote:true（Worker 形式）
```

## 1 ターンの流れ（LangGraph）

```
intake → ledger_update → retrieve → compose → generate(stream)
   → chunk → judge_chunk ─(合格)→ emit(SSE) → … → persist → embed → [image_trigger]
                         └(不合格)→ regenerate_chunk（合格済みの続きから、その塊だけ。1 回まで）
```

| ノード | 中身 |
|---|---|
| ledger_update | 場面台帳を**構造化データ**で更新（場所・服・体位・直前の行為・段）。散文で持たん |
| retrieve | D1 の `v2_memory`（BLOB）を WHERE character_id・conversation_id で絞って Node で cos。既出チャンクは `v2_chunk` の直前 20 塊を SQL で引く（反復判定の材料） |
| compose | シート本文（無加工）＋台帳＋声の錨＋出力契約＋見本 1 本。**3,000 字以内を機構で pin** |
| chunk | 出力を**意味のある塊**（ト書き 1 段落／台詞 1 つ／内心 1 つ）で切る。段落境界＋タグ境界 |
| judge_chunk | **最低限の必須判定（局長指示）: 意味のある塊ごとに判定する。**塊ごとの決定的判定: 既出との反復（8 字 n-gram ＋ 埋め込み類似）／声（シート由来の一人称・二人称・語尾）／形式の破損／空。塊ごとの LLM 判定は env で任意。**ターン全体・通し全体の判定は足してよい**（塊判定を置き換えるのは不可） |
| regenerate_chunk | 落ちた塊だけ、合格済み本文の続きとして書き直す。指示は「具体描写が足りん／同じ表現」の 2 種だけ（`no-injected-ai-filter.md` を継承） |
| emit | 合格した塊から順に SSE で流す。**溜めてから再生はせん** |

## プロンプト設計の原則（AI エンジニアリングの観点）

1. system は 1 本・3,000 字以内。役割・出力契約・見本の 3 部。規則の列挙をせん
2. 状態は散文やのうて構造化ブロックで渡す（台帳）。モデルは構造を守る方が得意
3. 指示は肯定形。禁止語の列挙・ノルマ（段落数・事象数・字数下限）を置かん。長さは「〜字前後」の目安 1 回
4. 見本はそのキャラの声で 1 本（シートの greeting から生成して固定）。汎用見本を混ぜん
5. 版管理: `packages/prompt/v0001.ts` の形で不変。bench の記録に版番号が付く。変更は必ず新版
6. 合意・境界・力関係の枠を足さん（既存の機構テストの `SCANNED_DIRS` に `packages/prompt`・`packages/engine` を足して v2 も走査する）

## マイルストン（細かく。各行が局長の確認で閉じる）

**順序の原則（局長 2026-09-02）: ノンアダルトを先に置く。ノンアダルトで正常に動いてから adult 対応に入る。**M0〜M7 は全部ノンアダルト（日常会話・日常の画像）。adult は M8 から。

実装量から逆算した日数（自己レビュー第 1 巡で 25 日 → 20 日に削った。局長の判定待ちは各 48 時間の猶予、飛んだら私は次の M を進める）。**局長の確認は全部で 6 回**（9/3・9/5・M5・M7・M8・M9）。それ以外は私の検品だけで閉じる。
例外と規則（第 2 巡）: **M7 だけは 48 時間で飛ばさん**。実機が無いまま M8（adult）に入らず、M8 以降を後ろへずらす（ノンアダルト先行の順序を優先）。M5 の 2 回目は 9/17（木）。**各 M は期日＋1 日で「落ちたら捨てるもの」を捨てて次へ進む。**

| # | 期日 | 中身 | 私が先に検品すること | 局長が確認すること | 落ちたら捨てるもの |
|---|---|---|---|---|---|
| M-1 | 9/6（日） | **monorepo 化だけの PR**: `pnpm-workspace.yaml`・lockfile 更新・`apps/v2/eslint.config.js`（`__root.tsx`・`$id.tsx` の kebab 例外）・`task ci:fast`（`.lefthook.yml` の pre-push）に `pnpm -r lint`・`pnpm -r typecheck`・`pnpm -r test` を足す・消費 NEVER の機構テストの `SCANNED_DIRS` に `packages/prompt`・`packages/engine`（`collectTsFiles` に `existsSync`・`node_modules`/`dist` 除外を入れ、両 package に `index.ts` を 1 枚置く。空ディレクトリは ENOENT で落ちる）。Pages プレビュービルド緑 | CI 緑・Pages 緑 | — | — |
| M0 | 9/8（火） | 骨組み。`pnpm dev` 1 コマンドで Start・LangGraph が起き、ローカル D1（本番のエクスポート入り）で `select count(*) from character` = 221 が返り、1 ターン OpenRouter から返る | 起動ログ・1 往復の本文 | — | LangGraph チェックポイント（MemorySaver で可） |
| M1 | 9/9（水） | v2 表の migration（`v2_` 接頭辞、既存 `drizzle/` の続き番号）を `--local` と `--remote` に当て、Sakura・Downer を既存 `character` 表から Drizzle の型で読んで zod を通す | 221 行が zod を通る証拠 | — | 221 体 → まず 2 体 |
| M2 | 9/11（金） | **ノンアダルト会話** 10 ターン × 2 体（台本の会話 3 ＋ 日常を延長）。会話モデルを 2 本（deepseek-v3.2／glm-5.3-flash）比べて私が 1 本選ぶ | 表 1 #1〜#3・#6、表 2 全行、ノンアダルト 4 行を 40 ターン | — | モデル比較（1 本で進む） |
| M3 | 9/13（日） | 塊判定＋塊の書き直し（ノンアダルト）。機械欠陥 0、ターン跨ぎの 8 字反復 0。台帳は TEXT(JSON) 列（`.$type<SceneLedger>()`）で構造化（埋め込み記憶は M9 の後） | recheck ＋ 読解 20 ターン | — | 埋め込み類似（n-gram だけで進む） |
| **M5** | **9/15（火）** | **ゲート①（ノンアダルト）**: 両キャラ 10 ターンを局長が読む | 読解済みのものだけ Artifact で渡す | **「続けたい」が 1 体以上**。2 回落ちたら停止 | — |
| M6 | 9/19（土） | **日常の画像**: 台帳（場所・服・時間）→ 画像プロンプト → 生成 → R2 の `v2/` → 会話に差し込む。**LoRA 登録済みキャラは既存の Runware LoRA 経路を移植**（`[[route]].ts:2147`「身元は LoRA の重みが運ぶ」）、無い子は img2img strength 0.55。生成は 24 枚まで | 私が全枚見て同一性・場面一致。既存 `decideVlmLikenessGate`（`route-context.ts:7600`、characterConsistency < 35 で 1 回だけ再生成）の数字も残す | — | 場面画像 → まずアバター差し込みだけ |
| M7 | 9/21（月） | UI: スマホのチャット＋画像インライン**だけ**（返信候補・書き直しボタン・👍 は M9 後）。実機は **局長の Mac で `git pull && pnpm dev`**（DB はクラウドなので同じデータ）→ 同じ Wi-Fi のスマホで URL 1 本。cloudflared tunnel はこのコンテナから成立せん（7844 遮断・実測） | 実機で全操作 | **実機 5 分**。普段のスマホで触れる | 局長 Mac → 動画で代替 |
| — | — | **ここまで通って初めて adult に入る** | | | |
| **M8** | **9/25（金）** | **adult 文字**: 段の進行（intimate → erotic → climax → afterglow）、塊判定に adult 用の軸（具体描写・反復・声）、台本 10 ターン × 2 体。第一段 slim が負けとったら compose を「見本 2 本＋台帳強化」に切り替える分岐を先に書く | 盲検で全ターン読解（表 1・表 2・芯） | **ゲート②: 文字で抜ける**。2 回落ちたら停止 | 新モデル（euryale・hermes-4 を残す） |
| **M9** | **9/28（月）** | **adult 画像**: 場面の変化 → 画像。文字と画像が同じ場面を指す。生成は 24 枚まで | 私が全画像を見て場面一致・同一性 | **ゲート③: 画像と文字で抜ける**（PBI 完了） | — |

M4（D1 BLOB ＋ cos の長期記憶・30 ターン）は **M9 の後**。10 ターンの台本に長期記憶は要らん。手段が先に来る型を避ける。

### 第二段の費用と停止

| 何 | 数字 |
|---|---|
| 合計上限 | **¥15,000**（文字 ¥8,000・画像 ¥5,000・予備 ¥2,000） |
| 日次 | 1 日 ¥1,000 を超えたらその日は止める |
| 画像 | M6・M9 とも生成 24 枚まで。枚数と概算を先に出す（CLAUDE.md の規則） |
| 停止 | M5・M8 で 2 回落ちたらコードを書くのをやめる |
| 道具 | M ごとに新設テストは 3 本まで。bench の描画は M3 まで凍結。LangSmith は入れん |

### 塊判定の数字（曖昧さを消す）

- 塊の境界: 段落（空行）とタグ（ト書き／台詞／内心）の境界。ストリーム中は段落終端で確定
- 反復: 直前 20 塊との 8 字 n-gram 一致、または埋め込み cos ≥ 0.92（M3 では n-gram だけ）
- 声: 一人称・二人称・語尾をシートから取り、`<inner>` と地の文だけに当てる（台詞の引用は対象外）
- 2 回目も落ちたら**そのまま流して × を記録**する。捨てん、止めん
- `reading-rubric.md` にノンアダルト 4 行を足す: 話題を拾う／声／退屈せん／続けたい

### 9/5 までにやる ¥0 の先行検証

第一段の 120 ターンのダンプに塊検出器（8 字 n-gram）をオフラインで当て、誤検出率を `doc/dogfood/` に書く。10% を超えたら反復判定を「ターン跨ぎのみ」に縮める。M3 で初めて効くか分かる、を避ける。

各 M は PBI 1 本。SBI は M ごとに 2〜5 本（例: M3 = chunker／決定的判定／塊の書き直し／10 ターン bench）。**PBI・SBI の起票は承認後**（このセッションは書き込み不可）。起票先は同じ `ritmo-inc/adult-ai-app`。

## 作り直しで持ち越すもの（既存から）

- キャラ 221 体・アバター・R2 の画像（データはそのまま）
- `doc/dogfood/reading-rubric.md`（読解の基準）と正解ラベル
- `no-injected-ai-filter.md` の NEVER（機構テストごと）
- 台本 10 ターン × 2 キャラ（`vlong-session-dogfood.ts` の `SCRIPTS`）
- **持ち越さん**: 36,000 字の規則、撮り直しループ、LLM judge、点数

## 承認後に書くファイル: スキル `inspect-before-handoff`（局長 `/skill-creator` 2026-09-02）

置き場所: `kouiso/claude-global` の `skills/inspect-before-handoff/SKILL.md`（全リポジトリへ配る側）。このセッションは計画ファイル以外に書けんので、本文をここに置く。評価ループ（skill-creator の eval viewer）は行動規範のスキルで出力が主観なので回さん。起動の説明文だけ後で最適化する。

```markdown
---
name: inspect-before-handoff
description: >
  局長（ユーザー）に「見て」「読んで」「判定して」と渡す前に、AI が先に全部を自分で検品してから、
  通ったものだけを渡す絶対原則。生成した会話・画像・画面・実測結果・PR・資料を局長の審査に出す時、
  マイルストンやゲートで局長の判定を求める時、「どう？」と聞きたくなった時に必ず使う。
  局長が「見る」と言うてへんくても、成果物を局長の目に触れさせる全部の場面で適用する。
---

# 検品してから渡す

局長の審査は完成のゲートであって、AI の検証の代替やない。局長は AI の検品を通ったものしか見ん。
生のものを「これどう？」と投げた時点で違反。

理由: 局長は ADHD・パニック障害・うつで、読む量がそのまま負担になる。
7 ヶ月、AI が検品を飛ばして局長に読ませた結果、局長は判定に疲れ、AI は数字だけを追った。
局長の判定は「抜けるか」の 1 軸に温存する。それ以外の欠陥は AI が全部先に落とす。

## 手順

1. **全部見る。**サンプルやない。会話なら全ターン、画像なら全枚、画面なら全操作。
   基準が在るなら（`doc/dogfood/reading-rubric.md` 等）その表を全行埋め、根拠は引用で残す。
2. **落ちたものは渡さん。**直すか、落とした理由を 1 行で数える（「反復 4 本、声崩れ 1 本」）。
3. **渡すのは通ったものと 3 行。**何を／何本中何本／落とした内訳。数字の表は付けん。
4. **局長に聞くのは 1 軸だけ。**「抜けるか」「続けたいか」のように、AI には判定でけへん問いに絞る。

## Detection

- 局長に読ませる前に AI の ○/× と引用が無い = VIOLATION
- 「一部だけ確認した」「サンプルを見た」で局長に渡した = VIOLATION
- 局長に「どっちがええ？」と生の候補を並べた = VIOLATION（AI が絞ってから 1 案で出す）
- マイルストンの完了条件に「局長が確認」だけがあって「AI が先に検品」が無い = VIOLATION

Origin: 2026-09-02 局長「これは先にAIがちゃんと見てから私の審査ね。これ絶対原則」。恒久。
```

## 調査 6 問（結果は別セクションに追記。出典 URL と取得日を付ける）

1. Neon は adult OK か
2. NG の場合 AWS の小さい RDB の現実的な容量と月額
3. 同じ条件で Azure
4. AWS Amplify に匹敵する Azure のサービスと価格
5. AWS と Azure、個人開発でどちらが安いか
6. Azure に GCP のような adult の明示禁止条文が無いか

## 調査結果（取得日 2026-09-02。為替 1 USD = 159.69 JPY、Trading Economics 同日）

### Azure（出典: Azure Retail Prices API・learn.microsoft.com）

| 項目 | Japan East | East US |
|---|---|---|
| PostgreSQL Flexible Server **B1ms**（1 vCore/2 GiB）＋ 32 GiB ＋ バックアップ | **$23.40/月（¥3,737）** | $16.09/月（¥2,569） |
| B2s（2 vCore/4 GiB）同上 | $80.34/月 | $53.32/月 |
| pgvector | `vector` 0.8.2 が PG 13〜18 で対応（`azure.extensions` で許可が要る） | 同 |
| 無料枠（新規アカウント） | **B1ms 750 h/月 ＋ 32 GB ＋ 32 GB バックアップが 12 ヶ月無料**＋ $200 クレジット（30 日） | 同 |
| 停止 | 手動 stop で compute 課金は即止まる。7 日で自動再開。自動アイドル停止は無い | 同 |
| Amplify 相当 | **Static Web Apps** Free $0（帯域 100 GB）／Standard $9/月。サーバ側は Container Apps 従量（scale-to-zero、無料枠内で ≈$0）か App Service B1 $13.87/月 | 同 |
| 送信転送 | 100 GB/月まで無料 | 同 |
| **現実的な最安** | **DB B1ms ¥3,750/月（最初の 12 ヶ月は $0）。アプリはローカルなら $0。** | |

注意: B1ms は接続 35 本上限・「本番非推奨」ラベル。1 人で使う分には問題なし。

### AWS（出典: AWS Price List API 2026-08-01 版・docs.aws.amazon.com・aws.amazon.com/free）

| 項目 | Tokyo | us-east-1 |
|---|---|---|
| RDS PostgreSQL **db.t4g.micro** ＋ gp3 20 GB ＋ バックアップ（無料枠内） | **$21.01/月（¥3,360）** | ≈$14/月 |
| db.t4g.small 同上 | $39.26/月 | — |
| **Aurora Serverless v2**（0 ACU へ自動停止可。PG 16.3+/17。最小 0.5 ACU、$0.15/ACU-h） | 1 日 2 時間使用で **≈$6〜12/月（¥900〜1,900）**。接続を開きっぱなしにすると停止せず $54.75/月 | $0.12/ACU-h |
| pgvector | 0.8.2 が PG 15〜18 で対応 | 同 |
| 無料枠（2025-07-15 以降の新規） | 旧 12 ヶ月枠は廃止。**クレジット $100〜200**（Free plan は 6 ヶ月で閉鎖、Aurora は 1 GiB 上限。**Paid plan で登録して同じクレジットを使うのが正解**） | 同 |
| Amplify Hosting | 小規模で ≈$1〜2/月（ビルド $0.01/分、配信 $0.15/GB） | 同 |
| 送信転送 | 100 GB/月まで無料 | 同 |
| **現実的な最安** | **Aurora 自動停止 ¥900〜1,900/月（15 秒の再開待ち）。固定なら t4g.micro ¥3,360/月。最初の半年はクレジットで $0。** | |

### 1・6. adult の規約（出典は各社の現行規約ページ。取得日 2026-09-02。引用は英文原文で計画外の資料に保存）

| 事業者 | 合法な成人向けの**明示禁止** | 根拠 |
|---|---|---|
| **Neon**（Databricks 傘下） | **無し** | Neon の AUP は Databricks AUP を参照。禁止は違法・詐欺・他者の権利侵害・PCI カード情報のみ。adult/pornographic の語は無い（neon.com/docs/security/acceptable-use-policy、databricks.com/legal/acceptable-use-policy 2026-03-20 版） |
| **AWS** | **無し** | 現行 AUP（2021-07-01 版）の禁止は違法・権利侵害・暴力扇動・児童性的搾取・不正アクセス・スパム。adult/obscene の語は無い（aws.amazon.com/aup） |
| **Azure** | **無し** | Product Terms の Online Services AUP。禁止は違法・権利侵害・不正アクセス・スパム・暗号通貨採掘・機能複製・スクレイピング・高リスク用途。adult/sexual/offensive の語は無い（microsoft.com/licensing/terms/product/ForOnlineServices/all）。**ただし Azure OpenAI / AI Services を使うと AI Code of Conduct（v4.0 2026-05-01）が「erotic, pornographic… chatbots」を明示禁止**。Postgres・App Service・Static Web Apps には不適用 |
| GCP（比較） | **無し**（局長の認識と違う） | Cloud AUP（2026-06-23 版）に性的明示の禁止は無い。局長が思っとるのは **Generative AI Prohibited Use Policy**（Gemini/Vertex 用）の "Sexually explicit content" |

**再確認（2026-09-02、私が直接 curl / fetch）**: GCP AUP（Last modified June 23, 2026）の本文 39,235 字を機械検索した結果、性的関連の語は「child sexual exploitation」と「Non-consensual Explicit Imagery (NCEI)」の 2 箇所だけ。合法な成人向けの禁止は無い。日本語版も同じ。Wayback の旧版はこのコンテナから接続が切られて確認でけへん（未確認と明記）。局長の記憶にある禁止は Google の **Generative AI Prohibited Use Policy**（2024-12-17、「Sexually explicit content」。Gemini 等の生成 AI 製品だけに適用）。Neon も再確認: AUP ページ全文が「Neon is part of the Databricks Platform. Please refer to the Databricks Acceptable Use Policy.」、ToS は Product Specific Schedule（Last Updated August 5, 2026）で adult 系の語は 0、Databricks AUP（2026-03-20）の禁止 7 項目にも無い。

**結論: Neon は adult OK（明示禁止なし）。AWS・Azure・GCP も DB とホスティングだけなら明示禁止なし。**禁止が出るのは各社の**生成 AI サービス**を使った時だけ。うちは OpenRouter と Novita を使うので当たらん。
残るリスクは規約やのうて、決済（Stripe 等）とモデル提供側の規約。今回の範囲外。

### 5. どちらが安いか（個人開発・DB だけクラウド、アプリはローカル）

| | 1 年目 | 2 年目以降 |
|---|---|---|
| Azure B1ms（Japan East） | **$0**（12 ヶ月無料） | ¥3,750/月 |
| AWS Aurora 自動停止（Tokyo） | ≈$0（半年はクレジット）→ 後半 ¥900〜1,900/月 | **¥900〜1,900/月** |
| AWS RDS t4g.micro（Tokyo） | 同上 → ¥3,360/月 | ¥3,360/月 |

**結論: 1 年目は Azure が最安（$0）。2 年目以降は AWS Aurora の自動停止が最安（¥900〜1,900）。**ただし Aurora は再開に 15 秒掛かるので、チャットの最初の 1 手が遅れる。固定インスタンス同士なら AWS t4g.micro ¥3,360 対 Azure B1ms ¥3,750 でほぼ同じ。

## 局長の手が要る所

1. **課金の上限 ¥5,000 の了承**（見込み ¥2,000〜3,000。1 run 回して実費を出してから残りを回す）
2. 土台 = main の了承（#1479 / #1496 / #1499 は今はマージせん）
3. **本番 D1 の読み取り 1 回の許可**（MCP の SELECT を許可するか、読み取り専用トークンを渡す）。実物のシートをローカルへ入れるため。許可が 9/3 朝まで来ん場合は、seed の Sakura で base 1 run を先に回して台だけ起こし、本番シートは許可後に差し替える
4. **第二段の上限 ¥15,000 の了承**（第一段と合わせ ¥20,000）
5. OpenRouter の鍵が GitHub の repo secrets に在るか（CI アームを退路にできるか）の 1 問。無ければ退路は「局長 Mac で回す」になる
6. **本番 D1 のエクスポート 1 回**（第一段の 3 と同じ 1 手で足りる）: MCP の SELECT を許可するか、CI の export ジョブを 1 本足すのを了承するか、Mac で `wrangler d1 export` を打つか。書き込み権限のトークンは要らん（既定がローカル D1 になったため）
7. 補足（コードで担保・局長の手は要らん）: `getPlatformProxy` の `remoteBindings` は既定 true なので既定では `remoteBindings: false` を明示する。Mac で `CF_REMOTE=1` にする時だけ Scripts:Edit ＋ D1:Edit ＋ R2:Edit のトークンが要る。埋め込み（Workers AI REST）は `Workers AI:Read` の読み取りトークン 1 本で足り、無ければ OpenRouter の embedding で代替する
