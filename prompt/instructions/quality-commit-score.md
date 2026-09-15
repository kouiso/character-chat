# Quality Commit Score Rule

## 目的

モデル・プロンプト・拒否検知などの品質影響ファイルを変更した場合、git log だけで品質の変遷を追跡できるようにコミット本文にスコアを記録する。

## 対象ファイル（品質影響ファイル）

以下のいずれかを変更するコミットが対象:

- `src/lib/model.ts`
- `functions/api/[[route]].ts`（chat/erotic関連変更）
- `functions/api/lib/refusal-detect.ts`
- `functions/api/lib/persona-break-detect.ts`
- `prompt/instructions/` 以下のファイル

## ルール

WHEN Claude が上記ファイルのいずれかを含むコミットを作成・命令する場合
THEN コミットメッセージの body（タイトル行の下）に以下のいずれかを含める:

```
# e2e 実行済みの場合:
[e2e: score=88 refusals=0 erotic=25/25]

# e2e 実行中・結果待ちの場合（Codex セッションが今まさに走っている場合のみ）:
[e2e: pending — task_id sess_xxxxxxxx]

# e2e 実行不可・スコープ外の場合:
[e2e: skipped — <理由>]
```

BECAUSE git log でモデル変更の品質影響を追跡できる。`git log --oneline --grep="\[e2e:"` で品質系コミットを一覧できる。

## [e2e: pending] の厳密な定義（誤用禁止）

`[e2e: pending]` = **今この瞬間 Codex セッションが走っており、結果を待っている状態**。

- task_id（`sess_xxxxxxxx`）が**必須**。task_id なしの `pending` = 違反。
- 「Codex が使えないから後でやる」「commit してから検証する」は **pending ではなく skipped**。
- Codex 不在時の正しいフロー:
  1. override marker を書く
  2. **commit 前に**直接実行で動作確認を完了させる（dev server 起動 → API curl → screenshot）
  3. 確認済みになってから commit し `[e2e: score=...]` タグを付ける
- Codex 不在 + 直接実行も不可（物理ブロック）の場合のみ `[e2e: skipped — Codex 不在・直接実行も○○で不可]` とする

**NG 例（違反）**: `[e2e: pending — Codex Cloud rate-limited at time of commit; manual scenario required]`
→ task_id なし・実行中でもない・「後でやる」予告 = skipped 相当。commit 前に動作確認を完了させるべきだった。

## Detection Criterion

品質影響ファイルへのコミット本文に `[e2e:` タグが含まれない → 違反。
`[e2e: pending]` に task_id が含まれない → 違反（「後でやる予告」を pending と偽装している）。
`skipped` タグを使う場合は理由を明記すること（理由なしの `skipped` は違反）。

## 人間が手動でコミットする場合

`scripts/hooks/commit-msg` を `.git/hooks/commit-msg` にインストールすると、品質影響ファイルがstageされているのに `[e2e:` タグが無い場合に警告が出る（非blocking）。
