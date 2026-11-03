# 局長の GitHub スター調査（キャラクターチャット作り直し向け）

> 回収した過去の資料です。現在の実装指示・承認として使わないでください。
> 現在は全Linearのノンアダルトが対象、character-chat最優先。3D・高度PoCは実装せず、既存HOLDを維持します。API無料枠の数や残高は、この過去記録から推定しません。


調べた日: 2026-10-31（JST）。対象: GitHub アカウント `kouiso`（この Mac で `gh` にログインしとる唯一のアカウント）。

## 0. 結論

- スターは全部で **34 件**（`gh api --paginate user/starred` で全件取得、2 ページ目まで読んだ）。
- キャラクターチャットに効くのは **8 件**（K=8）。9 件目の graphify は「考え方だけ」参考。残り 25 件は無関係（§6 に全部並べた）。
- 8 件は **2026-08-06 の 1 日にまとめてスター** されとる。局長が「見て設計せよ」と言うた束はこれやと見るのが自然（推測。局長に確認はしてへん）。
- 記憶の専用ライブラリ（mem0・letta・zep など）、LangChain/LangGraph 本体、Cloudflare 系、TanStack 系、音声、画像生成のスターは **0 件**。局長のスターは「キャラチャ製品」「チャット画面部品」「キャラの診断」の 3 種類に偏っとる。
- 過去の指示「スターを見て設計せよ」の原文は **見つからんかった**（§7）。今回の 2 つの発言（2026-11-01）だけが根拠。
- 既存の設計（`~/.claude/plans/zero-open-20261025/charchat-rebuild.md`）の骨は変えんでええ。**効くのは 5 点**（§5）。

## 1. 読んだ範囲

- スター 34 件の一覧・スター日・説明・言語・スター数・最終更新・ライセンスを全件取得。
- 関連 K=8 件 + graphify の README を全文読んだ。charachat は追加でソース（`functions/ai/tools.ts` `converse.ts` `package.json`、ファイル一覧）、ai-character-checker は `ai-character-stability/SKILL.md` の冒頭とスキル一覧を読んだ。
- 読んでへん所: assistant-ui の実コード（README の記述だけで判断）。各 repo の issue。Workers で動くかの実機確認（README とファイル構成からの判断。§5 の「要実測」に回した）。

## 2. キャラ会話の製品・エンジン

| repo | 何をするか | スター日 | Workers で動くか | 判定と理由 |
|---|---|---|---|---|
| cr4yfish/charachat（12★、AGPL-3.0、最終更新 2025-12） | キャラ作成・記憶・ストーリー・SillyTavern 等の取り込み。Next.js + 各社 AI SDK | 2026-08-06 | 全体は Next.js + Supabase 前提。部品として使う物ではない | **アイデアだけ借りる**。借りるのは「取り込み口（SillyTavern・Janitor・Wikipedia・AI Character Card）」と「記憶の足し引きを道具として AI に持たせる形」。記憶の中身は **不採用**（理由は下）。AGPL なのでコードは写さん |
| Shaunwei/RealChar（6.2k★、MIT、最終更新 2026-01） | 声で話すキャラ。FastAPI + WebSocket + Chroma + LangChain + Whisper + ElevenLabs | 2026-08-06 | **動かん**（Python、Chroma、ローカル音声処理） | **アイデアだけ借りる**。「音声入力・音声出力・LLM・記憶を差し替え口で分ける」という分け方。v1 では作らん（設計 §4.12 のまま） |
| Anil-matcha/open-character-ai（62★、ライセンス記載なし、最終更新 2026-09） | キャラ作成、会話ごとの温度・最大字数・指示文の調整、Stripe 課金、Next.js + Prisma + Postgres | 2026-08-06 | Vercel 前提。課金・Google ログインは今回の要件外 | **不採用**。借りる点は「会話ごとの調整」だけで、設計は「利用者にモデルを見せん」と決めとる。ライセンスが無いのでコードは写せん |

charachat の記憶の中身を不採用にした理由（ソースで確認）: 記憶は会話ごとの 1 本の文章 `dynamic_book`。足す時は文章に追記、消す時は「この文章からこれを消して全文を返せ」と LLM に書き直させる（`functions/ai/tools.ts` の `removeMemory`）。消すたびに他の記憶まで落ちる危険があり、探す仕組みも無い。うちの設計（1 件ずつ・種類・重要度・置き換え先つき）の方が上。

## 3. チャット画面の部品

