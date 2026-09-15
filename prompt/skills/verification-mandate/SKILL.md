---
name: verification-mandate
description: "Verification Mandate (Project-Specific)"
---
---
---

# Verification Mandate (Project-Specific)

グローバル共通ルール（Playwright 禁止言い訳、False Completion、Zero User Burden 等）は `~/.claude/rules/autonomous-verification.md` と `~/.claude/rules/god-in-details.md` を参照。本ファイルは **adult-ai-app 固有** の検証要件のみ定義する。

## 1. 変更種別ごとの必須 Playwright アクション

| 変更対象 | 最小アクション |
|---------|--------------|
| React/HTML/CSS コンポーネント | `take_screenshot` + `browser_snapshot` |
| route / navigation | navigate → `take_screenshot` |
| modal / dialog / form | UI trigger → `take_screenshot` |
| animation / 視覚遷移 | before/after `take_screenshot` |
| button / link / interactive | `browser_click` + `take_screenshot` |

## 2. Desktop App（Tauri/Electron）検証手順

webview レイヤは Playwright で検証可能。「Tauri は Playwright 不可」は FALSE。

```
1. dev server 起動（isBackground=true, §Prohibition 8.1 参照）
2. ポート応答まで wait（browser_wait_for）
3. browser_navigate http://localhost:PORT
4. take_screenshot + browser_snapshot
5. interaction ごとに screenshot
```

## 3. タスク種別ごとの最小検証

| タスク | 最小検証 |
|-------|---------|
| Backend API 変更 | `curl` or `mcp__postgres__query` でデータ確認 |
| Frontend component | Playwright screenshot |
| Full page/screen | Full page screenshot |
| Form submission | fill → submit → success state screenshot |
| CSS/styling | before/after screenshot |
| Auth/login flow | navigate → fill → redirect 確認 |
| Navigation/routing | 影響ルート全てに navigate |
