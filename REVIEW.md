# REVIEW.md — CodeRabbit レビュールール集

このファイルは CodeRabbit が参照する**唯一のルール源**です。
REVIEW.md に定義されていないベストプラクティスは "violation" ではなく "suggestion" として扱ってください。
ルールを引用するときは必ずルール ID（例: IMG-1）を明示してください。

---

## IMG — 画像生成

### IMG-1: 射精/体液タグ崩壊（bukake horror 防止）

**検出シグナル**: `climax` / `afterglow` フェーズのプロンプト生成コードで、`cum` / `facial` / `hair_with_cum` / `covered_in_cum` などの体液付着タグが positive 側に存在する。または翻訳由来の floating `cum` タグが混入している。

**重大度**: MUST

**対応**: climax は `internal` のみ許可。`facial` / `cum` / 全身付着系タグは negative へ移動。タグの重複を dedupe する。

**evidence**: #590 #591 #592 #593 #595 #647, commits 4ddc64a cb6c967 9c70e09

---

### IMG-2: img2img ベース選択誤り

**検出シグナル**: `ord = 0`（最古サブ画像）を img2img の基底として参照するコード変更。

**重大度**: MUST

**対応**: highest-ord（最新）のサブ画像を基底として選択すること。

**evidence**: #667

---

### IMG-3: 英語 SD タグ anchor 欠落

**検出シグナル**: 肌色・体型を指定するプロンプトセクションに anchor タグ（英語 SD タグ）が含まれない。

**重大度**: MUST

**対応**: 肌色 / 体型など崩壊しやすい属性には anchor タグ必須。

**evidence**: #634 #647

---

### IMG-4: 近似重複サブ画像混入

**検出シグナル**: pHash チェックなしに同一キャラへ複数のサブ画像を INSERT する migration / API コード。

**重大度**: suggestion

**対応**: INSERT 前に pHash 近似重複チェックを実行し、閾値以内なら弾く。

**evidence**: commit 58553f1

---

## CHAT — 会話/エロ品質

### CHAT-1: エスカレーション不足 / continuation guard 欠如

**検出シグナル**: `scenePhase` が `climax` でも `erotic` と同等の強度のプロンプト指示しか与えない。continuation / escalation guard ロジックが削除・欠落している。

**重大度**: MUST

**対応**: climax フェーズには段階的強度を保証するプロンプト分岐を設ける。continuation guard は削除禁止。

**evidence**: #572 #608 #610

---

### CHAT-2: prompt injection（retry context 汚染）

**検出シグナル**: retry 時に `【指示】` ブロックや `<instruction>` タグをそのまま context に積み重ねる処理。sanitize なしで previous messages を再送信するコード。

**重大度**: MUST

**対応**: retry context 構築時に `【指示】` / `<instruction>` ブロックを sanitize する処理を必ず通す。

**evidence**: #609 #646, commit 26d449d

---

### CHAT-3: client 発 scenePhase 自動エスカレーション

**検出シグナル**: クライアントから送られた `scenePhase` をバックエンドで無検証で受け取り、昇格（例: `normal → erotic`）を許可するコード。

**重大度**: MUST

**対応**: scenePhase の昇格判断はバックエンドのみで行い、クライアントからの昇格リクエストは抑制する。

**evidence**: #619

---

### CHAT-4: hint と lengthDirective の数値競合

**検出シグナル**: `EROTIC_LONGFORM_HINT` / `CLIMAX_LONGFORM_HINT` / `INTIMATE_LONGFORM_HINT` /
`AFTERGLOW_LONGFORM_HINT` に「◯◯字」等の具体的な文字数目標が書き足されるコード変更。

**重大度**: MUST

**対応**: 文字数の正規指示は lengthDirective（`RESPONSE_LENGTH_PRESETS` 由来）一本に保つ。
hint 系は文体・構成・禁止語句などの質的指示のみを持ち、数値を持たない。hint と
lengthDirective を同一メッセージへ同時活性化させること自体は禁止せん——#719 で
`lengthDirective` へ意図的に併合された両立方針であり、現在も `functions/api/[[route]].ts`
の `lengthDirective` 組み立てと `chat-length-directive-integration.test.ts` の
「両立方針」アサーションで維持されとる。禁止しとるのは hint 側へ競合する数値を
足し戻すことだけ。#633 で実際に壊れたのは「同時活性化」やのうて「両方が別々の
文字数を主張した」ことやった。

