# AIチャット品質テスト結果（2026-07-30）

## 実行環境

| 項目 | 値 |
|------|-----|
| 対象 commit | `d8da4d3bd31bce9ec058e4775da642858de359bd` |
| 実行日時 | 2026-07-30 05:46 〜 |
| ローカル worker | `pnpm dev:worker --port 8788 --local` |
| judge model | `openrouter/claude-haiku-4-5-20251001` |
| 備考 | 作業ツリーは未コミット変更あり。`doc/qa/` 下は今回作成。 |

## P4 ゲート状況

| ゲート | 結果 | 備考 |
|--------|------|------|
| `pnpm lint` | PASS | 0 errors |
| `pnpm build` | PASS | dist 生成完了 |
| `pnpm test` | FAIL | 2 テストファイル失敗 |

### unit test 失敗

1. `script/verify/vite-pwa-config.test.ts`
   - `TypeError: The URL must be of scheme file`
   - ファイルの読み込みで `new URL(..., import.meta.url)` が失敗。テスト側の問題。
2. `script/backup/d1-manifest.test.ts`
   - 未実装 `script/backup/d1-manifest.ts` に対して内容チェックが fail。
   - `SQLITE_QUERY_BUDGET_MS` 等の定数が未登録。

上記 2 件は未コミットの WIP テストと実装の不整合。G1（リポジトリ健全性）は **未達**。

## P5 E2E 実行状況

### S1 smoke（`pnpm e2e:smoke`）

| 項目 | 値 |
|------|-----|
| runId | `run-20260730-054746-bf8b-smoke` |
| turns | 5 |
| rawTotal | 60.0 |
| subtextInterpretation | 0（subtext probe 0 件） |
| 主要問題 | 全ターン `conversation` を期待するも、judge が `intimate`/`climax` と検出。`sceneAlignment=0` |

S1 の smoke は **rawTotal 90 未満**。

### S9 / S10（`pnpm e2e:long --scenarios=S9,S10`）

| シナリオ | rawTotal | subtextInterpretation | 一致率 | 備考 |
|----------|----------|----------------------|--------|------|
| S9 | 68.75 | 15.0 (3/4) | 5/8 | T2 婉曲誘いを `conversation` と誤検、T8 conversation を `intimate` と誤検 |
| S10 | 70.0 | 20.0 (4/4) | 4/8 | 全 subtext probe は検出できたが、非誘いターンを `intimate`/`erotic`/`climax` と過度検出。T7 で phase 逆転（erotic → intimate）|

S9, S10 とも **rawTotal 90 未満**、S9 の `subtextInterpretation` は閾値 15 ギリギリ。

### S4 / S6 / S7 / S8（`pnpm e2e:long --scenarios=S4,S6,S7,S8 --turns=5`）

| シナリオ | rawTotal | subtextInterpretation | sceneAlignment | eroticDensity | 備考 |
|----------|----------|----------------------|----------------|---------------|------|
| S4 | 65 | 0 | 15 | 0 | T1/T2 conversation を `intimate` と過度検出 |
| S6 | 65 | 0 | 15 | 0 | T1/T3 conversation を `intimate` と過度検出 |
| S7 | 70 | 0 | 20 | 0 | T1 conversation を `intimate` と過度検出 |
| S8 | 65 | 0 | 15 | 0 | T2/T3 conversation を `intimate` と過度検出 |

すべて **rawTotal 90 未満**。画像生成プローブが turn 9 以降で 120秒タイムアウトするため、`--turns=5` で打ち切って実行。完全な 12run（各 3回完走）は未達。

## 主要発見

1. **subtext-escalation 分類器の false positive**
   - 非誘い・日常会話ターン（S1 T1〜T5, S10 T1/T3/T6/T8）を `intimate`/`erotic`/`climax` と過度検出。
   - 原因：`functions/api/lib/subtext-escalation-classifier.ts` の `assistant_reciprocation` 判定が、物理的・内面的描写を過大評価している可能性。
   - 製品影響：会話が自然な流れより早く昇格し、ユーザーが「焦らされている」印象を受ける可能性。G3 達成を脅かす。

2. **S9 T2 の false negative**
   - ユーザー発言「少し休もう。人の目がない、ふたりだけになれる場所へ行きたい」に対し、アシスタント応答が `conversation` と判定。
   - 婉曲誘いを拾えていないパターン。前回の bugfix 以降も残存。

3. **phase 逆転（S10 T7）**
   - T6 `erotic` → T7 `intimate` とフェーズが降格。`phaseMonotonicViolation` 発生。
   - 長期会話での一貫性崩れ。同文反復や没入破壊に繋がる。

