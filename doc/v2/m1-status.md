# v2 M1 status（2026-09-03）

M0（`doc/v2/m0-status.md`）の「TurnStore はインメモリ」を D1 版へ置き換え、character を Drizzle → zod で検証して読むようにした時点の記録。
既存アプリ（`src/`, `functions/`）は無変更。root の CI（`pnpm lint` / `pnpm typecheck` / `pnpm test`）は緑のまま。

## 何がどこに残るか

| 内容 | テーブル | 書く側 | 読む側 |
|---|---|---|---|
| 会話 1 件（user_id / character_id / thread_id / prompt_version / created_at / updated_at） | `v2_conversation` | `createD1TurnStore.saveTurn`（初回 insert、以後 `updated_at` だけ upsert） | `load`（存在確認） |
| ユーザー発話・キャラ応答（turn ごとに user / assistant の 2 行。assistant は chunk を空行で結合した本文 + `action` / `dialogue` / `inner` を抜いた列 + `generation_id`） | `v2_message` | `saveTurn` | `load` → `history`（turn 昇順、user → assistant） |
| chunk（seq / text / judge_json / attempt） | `v2_chunk` | `saveTurn`（1 行 1 文。D1 の bind 上限 100 のため） | （まだ読まん） |
| 場面台帳（SceneLedger の JSON） | `v2_ledger` | `saveTurn`（turn ごと 1 行） | `load` → 最新 turn の 1 行を zod で検証して `ledger`。壊れとったら throw |
| 生成 1 回分（model / prompt_version / system_prompt / request_json / raw_output / usage_json / latency_ms / status） | `v2_generation` | `saveTurn`（events 先頭の `generation` イベントから） | （まだ読まん） |
| 長期記憶 | `v2_memory` | M2 | M2 |

- `saveTurn` は 1 回の `db.batch`（D1 のトランザクション）。同じ `(conversationId, turn)` を二度保存したら既存の message / chunk / ledger / generation を消してから入れる（置き換え）。
- `load().turn` は「次に演じるターン番号」（空の会話は 1）。`createMemoryTurnStore` と同じ意味。
- `user_id` は認証が無いので `apps/v2/src/server/engine.ts` の `LOCAL_USER_ID = "local"` 固定。`pnpm v2:persist-check` は `"persist-check"`、db のテストは `"vitest"` で行を作る。
- `thread_id`（LangGraph の checkpointer キー）は conversationId と同じ値。checkpointer 自体は `MemorySaver` のまま（前ターンの状態は intake が D1 から読み直すので、checkpointer に残す必要が無い）。

## 契約の置き場所（実装者 2 名の作業の結合で決めたこと）

| 型 / 関数 | 置き場所 | 理由 |
|---|---|---|
| `HistoryMessage` / `TurnEvent` / `GenerationRecord` / `SaveTurnInput` / `TurnStore` | `packages/db/src/turn-store.ts`（`@v2/db`） | `@v2/engine` が `package.json` で `@v2/db` に依存しとる。engine 側に置くと db → engine → db の循環になる |
| 同上の再 export | `packages/engine/src/types.ts` → `@v2/engine` | engine を使う側（apps/v2, bench）は今までどおり `@v2/engine` から型を取れる。type-only なので実行時には消える（Jest 影響なし） |
| `createD1TurnStore(db, { userId, characterId, promptVersion })` | `@v2/db` | 実装 |
| `createMemoryTurnStore()` | `@v2/engine` | テスト・bench 用に残す |
| `characterSheetSchema` / `CharacterSheet` / `loadCharacters(db)` / `loadCharacter(db, id)` | `packages/db/src/character.ts`（`@v2/db`） | 既存 `character` テーブルを Drizzle で読み、行ごとに zod。`tags` は JSON 文字列として受けて行単位で解く（1 行の不正で全件が落ちんように）。落ちた行は `failures: [{ id, issues }]` へ寄せる |
| engine の `CharacterSheet`（`{ id, name, systemPrompt, greeting }`） | `@v2/engine` | db の `CharacterSheet` はこれの上位集合（tags / avatar / gender / slug / isOfficial / displayOrder / createdAt を含む）なので、そのまま渡せる |