| repo | 何をするか | スター日 | Workers で動くか | 判定と理由 |
|---|---|---|---|---|
| assistant-ui/assistant-ui（12.9k★、MIT、最終更新 2026-11-01） | React の AI チャット部品。Thread・Composer・再試行・ストリーミング・自動スクロール・添付。`useLangGraphRuntime` やデータストリーム、独自ランタイムで自前のバックエンドにつなぐ | 2026-08-06 | ブラウザ側の React 部品なので Workers の制約は受けん（README より。TanStack Start 上での実走は未確認） | **採用候補（本命）**。画面の出来合いを自作せんで済む。LangGraph とつなぐ口が README に明記。§5-A |
| huggingface/chat-ui（11k★、Apache-2.0、最終更新 2026-10-30） | HuggingChat 本体。SvelteKit + MongoDB。**OpenAI 互換 API だけ**を `OPENAI_BASE_URL` で話す | 2026-08-06 | SvelteKit + MongoDB なので丸ごとは不可 | **考え方を借りる**。「口は OpenAI 互換 1 本、行き先は URL で替える」。うちの OpenRouter 構成と同じ向き。§5-D |
| chatscope/chat-ui-kit-react（1.8k★、MIT、最終更新 2025-05） | 汎用のチャット画面部品（スクロール・入力欄） | 2026-08-06 | ブラウザ側なので可 | **不採用**。LLM のストリーミングや再試行を持たず、最終更新も 1 年半前。assistant-ui と二重になる |
| alibaba/ChatUI（4.5k★、MIT、最終更新 2026-10） | 会話 UI の設計言語と React 部品（アリババの会話ボット由来） | 2026-08-06 | ブラウザ側なので可 | **不採用**。同じ理由で assistant-ui と二重。1 つに絞る |

## 4. キャラの質を測る・守る

| repo | 何をするか | スター日 | Workers で動くか | 判定と理由 |
|---|---|---|---|---|
| gpsnmeajp/ai-character-checker（6★、CC0、最終更新 2026-04） | AI にやらせるキャラ設定の診断スキル 20 本。崩れやすさ・ユーザーとの衝突予測・ロールプレイ負荷・安定キャラの作り方。日本語・日本の創作文化前提 | 2026-08-06 | 実行時には使わん（Claude に読ませる SKILL.md の集まり） | **採用（試験と取り込み検査に使う）**。CC0 なので文面を借りてよい。作者自身が「再現性は保証せん」と明記しとるので、**合否の根拠ではなく目安**として使う。§5-C |
| Graphify-Labs/graphify（140k★、最終更新 2026 年） | コードや資料を知識グラフにして辿れるようにする開発用ツール。各辺に `EXTRACTED`（原文にある）/`INFERRED`（推し量った）の印 | 2026-08-16 | 開発ツールで実行時に使わん | **考え方だけ**。辺に「原文か推測か」の印を付ける発想は記憶 1 件ずつに使える。§5-E |

## 5. 設計に効く物

`charchat-rebuild.md` は変えとらん。以下はそこへの差分の提案で、各項目に「持ち主の層」を付けた。code-design の見方で、既にある仕組みを先に使い、一つしか実装が無い抽象は作らんことを前提にしとる。

| # | 提案 | 根拠の repo | 持ち主の層 | 変える所（設計の章） |
|---|---|---|---|---|
| A | 画面の会話部品は **assistant-ui を使い、自作せん**。SSE を受ける独自ランタイム（またはデータストリーム）で DO につなぐ。「送る予定時刻つきの塊」は画面側が予定時刻まで表示を保留する | assistant-ui | 画面層（TanStack Start の route と部品）。engine は画面部品を知らん | §4.1 の「ブラウザ」の中身、§4.4、PBI-13（RIT-55） |
| B | キャラの形は **うち独自の 1 形式に統一**し、SillyTavern・Janitor・Wikipedia・AI Character Card は **取り込み口（アダプタ）だけ** で変換する。元の JSON は R2 に原本として残す。保存は常に内部形式 | charachat | 境界層（`character-import`）。内部の持ち主は D1 の `character` と engine の persona 読み込み | §4.6 データの形、PBI の取り込み系 |
| C | キャラ診断を **2 か所だけ** に使う。(1) 取り込み・保存時の検査（崩れやすい設定の警告。保存は止めず警告だけ）、(2) 試験 §4.11 に「キャラ崩れ」の目を足す（ステレオタイプへの転落、迎合、執着、局長の発言で設定が壊れる）。毎ターンの経路には足さん（既存の品質判定 judge の採点基準に文面を借りるのは可） | ai-character-checker | 試験層（`evals/`）と取り込み口。実行時の持ち主は既存の judge ノード | §4.11、judge の採点基準 |
| D | 生成の口は **OpenAI 互換 1 本** に固定。モデルの替えは URL とモデル名の設定だけ。各社専用のアダプタは作らん（charachat は各社 SDK を 6 本抱えとる、その反面教師） | chat-ui、charachat | engine の LLM の口（1 実装）。AI Gateway・OpenRouter は設定側 | §4.7 モデルの選び分け |
| E | `memory_item` に **`origin`（`stated` = 局長が言うた / `inferred` = AI が推した）** を足す。`inferred` は検索の点数を下げ、「言うてへんことを前に言うたやろ」試験で乗らん根拠にする。記憶の足し引きを AI の道具にするのは **v1 では作らん**（書き手は Queue の抜き出し 1 本のまま。画面の「覚えといて」ボタンも同じ書き込み口を呼ぶ） | graphify、charachat | 記憶層（engine の memory 書き込み口が唯一の書き手。不変条件「書き手は 1 つ、消す時は D1・Vectorize・要約の 3 か所」を守る） | §4.3、§4.11 |

