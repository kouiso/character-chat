# v2 M0 status（2026-09-03）

`doc/v2/scaffold-spec.md` の M-1 / M0 を、同一リポジトリの pnpm monorepo として実装・結合した時点の記録。
既存アプリ（`src/`, `functions/`）は無変更で、root の CI（`pnpm lint` / `pnpm typecheck` / `pnpm test`）は緑のまま。

## 何が動くか

| 層 | パッケージ | 中身 |
|---|---|---|
| Web | `apps/v2` (`@v2/app`) | TanStack Start 1.168 / Router 1.170。`/`（キャラ一覧、server fn で D1）、`/chat/$id`（モバイル優先のチャット画面）、`POST /api/chat/$id`（Start の `server.handlers` で SSE: `token* → chunk+ → done`、途中の例外は `error` イベント） |
| Engine | `packages/engine` (`@v2/engine`) | LangGraph.js 1.x の 1 ターン StateGraph: `intake → ledger_update → retrieve → compose → generate(stream) → chunk → judge_chunk →(ng かつ未再生成) regenerate_chunk → emit → … → persist`。`createTurnGraph({ model, store, checkpointer? })`, `runTurn(graph, input, threadId)`, `createOpenRouterModel(env)`（キー無しは `OpenRouterKeyMissingError`）, `createMemoryTurnStore()`。checkpointer は `MemorySaver` |
| Prompt | `packages/prompt` (`@v2/prompt`) | `v0001.ts`（不変版）。`composeSystemPrompt({ sheet, name, ledger, phase, targetChars, exemplar })`。シート原文 → 場面台帳 → 出力契約（`<response><action/><dialogue/><inner/></response>`）→ 例示 1 個。3,000 字超は throw。合意・境界などの枠は入れん（root の `no-injected-consent-framing.test.ts` が `packages/prompt/src`, `packages/engine/src` も走査） |
| Judge | `packages/judge` (`@v2/judge`) | `splitChunks`（`<response>` の包みを剥がして action/dialogue/inner 単位、地の文は空行）、`judgeChunk`（8 文字 n-gram 反復 vs 直近 20 chunk、voice（シートの一人称）、format、empty）、`extractVoice` |
| DB | `packages/db` (`@v2/db`) | 既存 Drizzle スキーマ（`src/schema/{character,conversation,message,user}.ts`）の再 export + `v2_*` 6 テーブル（`drizzle/0070_v2_tables.sql` と列名一致をテストで固定）。`createDb(d1)` |
| CF | `packages/cf` (`@v2/cf`) | `createPlatform()` = wrangler `getPlatformProxy`（`remoteBindings: false` 既定、`CF_REMOTE=1` で true）。`applyLocalMigrations()`。永続先は root と同じ `.wrangler/state/v3` |
| Bench | `packages/bench` (`@v2/bench`) | `pnpm v2:bench` = fake model で 1 ターン回して judge 集計を JSON で出す |

## コマンド

```bash
pnpm install
pnpm db:migrate:local      # root。0070_v2_tables も入る。ローカル D1 が空なら pnpm db:seed
pnpm v2:db:check           # { n: <character 件数> }
pnpm v2:dev                # http://localhost:3100  （Start + LangGraph engine は同一プロセス）
V2_FAKE_MODEL=1 pnpm v2:dev   # OpenRouter を叩かず固定 XML を流す（配線確認用）

pnpm v2:lint && pnpm v2:typecheck && pnpm v2:test   # = pnpm v2:ci
pnpm v2:bench
pnpm -F @v2/app build      # apps/v2/dist/{client,server}
```

SSE の手動確認:

```bash
curl -N -X POST -H 'content-type: application/json' \
  -d '{"text":"こんにちは"}' 'http://localhost:3100/api/chat/<character id>'
# 2 ターン目は done の conversationId を body に入れる: {"text":"…","conversationId":"…"}
```

## このコンテナで確認した結果（2026-09-03）

| コマンド | 結果 |
|---|---|
| `pnpm lint`（root） | exit 0（warning 3、error 0。`apps/`, `packages/` は対象外） |
| `pnpm typecheck`（root `tsc -b`） | exit 0 |
| `pnpm test`（root vitest） | 262 files / 3236 tests passed |
| `pnpm v2:lint` | 7 パッケージ全部 Done（judge に warning 1: `security/detect-non-literal-regexp`） |
| `pnpm v2:typecheck` | 7 パッケージ全部 Done（engine は tsconfig.json / tsconfig.jest.json の 2 本） |
| `pnpm v2:test` | prompt 12 / judge 34 / db 7 / cf 1 / engine(Jest) 4 / app 1 / bench 2、全部 passed |
| `pnpm v2:db:check` | `{ n: 123 }` |
| `pnpm v2:bench` | `{"tokens":108,"chunks":3,"ok":3,"ng":0,"regenerated":0,"reasons":{}}` |
| `pnpm -F @v2/app build` | exit 0、`dist/client`, `dist/server` 生成 |
| `pnpm v2:dev`（キー無し） | `GET /` → 200（キャラ一覧が SSR される）。`POST /api/chat/does-not-exist` → 503 `OPENROUTER_API_KEY が未設定…`。body 不正 → 400 |
| `V2_FAKE_MODEL=1 pnpm v2:dev` | `POST /api/chat/import-charap-アイリス` → `content-type: text/event-stream`、`event: token` ×113 → `event: chunk` ×3（全部 `judge.ok: true`, `attempt: 1`）→ `event: done {turn:1}`。同じ conversationId で 2 発目 → `done {turn:2}`。存在せん id → 404 |