`@v2/db` → `@v2/prompt`（`SceneLedger`, `emptyLedger`）, `@v2/judge`（`JudgeResult`）。`@v2/cf` → `@v2/db`（check.ts）。`@v2/bench` → `@v2/cf`, `@v2/db`, `@v2/engine`。循環なし。
db のテストは `@v2/cf` を使わず `packages/db/src/test/local-d1.ts`（wrangler を直接叩いて migration → `getPlatformProxy`）で閉じる。

## 経路

| 経路 | 中身 |
|---|---|
| `POST /api/chat/$id`（body `{ text, conversationId? }`） | `readCharacter` → `loadCharacter(db, id)`。行なし → 404、zod 落ち → 422（`failures` 付き）、キー無し（fake 以外）→ 503。通ったら `createTurnGraph({ model, store: createD1TurnStore(createDb(env.DB), { userId: "local", characterId, promptVersion }) })` をターンごとに組んで SSE（`token* → chunk+ → done`）。`done` に `generationId` が付く。`generation` イベントは SSE に流さず `saveTurn` の events 先頭にだけ載せる |
| `GET /api/chat/$id/history?conversationId=…` | D1 store の `load` をそのまま `{ conversationId, turn, history }` で返す。クエリ無し → 400。未知の conversationId → `{ turn: 1, history: [] }`（200） |
| ルートファイル | `apps/v2/src/routes/api/chat/$id.ts`（POST）、`apps/v2/src/routes/api/chat/$id_/history.ts`（GET。`$id_` は非ネスト指定） |
| `V2_FAKE_MODEL=1` | model だけ `FakeListChatModel`。store は同じ D1 版（保存経路は本番と同じ） |

## コマンド

```bash
pnpm install
pnpm db:migrate:local      # root。0070_v2_tables も入る。ローカル D1 が空なら pnpm db:seed
pnpm v2:db:check           # { n, zodPassed, failures } — character 全件を loadCharacters に通す
pnpm v2:persist-check      # 別プロセス 2 回で turn 1 → turn 2。D1 store の load が 2 → 4 件になることを assert
V2_FAKE_MODEL=1 pnpm v2:dev   # http://localhost:3100

pnpm lint && pnpm typecheck && pnpm test           # root（apps/ packages/ は対象外）
pnpm v2:lint && pnpm v2:typecheck && pnpm v2:test   # = pnpm v2:ci
```

手動確認:

```bash
C='http://localhost:3100/api/chat/import-charap-%E3%82%A2%E3%82%A4%E3%83%AA%E3%82%B9'
curl -N -X POST -H 'content-type: application/json' -d '{"text":"こんにちは","conversationId":"c1"}' "$C"
curl -N -X POST -H 'content-type: application/json' -d '{"text":"二回目","conversationId":"c1"}' "$C"
curl "$C/history?conversationId=c1"
# ここで pnpm v2:dev を殺して起動し直しても、同じ GET が同じ history を返す
```

## このコンテナで確認した結果（2026-09-03）

| コマンド | 結果（そのまま） |
|---|---|
| `pnpm lint`（root） | `✖ 3 problems (0 errors, 3 warnings)` EXIT=0（M0 と同じ 3 warning） |
| `pnpm typecheck`（root `tsc -b`） | EXIT=0 |
| `pnpm test`（root vitest） | `Test Files  262 passed (262)` / `Tests  3236 passed (3236)` EXIT=0 |
| `pnpm v2:ci` | EXIT=0。lint: 7 パッケージ Done（judge に warning 2: `security/detect-non-literal-regexp`、error 0）。typecheck: 7 パッケージ Done。test: prompt 12 / judge 52 / db 14（うち `loadCharacters: n=123 zodPassed=123 failures=0`）/ engine(Jest) 5 / cf 1 / app 1 / bench 2、全部 passed |
| `pnpm v2:db:check` | `{ "n": 123, "zodPassed": 123, "failures": [] }` EXIT=0 |
| `pnpm v2:persist-check` | EXIT=0。`first: { step: 1, historyBefore: 0, historyAfter: 2, turnAfter: 2, doneTurn: 1 }`、`second: { step: 2, historyBefore: 2, historyAfter: 4, turnAfter: 3, doneTurn: 2 }`（conversationId `860b23bb-8ea2-4d1d-8747-6dda19c0f5bc`、character `import-charap-アイリス`、別プロセス） |
| `V2_FAKE_MODEL=1 pnpm v2:dev` → `POST /api/chat/import-charap-アイリス` ×2（同じ conversationId `m1-boot-1788460335`） | 1 発目: `event: token` ×113 → `event: chunk` ×3 → `done {"turn":1,"generationId":"7b328561-…"}`。2 発目: token ×113 → chunk ×3 → `done {"turn":2,"generationId":"415b4259-…"}` |
| 同プロセスで `GET …/history?conversationId=m1-boot-1788460335` | HTTP 200 `{"turn":3,"history":[user こんにちは, assistant <action>…</inner>, user 二回目です, assistant …]}`（4 件） |
| dev server を kill（`vite dev --port 3100` プロセス 0 件、port 3100 が閉じたことを curl で確認）→ `V2_FAKE_MODEL=1 pnpm v2:dev` を新プロセスで起動 → 同じ GET | HTTP 200、同じ 4 件・`turn: 3`（**再起動をまたいで残っとる**） |
| 再起動後に 3 発目 POST → GET | `done {"turn":3}` → `turn 4, history 6 [user, assistant, user, assistant, user, assistant]` |
| ローカル D1 の行（`wrangler d1 execute --local`、conversation `m1-boot-1788460335`） | `conv 1, msg 6, chunk 9, ledger 3, gen 3, user_id 'local'` |
| `POST /api/chat/does-not-exist` | 404 |
| `GET …/history`（クエリ無し） | 400 |
| `GET …/history?conversationId=never-seen` | 200 `{"turn":1,"history":[]}` |

