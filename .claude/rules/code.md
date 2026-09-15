---
paths:
  - "**/*.{ts,tsx,js,jsx}"
---

# Code rules

- 既存のReact + Vite構成、型、命名、近接コンポーネントを先に確認する。
- 型逃げ、空catch、自明なコメント、依頼外の改善を追加しない。
- 変更後はビルドだけでなく、対象APIまたは画面の実経路を確認する。
- 詳細が必要な場合だけ `prompt/skills/typescript/SKILL.md` を読む。
