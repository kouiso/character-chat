---
description: Onboard a new character — generate avatar + greeting + system_prompt + image_meta, apply to D1, deploy, Slack notify.
---

# /onboard-char <char_id>

新キャラ 1 体を **avatar 生成 → image_meta 抽出 → in-character greeting + system_prompt rewrite → D1 UPDATE → build → Cloudflare Pages deploy → Slack 通知** まで一気通貫で onboard する。

## 前提
- `<char_id>` の行が既に D1 に存在 (UI 作成 or seed import 済)。greeting/system_prompt が generic でも OK、image_meta は NULL でも OK。
- wrangler が auth 済 (`pnpm exec wrangler whoami` で確認)。expired なら `wrangler login` を先に促す。

## 実行手順 (Claude が逐次実行)

1. **引数チェック**: `<char_id>` 未指定なら usage 表示で停止。
2. **wrangler auth 確認**: `pnpm exec wrangler whoami` を実行、失敗時は user に `wrangler login` を促してから continue 確認。
3. **pipeline 起動**: `scripts/onboard-char.sh <char_id>` を **`run_in_background: true`** で起動 (内部で codex bg + SQL apply + build + deploy)。
4. **CronCreate で監視** (30 分間隔): codex log と SQL ファイルの進捗をチェック。SQL ができた瞬間に apply → deploy → Slack 通知の chain が script 内で自動進む。
5. **完了時**: deploy URL を取得して `mcp__claude_ai_Slack__slack_send_message` で `<@kosuke isogai>` に通知:
   ```
   【完了報告】onboard <char_id> prod デプロイ完了
   URL: https://adult-ai-chat.pages.dev/
   確認: avatar / greeting / system_prompt / chat 画像一致
   ```
6. **失敗時** (codex/build/deploy いずれか): tail 全文を Slack で通知 + 介入提案。

## Codex spec
`scripts/onboard-char.sh` 内で自動生成。ユメミ (`import-charap-ユメミ`) を gold standard reference に固定。

## 必須プロトコル
- **工程①局長チェック（v2・正本: `prompt/instructions/char-approval-process.md`）**: image_meta / greeting / system_prompt は自己レビューだけで完結させず、**必ず局長チェックに提出**してから工程②（プロフィール画像）へ進む。image_meta は以降の全画像生成のアンカーであり、NULL のまま画像工程へ進むこと禁止。プロフ文に違和感があれば審査中に修正フェーズを挟む。キャラの方向性で迷ったら局長に質問してよい。
- Self-review 100/100 (greeting が template でない / system_prompt が in-character / image_meta JSON が parse)
- 検証ソース tag: `[Vision-Check]` または `[Novita-Attempt-N]`
- script の最後に必ず deploy URL を pane に出して Claude が Slack 投げる