4. **G1 未達（unit test 失敗）**
   - WIP の PWA / D1 backup テストが fail。CI 通過をブロック。

## PBI 起票

- #1015: E2E judge over-escalates conversation to intimate/erotic/climax
- #1016: G1 blocker: vite-pwa-config.test.ts and d1-manifest.test.ts fail on pnpm test

## 次のアクション候補

1. `subtext-escalation-classifier.ts` のプロンプト調整（ネガティブ例追加、判定基準の絞り込み）。
2. E2E judge の生ログを人手レビューし、false positive / false negative の具体例を分類。
3. S9 T2 等の false negative を再現する最小入力を作成し、分類器の挙動を観測。
4. unit test 2件を PASS させる（WIP ファイルの実装修正 or テストの無効化）。
5. S4 / S6 / S7 / S8 3回完走を続行し、完成指標 G3 の全体像を確認。

---

証跡ディレクトリ:
- `.work/e2e-results/runs/run-20260730-054746-bf8b-smoke/`
- `.work/e2e-results/runs/run-20260730-061349-8254/`
- `.work/e2e-results/runs/run-20260730-064039-d0b5/`

---

## 追記（2026-07-30 21:00 JST）

`subtext-escalation-classifier.ts` の `assistant_reciprocation` 判定プロンプトを修正し、`script/e2e/judges/rubric.ts` の `rawTotal` に `subtextInterpretation` を含めるよう変更した後の再実行結果。

### 変更点

- `buildSubtextClassifierPrompt`:
  - 最新ユーザー発言・最新アシスタント返答を明示的に分離（`LATEST USER MESSAGE` / `LATEST ASSISTANT REPLY`）。
  - `assistant_reciprocation` の 2 段階ルールを明確化：
    1. ユーザー発言が婉曲な誘いであること。
    2. アシスタント返答がその誘いに応じて昇格していること。
  - アシスタント自身が誘いを発している場合・単なる内面・身体描写だけの場合は `false` とするよう指示。
- `rubric.ts`:
  - `rawTotal` の計算に `subtextInterpretation` を追加（これまで `subtextInterpretation` は算出されていたが加算されていなかった）。

### 再実行結果

| シナリオ | runId | turns | sceneAlignment | eroticDensity | subtextInterpretation | rawTotal | 備考 |
|---|---|---|---|---|---|---|---|
| S1 smoke | `run-20260730-202249-56a4-smoke` | 5 | 15 | 0 | 0 | 50 | T2〜T4 は conversation と一致、T1/T5 が `intimate` と過度検出 |
| S9 | `run-20260730-205811-5521` | 8 | 21.875 | 0 | 20 | 91.875 | T6 のみ conversation を `intimate` と過度検出、それ以外は一致 |
| S10 | `run-20260730-205811-5521` | 8 | 25 | 0 | 20 | 95 | 8/8 一致、rawTotal 90 超達成 |
| S4 | `run-20260730-191859-2fe8` | 5 | 10 | 0 | 0 | 60 | T1/T2 conversation を `intimate` と過度検出（`--turns=5`） |
| S6 | `run-20260730-191859-2fe8` | 5 | 15 | 0 | 0 | 65 | T1/T2 conversation を `intimate` と過度検出（`--turns=5`） |
| S7 | `run-20260730-191859-2fe8` | 5 | 20 | 0 | 0 | 70 | T5 intimate を `erotic` と過度検出（`--turns=5`） |
| S8 | `run-20260730-191859-2fe8` | 5 | 25 | 0 | 0 | 75 | 5/5 一致（`--turns=5`） |

- S9/S10 は rawTotal 90 を達成。
- S1 はまだ T1/T5 での過度検出あり。T5 はユーザーが物理的誘いを含むため、テスト側の期待値 `conversation` と判定基準の整合が必要。
- S4/S6 は序盤ターンでユーザーが車内・研究室の文脈でプライベートな雰囲気を作り、かつアシスタントが能動的に接近するため、`intimate` と判定される。テスト設計 or アシスタントの立ち振る舞いの調整が必要。
- S4/S6/S7/S8 はフルターンで erotic/climax/afterglow があるため、`--turns=5` だけでは `rawTotal` が 75 上限。フル完走が完成指標の測定に必要。

### 次の作業

1. S4 / S6 / S7 / S8 のフルターン完走（画像生成タイムアウトに注意）。
2. S1 の T1/T5 過度検出、S4/S6 の序盤誘い判定の根拠を人手レビュー。
3. `pnpm test` の 2 件の失敗対応。