**evidence**: #633 #644 #719 #1226（旧「排他制御」という記述は #719 の両立方針採用より前に
書かれた古い記述で、現状のコードと食い違っていたため #1236 の敵対レビュー指摘を受けて
2026-08-08 訂正した）

---

## DB — データ/マイグレーション

### DB-1: 既存テーブル/カラムの破壊的変更

**検出シグナル**: `drizzle/` 以下のマイグレーションファイルに `DROP TABLE` / `DROP COLUMN` / データ消失を伴う `ALTER TABLE` が含まれる。

**重大度**: MUST

**対応**: 破壊的変更には必ずデータ移行手順とロールバック計画を PR description に明記する。additive migration（新テーブルへコピー→切替→旧を deprecated）を優先する。

**evidence**: commit fcbfa07（`conversation_share` テーブルが migration 0024 で消失）

---

### DB-2: scaffolding のみで書き込みパスが無い

**検出シグナル**: `drizzle/` にカラム / テーブル追加のマイグレーションはあるが、同 PR に新カラムへのデータ書き込みコードパスが存在しない。

**重大度**: MUST

**対応**: マイグレーションと同 PR で writer / API エンドポイントを実装する。それが難しければ "scaffolding PR" として明示し、対応 issue 番号を PR description に記載する。

**evidence**: quality-commit-score.md, prohibitions.md「scaffolding」

---

### DB-3: D1 永続化漏れ

**検出シグナル**: greeting / feedback / キャラクター設定など永続化が必要なデータを IndexedDB（Dexie）のみに保存し、D1 への INSERT / UPDATE がない。

**重大度**: MUST

**対応**: 永続化対象データは D1 を正とし、IndexedDB はキャッシュとして扱う。

**evidence**: #641, #671 (×3 箇所)

---

## TS — 型安全

### TS-1: Zod スキーマ型不一致の波及

**検出シグナル**: `src/schema/` 以下の Zod スキーマで型変更（例: `createdAt` が `string` ↔ `number`）が行われているが、consumer コード（hook / store / component）が同 PR で修正されていない。

**重大度**: MUST

**対応**: schema 変更時は `grep -r` で全 consumer を列挙し、同 PR で一括修正する。

**evidence**: #668

---

### TS-2: 禁止構文の混入

**検出シグナル**: diff に `any` 型 / `@ts-ignore` / `eslint-disable` コメントが含まれる。

**重大度**: MUST

**対応**: 根本解決する。型が複雑なら `unknown` + type guard / `Zod infer<typeof Schema>` / `satisfies` を使う。

**evidence**: AGENTS.md コーディング規約

---

## SSE — ストリーミング

### SSE-1: 片側だけ配線（scaffolding）

**検出シグナル**: SSE handler / callback は追加されているがバックエンドが対応するイベントを emit していない（または逆）。

**重大度**: MUST

**対応**: handler と emitter を同 PR に含める。片方のみなら "scaffolding PR" として明示し issue 番号を PR description に記載する。

**evidence**: commits a83f960 4032028, #441 #443

---

### SSE-2: 表記/テスト不整合

**検出シグナル**: badge 文言やストリーミング状態テキストを変更したが、対応する Vitest スナップショット / テストケースが未更新。

**重大度**: MUST

**対応**: 文言変更と同 PR でテストを更新する。

**evidence**: #672

---

## PROC — プロセス

### PROC-1: lint 後追い commit

**検出シグナル**: `fix: lint` / `chore: lint` / `style: lint` 等の lint 修正 commit が機能 commit の直後に続く。

**重大度**: suggestion

**対応**: commit 前に `pnpm lint` を通してから 1 commit にまとめる。

**evidence**: commits 2837688 209d30e

---

### PROC-2: 危険な git オプション

**検出シグナル**: CI / スクリプト / Makefile / Taskfile に `--no-verify` / `--force`（`--force-with-lease` 以外）/ `git reset --hard|--soft|--mixed` が含まれる。

**重大度**: MUST

**対応**: `--force-with-lease` を使う。reset は additive な操作に置き換える。

---