各提案の最後にある「わざと抽象化せんかった物」:
- 取り込みアダプタは、最初は SillyTavern 形式 1 本だけ作る。2 本目が要る時に共通の口を切り出す（3 回目まで待つ）。
- 音声・画像・per-chat の温度調整は作らん。RealChar 式の差し替え口は、音声を入れると決まった時に初めて切る。
- charachat 式の「AI が自分の記憶を書き換える道具」は、Queue 抜き出しで足りんと実測で分かった時に再検討。

要実測（確信を持てへん所）:
1. assistant-ui を TanStack Start + Workers 上で SSE の独自ランタイムとして動かし、「予定時刻つきの塊」を出せるか（README にあるのはデータストリームと LangGraph ランタイムまで）。
2. ai-character-checker の診断が DeepSeek 系で再現するか（作者は Claude Opus 4.6 で確認と書いとる）。

## 6. 残り 25 件（無関係）

| repo | 判定 |
|---|---|
| multica-ai/andrej-karpathy-skills | Claude Code 用の CLAUDE.md 例。製品設計に無関係 |
| bradautomates/claude-video | 動画を Claude に見せる開発ツール。無関係 |
| SakanaAI/AI-Scientist | 自動研究。無関係 |
| OpenHands/OpenHands | 開発用エージェント。無関係 |
| hana652/tech-writing-pack | 日本語の技術文書の AI 臭除去。文章用で製品に無関係 |
| kouiso/task-app, kagura-project/musashipaint, k-ishiwata/Workdock, devaslanphp/project-management, t-oak/Leafer | 自分の別件・タスク管理系。無関係 |
| engineers-hub-ltd-in-house-project/slack-claude-code-integration, freee/freee-mcp | MCP 連携。無関係 |
| The-Japan-DataScientist-Society/100knocks-preprocess, sudheerj/javascript-interview-questions, type-challenges/type-challenges | 学習教材。無関係 |
| madefor/postal-code-api, ProNextJS/forms-management-yt, HamedBahram/next-rhf, shimabukuromeg/nestjs-prisma-gcp-terraform, stuyy/google-nestjs-oauth2, yoshi-pi/nestjs-lesson, ixartz/Next-js-Boilerplate, abuanwar072/Flutter-Responsive-Admin-Panel-or-Dashboard, abhishek305/js-window-postmessage, rottitime/react-hook-window-message-event | Next.js・NestJS・Flutter・フォームの学習用。TanStack Start 採用の設計と無関係 |

数え: 無関係 25 + 関連 9（読んだ README 9 本）= 34。

## 7. 過去の指示の探索結果

局長原文（2026-11-01）: 「キャラクターチャットはragやロングチェーン、ロンググラフ、それだけではなく僕のGitHubのスターにしてるリポジトリも見て最適な設計で作る必要があります。以前伝えたはずなんだけどな」「GitHubは僕のアカウントでつけてるスターとか、これに限らず綺麗な設計で作って欲しい」

探した所と結果:
- 会話記録 `~/.claude*/projects` 13 か所の jsonl（grep）と `~/bin/session-db search`（「スター」「starred」ほか数語）: キャラクターチャット + GitHub スターの組は **ヒット 0**（「テスター」「スタート」ばかり）。
- Notion 検索（「キャラクターチャット GitHub スター 設計」）: 該当なし。
- Linear「スター」検索: RIT-30（競合 4 アプリの調査）などが出たが、スターの話は無し（本文は先頭しか読んどらん）。
- 未探索: Slack、Devin のセッション全文、claude.ai のチャット履歴、局長が口頭・別端末で言うた分。

よって「以前の指示」は **記録上は確認できず**。ただしスターの束（§0）と局長の今回の発言は整合する。

## 8. 確信度

- スター 34 件の数と一覧: 100%（API 全件、2 ページ）。
- 「関連は 8 件」の分類: 90%。README と説明文での判断。局長が別の理由で目を付けたスター（例: graphify、AI-Scientist）があれば変わる。
- §5 の提案の効き: 70%。A と C は実測が要る（§5 の要実測）。B・D・E は設計上の判断で、コードを書いて確かめてはおらん。
- 100 にするには: assistant-ui の実走確認、ai-character-checker の DeepSeek 再現確認、局長に「この 8 件が見てほしかった束か」の一言。