## ここで確認できんこと・Mac での確認手順

- **OpenRouter への実ターン**（M0 の最後の 1 項目）。このコンテナに `.dev.vars` が無い。
  Mac で:
  1. `apps/v2/.dev.vars` に `OPENROUTER_API_KEY=sk-or-…`（任意で `V2_MODEL=…`。既定は `sao10k/l3.3-euryale-70b`）。wrangler が `getPlatformProxy` の env に載せる。シェルの環境変数でも受ける。
  2. `pnpm v2:dev` → `http://localhost:3100/` → キャラを選んで 1 発送る。または上の curl。
  3. 期待: `token` が逐次届き、`chunk` 3 個前後、`done`。judge が ng の chunk は `attempt: 2` で 1 回だけ再生成される。
- **CF_REMOTE=1**（remote bindings）。Mac で `CF_REMOTE=1 pnpm v2:dev`。wrangler login が要る。
- 実機ブラウザでの画面確認（このコンテナは curl のみ）。

## 結合時に直したこと（実装者の報告からの差分）

1. `apps/v2/src/server/engine.ts` を自前の OpenRouter fetch から `@v2/engine`（`createTurnGraph` / `runTurn`）へ置き換えた。fake は `FakeListChatModel`（`@langchain/core/utils/testing`）。
2. `POST /api/chat/$id` を Vite dev ミドルウェアの割り込みから、Start の `createFileRoute("/api/chat/$id")({ server: { handlers: { POST } } })` へ（installed 1.170 に存在することを型で確認）。dev / build 両方で同じ経路。
3. `splitChunks` が `<response>` の包みを剥がすようにした。剥がさんと `"<response>"` だけの断片が chunk になり format ng → 無関係な再生成が走っとった。engine の例示も契約と同じ `<response>` 包みに揃え、気分や態度を書かん定型にした。
4. engine の `chunk` ノードで `chunks` / `regenerated` を毎ターン空に戻す。checkpointer 付きで同じ thread_id を使うと前ターンの値が残り、再生成予算が 2 ターン目以降ずっと使い切りになっとった（Jest で固定）。
5. `getPlatformProxy` と graph を `globalThis` に 1 個だけ持つ（HMR の二重起動対策、spec §14-4）。
6. eslint: `packages/*/vitest.config.ts` を各 tsconfig の include へ、engine の `__tests__` / `jest.config.ts` は `tsconfig.jest.json` を project に明示。`pnpm v2:lint` が通るようになった。
7. `@v2/bench` に fake 1 ターンの集計と test を足した（test 0 件で exit 1 やった）。
8. クライアント（`chat-view.tsx`）: token を暫定表示、最初の chunk で確定文へ置き換え（足すと二重表示になっとった）。
9. `apps/v2/src/routeTree.gen.ts` をコミット対象にした（fresh clone で `pnpm v2:typecheck` を通すため。lint は除外のまま）。

## M1 で足したもの（2026-09-03）

- TurnStore を D1 版（`@v2/db` の `createD1TurnStore(db, { userId, characterId, promptVersion })`）へ差し替えた。`apps/v2/src/server/engine.ts` は `getPlatform().env.DB` → `createDb` → store をターンごとに組む。userId は認証が無いので `LOCAL_USER_ID = "local"` 固定（同ファイルに 1 箇所）。`V2_FAKE_MODEL=1` は model だけ fake で store は同じ D1 版。
- engine の `persist` は `saveTurn` の events に `generation`（model / promptVersion / systemPrompt / request / rawOutput / usage / latencyMs = `v2_generation` 1 行分）を先頭で載せる。SSE には流さん。`done` に `generationId` を足した。
- `GET /api/chat/$id/history?conversationId=…` → `{ conversationId, turn, history }`（D1 store の `load` そのまま）。ルートファイルは `apps/v2/src/routes/api/chat/$id_/history.ts`（ディレクトリ名の `$id_` は非ネスト指定）。
- character の 1 件読みは `@v2/db` の `loadCharacter(db, id)`（Drizzle 行 → zod）。zod 落ちは 422、行が無ければ 404。
- `pnpm v2:db:check` → `{ n, zodPassed, failures: [{ id, failures }] }`。
- `pnpm v2:persist-check` → fake model で turn 1 を送って終了 → 別プロセスで同じ conversationId に turn 2 → D1 store の `load` が history 4 件（開始時 2 件）を返すことを assert（`packages/bench/src/persist-check.ts`）。

### 本番 D1 への migration（このコンテナでは wrangler login が無いので Mac で）

```bash
pnpm db:migrate:remote     # = wrangler d1 migrations apply adult-ai-db --remote（0070_v2_tables が入る）
```

## M0 で意図的に残しとるもの（M1 へ）

- ~~TurnStore はインメモリ~~ → M1 で D1 版へ（上記）。`createMemoryTurnStore` はテスト・bench 用に残る。
- checkpointer は `MemorySaver`。`@langchain/langgraph-checkpoint-sqlite` は M1。
- `retrieve` ノードは空配列を返すだけ（RAG は後）。`ledger_update` はユーザー発話の先頭 60 字を `lastEvents` に積むだけ。
- LLM judge（env で任意）は未実装。決定的チェックのみ。
- チャット画面は chunk の XML をそのまま表示（タグ剥がし・吹き出し分けは後）。
- 画像（R2 / `.data/images/`）は未着手。
- 本番デプロイ先（Pages / Workers）は未決。`vite build` は通る。