## PHIL — プロジェクト哲学ガード

### PHIL-1: 検閲提案禁止

**検出シグナル**: PR description / コード / コメントに「モデレーション」「CSAM フィルタ」「コンテンツフィルタ」「生成内容検閲」を P0 / ship-blocker / 必須として含む。かつ、ユーザーが明示的に検閲実装を指示した形跡がない。

**重大度**: MUST

**対応**: このプロジェクトの存在理由は「抜ける質」。エロ生成を弱める検閲は哲学違反として flag し差し戻す。年齢ゲート / セキュリティ / コスト は別物で許容。

**evidence**: prohibitions.md「AI/subagent 過剰検閲提案禁止」

---

### PHIL-2: 自作自演 issue/PR 禁止

**検出シグナル**: PR の `closingIssuesReferences` が空（どの issue も閉じない）かつ、PR body に「gap」「risk」「念のため」「改善」「approval-gate」等の AI 起点ワードが含まれる。tracked issue / ユーザー指示の根拠がない。

**重大度**: MUST

**対応**: 特に approval-gate / 生成物を隠す変更は即 flag。マージ前に局長確認を必須とする。

**evidence**: #582 事件（`approval NOT NULL DEFAULT 'pending'` で全サブ画像が非公開になり気づかれなかった）

---

### PHIL-3: chat と image のセット確認漏れ

**検出シグナル**: `functions/api/` や `src/lib/api.ts` の chat 系コードを変更しているが、PR description に image 側への影響確認（または「image：スコープ外（理由：〇〇）」の明示）が無い。逆も同様。

**重大度**: suggestion

**対応**: chat 変更時は image への波及を確認し PR description に記載する。image 変更時も同様。

**evidence**: prohibitions.md「chat と image は常にセットで考える」

---

### PHIL-4: 偽装完了禁止（テストのみ・目視なし）

**検出シグナル**: PR description に「テストが通った」「ビルドが通った」のみを根拠として「完了」「done」「✅」を主張し、UI スクリーンショット / curl 出力 / E2E 結果が添付されていない。

**重大度**: suggestion

**対応**: UI 変更には目視確認スクリーンショットを PR に添付する。API 変更には curl 出力を添付する。

**evidence**: prohibitions.md「偽装完了報告禁止」

---

### PHIL-5: コメント規約違反

**検出シグナル**: diff に英語コメント（`// This is` / `/* Note:` 等）が含まれる（framework config を除く）。または「何をするか（What）」を説明するだけの自明なコメント。

**重大度**: suggestion

**対応**: コメントは日本語で「なぜ（Why）」のみ書く。

**evidence**: prohibitions.md「コメント」

---

## Better Way Perspective

CodeRabbit はルール違反の指摘にとどまらず、より良い実装を **GitHub Suggested Changes 形式**で積極的に提案してください。

| diff で見えたパターン | Better Way（提案すべき代替案） |
|---|---|
| DB-1: `DROP TABLE` / `DROP COLUMN` | additive migration（新テーブルへコピー→切替→旧を deprecated）＋別途データ移行 PR を提案 |
| DB-2: migration のみ、writer なし | 同 PR に writer / API エンドポイントを含めるよう Suggested Changes で差分を提示。scaffold 分離が必要なら issue 番号記載を要求 |
| SSE-1: handler のみ、emitter なし（または逆） | 欠けている側（emitter または handler）を Suggested Changes で提示。scaffold 分離の場合は issue 番号記載を要求 |
| CHAT-2: retry 時に `【指示】` ブロック再送信 | retry context を slice して `【指示】` / `<instruction>` を strip するユーティリティ関数を挟む修正を Suggested Changes で提示 |
| TS-2: `any` 型 | `unknown` + type guard / `Zod infer<typeof Schema>` / `satisfies` を使った型安全なコードを Suggested Changes で提示 |
| IMG-1: climax に body fluid タグ positive | negative prompt への移動差分を Suggested Changes で提示 |
| PROC-1: lint 後追い commit | `pnpm lint --fix` を pre-commit hook に組み込む方法を suggestion として提案 |
| PHIL-2: issue を閉じない AI 起点 PR | 「このPRが解決する issue はどれですか？ClosingIssuesReferences を追加してください」とコメント |
