# Domain rule routing

- キャラクターの仕上げ、画像審査、採点、承認では、作業前に
  `prompt/instructions/char-approval-process.md` を読む。
- 画像生成、img2img、LoRA、生成モデル選定では、作業前に
  `prompt/instructions/image-gen-reference-first.md` を読む。
- キャラシート（system_prompt）の作成・修正・生成、キャラが設定どおり振る舞わん時の
  切り分けでは、作業前に `prompt/skills/character-sheet-design/SKILL.md` を読む。
- 一般実装では、詳細規則を常時ロードせず、対象に応じて
  `prompt/instructions/` の該当ファイルだけを読む。
