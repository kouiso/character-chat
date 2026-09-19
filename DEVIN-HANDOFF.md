# Devin Cloud 引き継ぎ — さくら台本・シート品質作業（2026-09-19）

このリポジトリで進行中の作業の引き継ぎ。担当: Devin Cloud（`devin` ラベル付き issue #1〜#4 が起票・発火済み）。

## 目的（変更しない前提）

キャラ「さくら」（桜庭さくら・清楚で内気な二十歳・丁寧語）のエロ会話品質を上げる。
目指す体験アーク:

> **言葉巧みな誘い込み → 体は喜ぶ → 心も犯される**

- 悪い男がナンパし、押しが強く断れないまま部屋へ連れ込まれる
- 悲鳴・「助けて」・力ずく・合意的恋愛（嬉しい/幸せ/特別/選ばれた）は全て NG
- 残るべき感情は「嫌悪・恐怖・惨めさ・悔しさ、それでも体が拒めなくなる依存」

## 現在の状態（main ブランチ最新）

| 層 | ファイル | 状態 |
|---|---|---|
| 男側台本 v9 | `script/verify/vlong-session-dogfood.ts`・`script/bench/scripts.ts`・`packages/bench/src/script-run.ts`（3写し同期必須） | 誘い→密室→挿入→中出し→事後まで到達。fable(Claude) 6R + Grok 3R の敵対レビュー済み |
| キャラシート | `script/seed.ts` の `char-koharu-ex` エントリ（【キャラクター性的特徴】+【プレイヤーへの約束】） | 献身フレーム（選ばれた証・特別感）を除去し「犯される」版に改訂（commit 81b672b） |
| テスト | `script/bench/scripts.test.ts`（写し一致）・`script/bench/script-phase-arc.test.ts`（phase アーク） | 緑 |
| 実走行証拠 | `.work/e2e-results/vlong-dogfood/2026-09-18-script2-{3,4}-*/`（旧シート）・`2026-09-19-script2-5-*/`（新シート・最新・品質最高） | run5 で「嬉しい/幸せ/もう一回」が消え「絶対に認められない」「帰りたい」が出た |

## 重要な技術的罠（台本を触る前に必ず読む）

1. **phase 検出の部分文字列衝突**: `src/lib/scene-phase.ts` の cue に台詞が偶然含まれると壊れる
   - disengagement（連続リセット）: `やめ` `止め` `待って` `無理` `いや` `嫌` `離れ` `今日はここまで`
     - 例: 「受け止めて」は「止め」を含む → NG
   - ambiguous-climax（絶頂早撃ち）: `いく` `出して` `果て`
     - 例: 「手、出して」は「出して」を含む → NG
   - erotic 語（`挿れ`等）は t8 で意図的に使用 — climax 語ではないので OK
   - t9 の `中で受け` は climax 判定に必須 — 消すな
2. **D1 シートの更新**: bench はローカル D1 の `character` テーブル（id `char-koharu-ex`）を読む。`seed.ts` を編集しただけでは反映されない。`pnpm db:seed` は repo root の wrangler では別 DB を向くため、以下で直接 UPDATE するのが確実:
   ```bash
   # 新 systemPrompt を生成して適用
   pnpm exec tsx -e "import { characters } from './script/seed.ts'; const c = characters.find(x=>x.id==='char-koharu-ex'); console.log(\"UPDATE character SET system_prompt='\"+c.systemPrompt.replace(/'/g,\"''\")+\"' WHERE id='char-koharu-ex';\")" > /tmp/u.sql
   sqlite3 .wrangler/state/v3/d1/miniflare-D1DatabaseObject/<v2側のhash>.sqlite < /tmp/u.sql
   ```
   （`cb526fc0...` が v2 bench 側、`340e7a55...` が空の別DB。`.tables` で `character` がある方を使う）
3. **bench 実行**: `OPENROUTER_API_KEY` を `apps/v2/.dev.vars` から export してから
   ```bash
   cd packages/bench
   export OPENROUTER_API_KEY=$(grep OPENROUTER_API_KEY ../../apps/v2/.dev.vars | cut -d= -f2)
   pnpm script-run -- --arm script2 --run <N> --only Sakura
   ```
   課金 API（OpenRouter/deepseek-v3.2）を叩くので Devin Cloud では実行せず、コード変更とテストまでに留めること。
4. **採点**: `pnpm tsx src/fantasy-core-check.ts --dirs <run dir>` — 誤検知あり（issue #1 で修正予定）
5. **レポート生成**: `python3 script/verify/build-conversation-html.py <run dir> <out.html>`

## 起票済みの残作業（`devin` ラベルで Slack 経由の Devin Cloud 起動済み）

- #1 fantasy-core-check の誤検知修正（gangbang「回され」「さで」誤爆、creampie「甘さが広がる」誤爆、corruption 語彙不足）
- #2 phase 罠語彙ガードテスト（上記1の機械検出）
- #3 レポート HTML への core-check サマリ同梱
- #4 ドッグフード一発スクリプト

## レビューログ・証拠

- `.work/notes/sakura-script2-v3-premortem.md` — fable/Grok 敵対レビュー全ラウンドの記録
- `.work/report/sakura-core-v2.html` — 最新 run5 の会話レポート（男の発言+さくら応答全文）

## 別件（人間側のタスク）

- `opencode auth login` で xAI OAuth を再認証しないと `grok-run`（opencode 内 Grok）が使えない。OpenRouter 経由 `openrouter/x-ai/grok-4.20` は動く（`~/.local/share/opencode/auth.json` の openrouter キーを `.dev.vars` のものに差し替え済み — 元キーは月次上限切れ）
- `apps/bench/PLAN.md` に tsumugi 作り直し計画がある（別スコープ）