## ここで確認できんこと（Mac で）

| 項目 | 理由 | Mac での手順 |
|---|---|---|
| 本番 D1 への migration（`0070_v2_tables.sql`） | このコンテナに wrangler login が無い | `pnpm db:migrate:remote`（= `wrangler d1 migrations apply adult-ai-db --remote`。root `package.json` の script）。適用後 `wrangler d1 execute adult-ai-db --remote --command "select name from sqlite_master where name like 'v2_%'"` で 6 テーブルを確認 |
| 本番 character 221 行の zod 検証 | ローカル D1 は seed の 123 行。本番の 221 行は remote でしか読めん | wrangler login 済みで `CF_REMOTE=1 pnpm v2:db:check`（`@v2/cf` の `createPlatform` が `remoteBindings: true` + `env.remote` で本番 D1 を束縛する）。期待 `{ n: 221, zodPassed: 221, failures: [] }`。`failures` が出たら、その `id` と `issues`（`tags` の JSON 不正 / `greeting` 空 など）を直すか schema を議論する。**`check.ts` は `applyLocalMigrations()` を先に呼ぶ（ローカル store への適用のみで本番には触らん）** |
| OpenRouter への実ターン | `.dev.vars` が無い | `apps/v2/.dev.vars` に `OPENROUTER_API_KEY=…`（任意 `V2_MODEL=…`）→ `pnpm v2:dev` → 上の curl。期待: `token` 逐次 → `chunk` 3 個前後 → `done`。`v2_generation.model` に実モデル名、`usage_json` に token 数が入る |
| 実機ブラウザでの画面確認 | curl のみ | `http://localhost:3100/` → キャラ → 送信。画面はまだ D1 の history を初期表示せん（下記） |

## M1 で意図的に残しとるもの（M2 へ）

- チャット画面は起動時に `GET …/history` を読まん（会話の続きは API 経由でのみ確認できる）。会話一覧（`v2_conversation` を user_id で引く）も無い。
- checkpointer は `MemorySaver`。`@langchain/langgraph-checkpoint-sqlite` は未導入。
- `v2_chunk` / `v2_generation` を読む経路（品質分析・コスト集計）は無い。書くだけ。
- `retrieve` は空配列、`v2_memory` は未使用（RAG は M2）。
- 認証なし（`user_id = "local"` 固定）。

## 反証の記録（2026-09-03 深夜）

読み取り専用の反証 2 本（既定「間違っとる」）。主張 8 件はどちらも全部再現して成立（`pnpm v2:persist-check` の別プロセス 2 回、HTTP 経由の再起動またぎ、zod 123/123、v2:ci 緑、差分の範囲）。

指摘 1 件（low、未対応で残す）: `turn-store.ts` の `v2_conversation` upsert が衝突時に `character_id` を更新せん。会話は 1 キャラに固定される設計なので今は正しい挙動やが、同じ conversationId を別キャラで呼んだ時に黙って元のキャラのままになる。M2 で conversationId とキャラの不一致を 4xx で弾く。
