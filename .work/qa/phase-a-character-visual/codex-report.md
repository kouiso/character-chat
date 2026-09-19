# Phase A — character_visual スキーマ + identity-prompt-builder 検証レポート

## 6軸検証

| 軸 | 結果 | 根拠 |
|---|---|---|
| Scope | PASS [Code-Read] | 変更は指定ファイルのみ。Phase B/C・e2e・chat・TTS には未接触 |
| Completion | PASS [CI的検証] | 全10要件ファイル実装済み。build ✓、test 10/10 PASS |
| Suppressions | PASS [Code-Read] | `@ts-ignore`・`eslint-disable`・`|| true` 等の追加なし |
| Build | PASS [Code-Read] | `pnpm build` exit 0、2432 modules transformed |
| Test | PASS [Code-Read] | `vitest run identity-prompt-builder.test.ts` — 10 tests passed |
| Lint | PASS [Code-Read] | `eslint` 対象4ファイル 0 errors 0 warnings |

## git diff --stat

```
functions/api/[[route]].ts | 287 ++++++++++++++++++++++++++++++++++++++++-----
src/lib/api.ts             |  21 ++++
src/schema/index.ts        |   7 ++
3 files changed, 284 insertions(+), 31 deletions(-)
```

新規ファイル（untracked → commit 対象）:
- `drizzle/0021_character_visual.sql`
- `functions/api/__tests__/identity-prompt-builder.test.ts`
- `functions/api/lib/identity-prompt-builder.ts`
- `src/schema/character-visual-enums.ts`
- `src/schema/character-visual.ts`

## 実装サマリ

### 新規ファイル
- `drizzle/0021_character_visual.sql` — 正規化4テーブル + インデックス
- `src/schema/character-visual.ts` — Drizzle ORM テーブル定義
- `src/schema/character-visual-enums.ts` — zod スキーマ + enum 定数
- `functions/api/lib/identity-prompt-builder.ts` — danbooru タグ変換 + negative 生成
- `functions/api/__tests__/identity-prompt-builder.test.ts` — 10ケース

### 変更ファイル
- `functions/api/[[route]].ts`
  - `loadVisualMetaForCharacter()` ヘルパー追加
  - `/image` route に 3段 fallback (正規化テーブル → imageMeta JSON → visual_prompt)
  - `GET /characters` に `visualMeta` フィールド追加
  - `GET /characters/:id` に `visualMeta` フィールド追加
  - `PATCH /characters/:characterId/visual-meta` ルート追加（db.batch アトミック）
  - `/generate-character` システムプロンプトに `visualMeta` フィールド要求追記
  - `generateCharacterResultSchema` に `visualMeta: visualMetaSchema.optional()` 追加済み
- `src/lib/api.ts`
  - `Character` 型に `visualMeta: VisualMeta | null | undefined` 追加
  - `updateCharacterVisualMeta()` クライアント関数追加
- `src/schema/index.ts` — 新規テーブルを re-export

## 既知のギャップ・繰り延べ項目

| 項目 | 理由 |
|---|---|
| Phase A backfill (Task #2) | 既存188キャラのvisualMeta移行は別タスク扱い |
| Character edit UI (Task #3) | フロントエンドのform実装は別タスク |
| Visual regression 15枚 (Task #4) | 実機確認は別セッションで実施 |
| `/generate-character` の自動DB保存 | 現行フローはLLM結果を返すのみ（キャラ保存は `/characters` POST）。visualMetaはレスポンスに含まれるので呼び出し側がPATCHで保存する想定 |
