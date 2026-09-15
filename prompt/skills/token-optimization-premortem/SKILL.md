---
name: token-optimization-premortem
description: "Token Optimization Pre-Mortem"
---
# Token Optimization Pre-Mortem

## 現状データ（2026-05-03 計測）

| Layer | Bytes | 備考 |
|-------|-------|------|
| Global rules (`~/.claude/rules/`) | 60,011 | `codex-delegation.md` 単体で 26,481 (44%) |
| Project CLAUDE.md (3階層) | ~8,000 | context-mode routing が 2ファイルで重複 |
| Project instructions (`prompt/instructions/`) | ~6,000 | rules/ と symlink で二重ロード |
| Memory files | ~4,000 | 5ファイル、毎セッション読み込み |
| **合計（推定）** | **~78,000** | セッション開始時点で約 78KB = ~20K token が rules だけで消費 |

---

## Scenario A: トークン消費過多でセッション枯渇

**発生確率**: High（過去セッションで繰り返し発生済み）
**影響度**: High（セッション途中で context 圧縮 → 前半の推論が消失）

### 原因分析（実績ベース）

| # | パターン | 推定 token 消費 | 発生頻度 |
|---|---------|----------------|---------|
| 1 | **ルール自体の肥大化** — codex-delegation.md 1ファイルで 26KB | ~6,500 token/session | 毎回 |
| 2 | **Read の連鎖** — 「ちょっと確認」が 5+ 回に膨張 | 2,000-10,000 token | 高 |
| 3 | **ctx_* 未使用** — Bash/Read で大量出力をコンテキストに流し込み | 5,000-50,000 token | 高 |
| 4 | **同じ情報の重複取得** — 前ターンで読んだファイルを忘れて再度 Read | 1,000-3,000 token | 中 |
| 5 | **subagent の過剰起動** — 単発 grep で済む調査に Agent を使う | 3,000-8,000 token | 低 |
| 6 | **context-mode CLAUDE.md の重複** — `~/CLAUDE.md` と `~/ghq/kouiso/CLAUDE.md` がほぼ同一内容 | ~2,000 token | 毎回 |

### 対策

1. **codex-delegation.md を 8KB 以下に圧縮** — 現在の 26KB は context-budget ルール自体に違反。Codex verification rubric をスキルに分離し、ルール側はポインタのみにする
2. **context-mode CLAUDE.md の重複排除** — `~/ghq/kouiso/CLAUDE.md` を削除し `~/CLAUDE.md` に一本化
3. **Read vs ctx_execute_file の判定基準を明確化**:
   - Edit 目的 → Read（必須）
   - 分析・探索・要約 → ctx_execute_file（stdout のみコンテキストに入る）
   - 50行以上のファイル読み → ctx_execute_file 優先
4. **Grep 結果の上限** — 20行超の grep 結果は ctx_execute で sandbox 実行

---

## Scenario B: 節約しすぎて品質崩壊

**発生確率**: Medium（Codex 丸投げ + 検証スキップの組み合わせで発生）
**影響度**: Critical（偽完了 → ユーザーが本番で発見 → 信頼崩壊）

### 原因分析

| # | パターン | 結果 | 発生頻度 |
|---|---------|------|---------|
| 1 | **Codex 完了報告を鵜呑み** — diff 未確認で「完了」報告 | 偽完了、部分実装の見逃し | 高（memory に記録あり） |
| 2 | **build/lint 未実行で報告** — 「多分通る」で済ませる | 壊れたコードを merge | 中 |
| 3 | **shallow read** — ctx_execute_file で要約だけ読み、実際の行を見ない | ロジックバグ見逃し | 中 |
| 4 | **検証ステップ自体を節約対象にする** — screenshot / curl / test を「トークンもったいない」で省略 | 視覚バグ・API バグが残る | 低（ルールで禁止済みだが圧力あり） |
| 5 | **Codex に context を渡しすぎない結果、Codex が的外れな修正をする** — spec が不十分 | 手戻り → 結局トークン増 | 中 |

### 対策：最低限の検証チェックリスト（省略不可）

Codex タスク完了後、以下を必ず実行。コスト ~500 token、偽完了の手戻り（5,000-20,000 token）より安い。

```
1. `tail -50 /tmp/codex-<name>.log` — 最終出力確認（Read で OK）
2. `git diff --stat` — 変更スコープ確認（Bash, 短出力）
3. `pnpm build && pnpm lint` — ビルド・リント通過（Codex 再委譲可）
4. 変更ファイルの diff を 1 つだけ Read — 品質スポットチェック
```

ステップ 4 の「1つだけ」は意図的 — 全ファイル読みは Scenario A を誘発する。

---

## 構造的改善提案

### 即時

| アクション | 効果 |
|-----------|------|
| `~/ghq/kouiso/CLAUDE.md` の重複排除 | -2,000 token/session |

### 短期（次回セッション）

| アクション | 効果 |
|-----------|------|
| `codex-delegation.md` を 8KB 以下に圧縮（rubric をスキルに分離） | -4,500 token/session |
| `trial-and-error.md` (8.8KB) を圧縮 | -1,500 token/session |
| `essential-thinking.md` (9KB) を圧縮 | -1,500 token/session |

### 中期

| アクション | 効果 |
|-----------|------|
| PostToolUse hook で Read/Bash の大出力を警告 | 浪費パターン定量把握 |
| Codex spec テンプレ標準化 | spec 不足による手戻り削減 |

---

## トークン予算の目安

| 用途 | 上限 | 根拠 |
|------|------|------|
| ルール・指示ロード | 25K token（圧縮後 12K 目標） | 現状 ~20K |
| 1タスクの Claude 思考 | 5K token | spec + 判断 + 検証 |
| Codex 完了後の検証 | 1K token | チェックリスト 4 ステップ |
| ユーザー応答 | 500 token | ADHD ルール準拠 |

**1タスク = ~6.5K token（ルール除く）** を基準。大幅超過 = Scenario A のサイン。
