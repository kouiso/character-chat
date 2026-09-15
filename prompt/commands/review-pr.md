---
description: ECCのreviewer系を前提に、adult-ai-app固有のPRレビュー観点だけを追加する。
---

# /review-pr - adult-ai-app PR review addendum

本コマンドは ECC の `code-reviewer` / `security-reviewer` を前提とし、ここでは `adult-ai-app` 固有の差分だけを定義する。

## 必須確認

1. PR に紐づく Issue、設計メモ、`doc/` 配下の仕様があれば先に確認し、差分が要件から外れていないことを確かめる。
2. 変更がこの repo の技術スタックに与える影響を確認する。
   - React 19 + Zustand + Dexie
   - Hono + Cloudflare Pages Functions
   - OpenRouter / Novita の API 呼び出し
   - chat streaming、XML parser、image generation flow
3. 変更のスコープが PR の目的を超えていないことを確認する。ついでの整理、広すぎるリファクタ、目的外のフォーマット差分は指摘対象。

## repo 固有レビュー観点

- Hono の API 変更には `zValidator` または同等の入力検証があること。
- 機密情報は `c.env` または Cloudflare secrets からのみ参照し、frontend bundle やログに流れないこと。
- OpenRouter / Novita に渡す入力と戻り値が、現行 UI・chat state・parser の期待と一致していること。
- chat streaming の変更で、途中エラー時の表示崩れ、二重送信、履歴破損、state 不整合が起きないこと。
- Zustand store shape の変更で既存 selector / consumer が破綻していないこと。
- Dexie schema や永続化キーの変更で既存データ互換性を壊していないこと。
- UI 変更で会話体験が劣化していないこと。特に message ordering、loading state、retry、image 表示を確認すること。
- コメントは日本語で、非自明な理由だけを残していること。自明な What コメントは指摘対象。

## 期待する報告

- 指摘はファイルと理由をセットで示す。
- 仕様差分、挙動差分、セキュリティ懸念、保守性懸念を分けて報告する。
- 問題がない場合でも、chat / image / API / persistence の主要観点を確認したことが伝わる形で要約する。
