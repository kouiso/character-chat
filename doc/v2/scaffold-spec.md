# v2 scaffold spec（M-1 / M0）

作成 2026-09-03。局長承認の方針（2026-09-02/03）を、そのまま手を動かせる粒度まで落としたもの。
既存アプリ（`src/`, `functions/`）は一切触らん。同一リポジトリを pnpm monorepo 化し、`apps/v2` と `packages/*` を足す。

調べた事実（このコンテナで確認済み）:

| 項目 | 事実 |
|---|---|
| ベース | `main` 99cc3dc、`pnpm@9.15.0`、Node v22.22.2、`task` あり |
| root の主要 dev 依存（インストール済み） | wrangler 4.76.0 / vite 8.2.1 / vitest 4.1.2 / typescript 5.9.3 / drizzle-orm 0.45.2 / zod 4.3.6 / react 19.2.4 / @cloudflare/workers-types 4.20260317.1 |
| root `tsc -b` | `tsconfig.json` は references のみ（app / node / e2e）。`apps/`, `packages/` は include されん |
| root vitest include | `src/**`, `script/**`, `scripts/**`, `functions/**` のみ |
| root eslint | `eslint .` + `projectService`。`globalIgnores` に `apps/`, `packages/` は無い（足す） |
| pre-push | `.lefthook.yml` → `task ci:fast` = `pnpm lint` → `pnpm typecheck` → `pnpm test` |
| drizzle | `drizzle/*.sql` は 0069 まで（85 本、手書き多数）。`meta/_journal.json` は idx 64 で止まっとる → `drizzle-kit generate` は使わん |
| D1 ローカル | `wrangler d1 migrations apply adult-ai-db --local`（root `wrangler.toml`: database_id `b617800c-cf4c-4122-adbb-ce872a258da6`, migrations_dir `drizzle`）。永続先 `.wrangler/state/v3`。このコンテナには `.wrangler/` も `.dev.vars` も無い |
| wrangler `getPlatformProxy` の型（4.76.0 `wrangler-dist/cli.d.ts` L2572-2615） | `environment?`, `configPath?`, `envFiles?`, `persist?: boolean \| { path: string }`, `remoteBindings?: boolean`（既定 true）。返り値 `{ env, cf, ctx, caches, dispose }` |
| wrangler config schema | `d1_databases[].remote: boolean`, `migrations_dir`, `preview_database_id` あり。ローカルの DB 識別子は `preview_database_id ?? database_id ?? binding` |
| 既存の出力契約 | `<response><action>…</action><dialogue>…</dialogue><inner>…</inner></response>`（`src/lib/config.ts` L20） |
| 既存 XML パーサ・品質ガード | `src/lib/xml-response-parser.ts`, `src/lib/quality-guard.ts`（v2 では依存せず再実装。判定基準が「受動的」を落とす経路を持ち込まんため） |
| Workers AI 埋め込み | `script/rag/ingest.ts`: REST で `@cf/baai/bge-m3`、1024 次元 float32、BLOB は `Float32Array` の生バイト。M0 では使わん（M2 で `v2_memory.embedding` に同じ形式） |
| `no-injected-consent-framing.test.ts` | `SCANNED_DIRS = ["functions/api","src/lib"]`、`collectTsFiles` は `__tests__` と `*.test.ts` を除外して再帰 |

npm 最新（`npm view` 2026-09-03）:

| pkg | latest | 採用 | 理由 |
|---|---|---|---|
| @tanstack/react-start | 1.168.49 | `^1.168.49` | Start 本体。`@tanstack/react-router 1.170.32` に依存 |
| @tanstack/react-router | 1.170.32 | `^1.170.32` | Start と同じ minor を明示 |
| @langchain/langgraph | 1.4.13 | `^1.4.13` | peer: `@langchain/core ^1.1.48`, `zod ^3.25.32 \|\| ^4.2.0`。CJS/ESM 両出力 |
| @langchain/core | 1.2.9 | `^1.2.9` | 単一インスタンス化のため root `pnpm.overrides` にも書く |
| @langchain/openrouter | 0.4.11 | `^0.4.11` | `ChatOpenRouter`。peer `@langchain/core ^1.0.0` |
| @langchain/langgraph-checkpoint-sqlite | 1.0.4 | **M0 では入れん** | 依存 `better-sqlite3 ^12.10.0`（native build）。M0 は `MemorySaver`（`@langchain/langgraph` から export）。M1 で追加 |
| wrangler | 4.128.0 | `^4.76.0`（root と同じ） | 4.128 を足すと wrangler が 2 本になる。`getPlatformProxy` に必要な option は 4.76.0 に全部ある |
| drizzle-orm | 0.45.2 | `^0.45.2` | root と同一解決 |
| vite | 8.2.2 | `^8.2.1` | root と同一解決（Start peer `vite >=7`） |
| vitest | 4.1.11 | `^4.1.2` | root と同一解決 |
| jest | 30.5.1 | `^30.5.1` | engine の graph 統合テストのみ |
| @swc/jest / @swc/core | 0.2.39 / 1.16.1 | `^0.2.39` / `^1.16.1` | ts-jest（29.4.12、peer jest ^30 可）より速く型チェックはtscに任せる |
| @types/jest | 30.0.0 | `^30.0.0` | engine の `tsconfig.jest.json` だけが読む |
| @cloudflare/vite-plugin | 1.54.3 | **使わん** | peer `wrangler ^4.128.0`。M0 は Node dev server + `getPlatformProxy` |

---

## 1. ワークスペース配置

```
adult-ai-app/
├─ package.json                 root（既存アプリ + v2:* スクリプト追加）
├─ pnpm-workspace.yaml          新規
├─ eslint.config.js             globalIgnores に apps/ packages/ 追加
├─ eslint.v2.config.js          新規: v2 用（root の rules を再利用）
├─ vitest.config.ts             exclude に apps/** packages/** 追加
├─ drizzle/0070_v2_tables.sql   新規
├─ .gitignore                   .data/ .tanstack/ **/.output/ 追加
├─ apps/
│  └─ v2/                       @v2/app（TanStack Start）
│     ├─ package.json  tsconfig.json  vite.config.ts  wrangler.jsonc  .dev.vars(gitignored)
│     └─ src/
│        ├─ router.tsx  routeTree.gen.ts(生成物, lint 除外)
│        ├─ routes/__root.tsx  routes/index.tsx  routes/chat/$id.tsx  routes/api/chat/$id.ts
│        └─ server/engine.ts（graph singleton） server/sse.ts（SSE encoder）
└─ packages/
   ├─ tsconfig.base.json        共有
   ├─ db/       @v2/db      既存 src/schema/*.ts の再 export + v2_ スキーマ + D1 store
   ├─ cf/       @v2/cf      getPlatformProxy でローカル D1/R2 束縛
   ├─ prompt/   @v2/prompt  v0001.ts（不変）+ compose
   ├─ judge/    @v2/judge   chunk 分割 + 決定的判定
   ├─ engine/   @v2/engine  LangGraph turn graph（Jest）
   └─ bench/    @v2/bench   fake model で 1 ターン回す CLI（M0 最小）
```

各パッケージは **TS ソースを直接 export**（build 工程なし）: `"exports": { ".": { "types": "./src/index.ts", "default": "./src/index.ts" } }`。Vite / tsx / @swc/jest がそのまま食う。

### `pnpm-workspace.yaml`

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

---

## 2. 各 package.json

共通: `"private": true`, `"type": "module"`, `"sideEffects": false`。scripts は 3 本を全パッケージで揃える（`pnpm -r run typecheck|test|lint` が全部に当たるように）。

| name | dependencies | devDependencies | scripts |
|---|---|---|---|
| `@v2/app`（apps/v2） | `@tanstack/react-start ^1.168.49`, `@tanstack/react-router ^1.170.32`, `react ^19.2.4`, `react-dom ^19.2.4`, `@v2/engine workspace:*`, `@v2/cf workspace:*`, `@v2/db workspace:*`, `@v2/prompt workspace:*`, `@v2/judge workspace:*`, `@langchain/core ^1.2.9` | `vite ^8.2.1`, `@vitejs/plugin-react ^6.0.1`, `vitest ^4.1.2`, `typescript ~5.9.3`, `@types/react ^19.2.14`, `@types/react-dom ^19.2.3`, `@types/node ^24.12.0`, `@cloudflare/workers-types ^4.20260317.1` | `dev: vite dev --port 3100` / `build: vite build` / `typecheck: tsc -p tsconfig.json --noEmit` / `test: vitest run` / `lint: eslint --config ../../eslint.v2.config.js .` |
| `@v2/db` | `drizzle-orm ^0.45.2`, `zod ^4.3.6` | `typescript ~5.9.3`, `vitest ^4.1.2`, `@types/node ^24.12.0`, `@cloudflare/workers-types ^4.20260317.1` | 同上 3 本 |
| `@v2/cf` | `wrangler ^4.76.0` | `typescript`, `vitest`, `tsx ^4.21.0`, `@types/node`, `@cloudflare/workers-types` | 3 本 + `check: tsx src/check.ts`（`select count(*) from character`） |
| `@v2/prompt` | `zod ^4.3.6` | `typescript`, `vitest`, `@types/node` | 3 本 |
| `@v2/judge` | （なし） | `typescript`, `vitest`, `@types/node` | 3 本 |
| `@v2/engine` | `@langchain/langgraph ^1.4.13`, `@langchain/core ^1.2.9`, `@langchain/openrouter ^0.4.11`, `zod ^4.3.6`, `@v2/prompt workspace:*`, `@v2/judge workspace:*`, `@v2/db workspace:*` | `jest ^30.5.1`, `@swc/jest ^0.2.39`, `@swc/core ^1.16.1`, `@types/jest ^30.0.0`, `typescript`, `@types/node` | `typecheck: tsc -p tsconfig.json --noEmit && tsc -p tsconfig.jest.json --noEmit` / `test: jest` / `lint` |
| `@v2/bench` | `@v2/engine`, `@v2/judge`, `@v2/prompt`, `@langchain/core ^1.2.9` | `tsx ^4.21.0`, `typescript`, `vitest`, `@types/node` | 3 本 + `bench: tsx src/run.ts --fake` |

`@v2/engine` は `import.meta` を使わん（Jest を CJS 変換で回すため）。`@v2/cf` だけが `import.meta.url` で repo root を求める。engine は cf を import せん（DB は `TurnStore` interface で注入）。

---

## 3. tsconfig 方針

### `packages/tsconfig.base.json`

```json
{
  "compilerOptions": {
    "target": "ES2023", "lib": ["ES2023"], "module": "ESNext", "moduleResolution": "bundler",
    "strict": true, "noEmit": true, "skipLibCheck": true, "isolatedModules": true,
    "verbatimModuleSyntax": true, "moduleDetection": "force", "erasableSyntaxOnly": true,
    "noUnusedLocals": true, "noUnusedParameters": true, "noFallthroughCasesInSwitch": true,
    "noUncheckedSideEffectImports": true, "types": ["node"]
  }
}
```

| tsconfig | extends | 差分 | include |
|---|---|---|---|
| `packages/{db,cf,prompt,judge,bench}/tsconfig.json` | `../tsconfig.base.json` | cf/db: `"types": ["node","@cloudflare/workers-types"]` | `src`（vitest テストは `src/**/*.test.ts` に同居し、`types` に `vitest/globals` は入れん — `import { describe } from "vitest"` 明示） |
| `packages/db/tsconfig.json` | 同上 | 既存スキーマを直接 import するので | `src`, `../../src/schema/character.ts`, `../../src/schema/user.ts`, `../../src/schema/conversation.ts`, `../../src/schema/message.ts` |
| `packages/engine/tsconfig.json` | base | `"types": ["node"]` | `src` （`__tests__` を含まん） |
| `packages/engine/tsconfig.jest.json` | base | `"types": ["node","jest"]`, `"module": "ESNext"` | `__tests__`, `src`, `jest.config.ts` |
| `apps/v2/tsconfig.json` | `../../packages/tsconfig.base.json` | `"jsx": "react-jsx"`, `"lib": ["ES2023","DOM","DOM.Iterable"]`, `"types": ["vite/client","node","@cloudflare/workers-types"]` | `src`, `vite.config.ts` |

`@types/jest` と `vitest/globals` は別 tsconfig にしか現れんので衝突せん。engine の `test` は Jest のみ（vitest を engine に入れん）。

### `packages/engine/jest.config.ts`

```ts
import type { Config } from "jest";
const config: Config = {
  testEnvironment: "node",
  testMatch: ["<rootDir>/__tests__/**/*.test.ts"],
  transform: {
    "^.+\\.tsx?$": ["@swc/jest", { jsc: { target: "es2022", parser: { syntax: "typescript" } }, module: { type: "commonjs" } }],
  },
  // workspace の @v2/* は realpath が packages/*/src なので transformIgnorePatterns(node_modules) に当たらず変換される
};
export default config;
```

---

## 4. root への変更（M-1: 既存 CI を緑のまま保つ）

| ファイル | 変更 |
|---|---|
| `pnpm-workspace.yaml` | 新規（§1） |
| `package.json` scripts | `"v2:dev": "pnpm --filter @v2/app dev"`, `"v2:typecheck": "pnpm -r --filter \"./apps/**\" --filter \"./packages/**\" run typecheck"`, `"v2:test": "… run test"`, `"v2:lint": "… run lint"`, `"v2:ci": "pnpm v2:lint && pnpm v2:typecheck && pnpm v2:test"`, `"v2:db:check": "pnpm --filter @v2/cf check"`, `"v2:bench": "pnpm --filter @v2/bench bench"` |
| `package.json` pnpm.overrides | `"@langchain/core": "^1.2.9"` 追加（既存アプリは langchain 未使用なので影響なし） |
| `eslint.config.js` | `globalIgnores([...])` に `"apps/"`, `"packages/"`, `"eslint.v2.config.js"` を追加。他は触らん |
| `eslint.v2.config.js` | 新規。`import rootConfig from "./eslint.config.js"` して `ignores` のみのエントリ（globalIgnores）を除いた配列を再利用し、末尾に v2 用 ignores（`**/routeTree.gen.ts`, `**/.output/**`, `**/dist/**`, `**/node_modules/**`）と override（`apps/v2/vite.config.ts`, `packages/engine/jest.config.ts` の `import/no-default-export: off`; `packages/bench/**` と `packages/cf/src/check.ts` の `no-console: off`; `apps/v2/src/routes/**` の `react-refresh/only-export-components: off`）を足す。`projectService` は最寄り tsconfig.json を拾うので追加設定不要 |
| `vitest.config.ts` | `test.exclude: [...configDefaults.exclude, "apps/**", "packages/**"]`（include で既に外れとるが明示） |
| `functions/api/__tests__/no-injected-consent-framing.test.ts` | §9 |
| `.gitignore` | `.data/`, `.tanstack/`, `**/.output/` 追加（`.dev.vars*` は既存パターンが `apps/v2/.dev.vars` にも当たる） |
| `Taskfile.yml` | `ci:v2` タスク追加（`pnpm v2:ci`）。**`ci:fast` は変更せん** |
| `drizzle/0070_v2_tables.sql` | §5 |

root `tsc -b` / `vitest` / `eslint .` はいずれも `apps/`, `packages/` を見ん。`pnpm install` で lockfile に importers が増える（既存依存の解決は変わらん）。

---

## 5. `drizzle/0070_v2_tables.sql`

手書き。`_journal.json` は触らん。`wrangler d1 migrations apply` は `;` 区切りで実行するので `--> statement-breakpoint` は使わん。JSON は TEXT。時刻は既存踏襲で unix ms の INTEGER。

```sql
-- v2 リビルド用テーブル。既存テーブルは触らん。character への FK だけ既存へ張る。
-- user は M0 で認証を持たんので FK を張らず user_id は文字列のまま置く。
CREATE TABLE IF NOT EXISTS v2_conversation (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  character_id TEXT NOT NULL REFERENCES character(id),
  title TEXT NOT NULL DEFAULT '',
  thread_id TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS v2_conversation_user_updated_idx ON v2_conversation(user_id, updated_at);

CREATE TABLE IF NOT EXISTS v2_message (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES v2_conversation(id),
  turn INTEGER NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content TEXT NOT NULL,
  action TEXT,
  dialogue TEXT,
  inner TEXT,
  generation_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS v2_message_conv_turn_role_idx ON v2_message(conversation_id, turn, role);

CREATE TABLE IF NOT EXISTS v2_chunk (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES v2_message(id),
  seq INTEGER NOT NULL,
  text TEXT NOT NULL,
  judge_json TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS v2_chunk_message_seq_idx ON v2_chunk(message_id, seq);

CREATE TABLE IF NOT EXISTS v2_ledger (
  conversation_id TEXT NOT NULL REFERENCES v2_conversation(id),
  turn INTEGER NOT NULL,
  ledger_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (conversation_id, turn)
);

CREATE TABLE IF NOT EXISTS v2_generation (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES v2_conversation(id),
  turn INTEGER NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  system_prompt TEXT NOT NULL,
  request_json TEXT NOT NULL,
  raw_output TEXT,
  usage_json TEXT,
  latency_ms INTEGER,
  status TEXT NOT NULL CHECK (status IN ('ok','error','aborted')),
  error TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS v2_generation_conv_turn_idx ON v2_generation(conversation_id, turn);

CREATE TABLE IF NOT EXISTS v2_memory (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES v2_conversation(id),
  kind TEXT NOT NULL CHECK (kind IN ('fact','summary','preference')),
  content TEXT NOT NULL,
  source_turn INTEGER,
  embedding BLOB,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS v2_memory_conv_kind_idx ON v2_memory(conversation_id, kind);
```

| 列 | JSON の中身 |
|---|---|
| `v2_chunk.judge_json` | `{ ok: boolean, checks: { ngram: {ok, ratio}, voice: {ok, forbiddenPronoun?}, format: {ok, reason?}, empty: {ok} }, attempt }` |
| `v2_ledger.ledger_json` | `SceneLedger`（§6） |
| `v2_generation.request_json` | 送った `messages[]`（system 含まず。system は `system_prompt` 列） |
| `v2_generation.usage_json` | `{ promptTokens, completionTokens, costUsd? }` |
| `v2_memory.embedding` | M0 は NULL。M2 で bge-m3 1024 float32 の生バイト（`rag_chunk` と同形式） |

`@v2/db/src/v2-schema.ts` に同じ表を drizzle `sqliteTable` で宣言（`v2ConversationTable` 等、列名は SQL と一致させる）。`@v2/db/src/index.ts` は `characterTable`, `userTable`, `conversationTable`, `messageTable` を `../../../src/schema/<file>` から**ファイル単位で**再 export（`src/schema/index.ts` を経由すると `rag-chunk.ts` → `src/lib/scene-phase.ts` まで型解決が伸びるので避ける）。`@v2/db/src/client.ts`: `import { drizzle } from "drizzle-orm/d1"; export const createDb = (d1: D1Database) => drizzle(d1, { schema })`。`@v2/db/src/turn-store.ts`: `createD1TurnStore(db)` が engine の `TurnStore` を実装。

---

## 6. LangGraph（@v2/engine）M0

### State（`src/state.ts`, `StateSchema` + zod v4）

```ts
import { StateSchema, ReducedValue } from "@langchain/langgraph";
import { z } from "zod";

export type ScenePhase = "conversation" | "intimate" | "erotic" | "climax" | "afterglow";
export type SceneLedger = {
  phase: ScenePhase; location: string | null; time: string | null;
  present: string[]; clothing: Record<string, string>; position: string | null;
  lastEvents: string[]; // 最新 5 件
};
export type CharacterSheet = { id: string; name: string; systemPrompt: string; greeting: string };
export type HistoryMessage = { role: "user" | "assistant"; content: string };
export type ComposedPrompt = { version: "v0001"; system: string; messages: HistoryMessage[] };
export type JudgedChunk = { seq: number; text: string; judge: JudgeResult; attempt: number };

export const TurnState = new StateSchema({
  conversationId: z.string(),
  turn: z.number(),
  userText: z.string(),
  character: z.custom<CharacterSheet>(),
  history: z.array(z.custom<HistoryMessage>()).default(() => []),
  ledger: z.custom<SceneLedger>(),
  retrieved: z.array(z.string()).default(() => []),
  prompt: z.custom<ComposedPrompt>().nullable().default(null),
  raw: z.string().default(""),
  pendingChunks: z.array(z.string()).default(() => []),
  cursor: z.number().default(0),
  chunks: z.array(z.custom<JudgedChunk>()).default(() => []),   // 上書き（index 差し替えがあるので reducer は使わん）
  regenerated: z.boolean().default(false),
  generationId: z.string().nullable().default(null),
  events: new ReducedValue(z.array(z.custom<TurnEvent>()).default(() => []), { reducer: (a, b) => a.concat(b) }),
});
```

（`StateSchema` が Jest/CJS 変換で問題を出したら `Annotation.Root` に置換。両方 `@langchain/langgraph` 1.4 に export あり。）

### Node 一覧

| node | 入力→出力 | M0 の中身 |
|---|---|---|
| `intake` | userText, conversationId → history, ledger, turn | `TurnStore.load(conversationId)` で直近 20 メッセージと最新 ledger。無ければ turn=1、ledger は `phase: "conversation"`, 他 null/空 |
| `ledger_update` | ledger, userText → ledger | 決定的: `lastEvents` に `userText` 先頭 60 字を push（最新 5 件）。phase は据え置き。LLM なし |
| `retrieve` | → retrieved | `[]` を返す（M2 で bge-m3 検索） |
| `compose` | character, ledger, retrieved, history → prompt | `@v2/prompt` `composeV0001({ sheet, ledger, exemplar })`。3,000 字超なら throw |
| `generate` | prompt → raw, generationId | `model.stream([system, ...history, user])`。token ごとに `config.writer({ type: "token", text })`（暫定表示用）。全文を `raw` に |
| `chunk` | raw → pendingChunks, cursor=0 | `@v2/judge` `splitChunks(raw)` |
| `judge_chunk` | pendingChunks[cursor], chunks, 過去 20 chunk → chunks[cursor] | `judgeChunk(text, { previous: 直近 20 chunk のテキスト, voice: extractVoice(sheet) })` |
| `regenerate_chunk` | 失敗 chunk → pendingChunks[cursor], regenerated=true | 同じ prompt + 「ここまでの本文」+「次の段落だけ書き直す」指示で 1 回だけ再生成。出力を `pendingChunks[cursor]` に差し替え |
| `emit` | chunks[cursor] → events, cursor+1 | `config.writer({ type: "chunk", seq, text, judge })` |
| `persist` | 全状態 → — | `TurnStore.saveTurn(...)`: v2_conversation upsert / v2_message(user, assistant) / v2_chunk[] / v2_ledger / v2_generation。最後に `writer({ type: "done" })` |

### エッジ

```
START → intake → ledger_update → retrieve → compose → generate → chunk → judge_chunk
judge_chunk →(cond) ok または regenerated済み → emit
             (cond) ng かつ !regenerated → regenerate_chunk → judge_chunk
emit →(cond) cursor < pendingChunks.length → judge_chunk
       (cond) それ以外 → persist → END
```

（再生成は 1 ターン 1 回。2 回目の失敗は judge 結果を付けたまま emit する。判定基準に「受動的な反応」は入れん。）

### 依存注入（`src/graph.ts`）

```ts
export type TurnGraphDeps = {
  model: BaseChatModel;                  // 本番: createOpenRouterModel() / テスト: FakeListChatModel
  store: TurnStore;                      // 本番: createD1TurnStore(db) / テスト: createMemoryTurnStore()
  checkpointer?: BaseCheckpointSaver;    // 既定 new MemorySaver()
  now?: () => number; id?: () => string;
};
export const createTurnGraph = (deps: TurnGraphDeps) => new StateGraph(TurnState)…compile({ checkpointer });
export const runTurn = (graph, input, threadId) =>
  graph.stream(input, { streamMode: "custom", configurable: { thread_id: threadId } });   // AsyncIterable<TurnEvent>
```

`src/model.ts`:

```ts
export const createOpenRouterModel = (env: { OPENROUTER_API_KEY?: string; V2_MODEL?: string }) => {
  if (!env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY が未設定。apps/v2/.dev.vars に OPENROUTER_API_KEY=... を置く（CF_REMOTE=1 でも同じ）");
  }
  return new ChatOpenRouter({ model: env.V2_MODEL ?? "sao10k/l3.3-euryale-70b", apiKey: env.OPENROUTER_API_KEY, streaming: true });
};
```

テストの fake: `import { FakeListChatModel } from "@langchain/core/utils/testing"`（`responses: [xml]`、`_streamResponseChunks` で 1 文字ずつ流れる）。

`TurnEvent` = `{type:"token",text} | {type:"chunk",seq,text,judge,attempt} | {type:"done",conversationId,turn} | {type:"error",message}`。

---

## 7. @v2/prompt v0001

`src/v0001.ts` は **不変**（変更は v0002.ts を足す）。`Object.freeze`。

```ts
export const PROMPT_VERSION = "v0001" as const;
export const MAX_SYSTEM_CHARS = 3000;
export const composeV0001 = (input: { sheet: string; ledger: SceneLedger; exemplar: string }): string
```

| セクション | 内容 |
|---|---|
| 1 キャラシート | `character.system_prompt` を**そのまま**（改変・要約なし） |
| 2 場面台帳 | `[場面] 段階/場所/時刻/居る人/服装/体位/直近の出来事` を ledger から固定書式で 1 行ずつ |
| 3 出力契約 | `<response><action>ト書き：場所・動作・部位・感触・音を具体的に</action><dialogue>台詞</dialogue><inner>内心</inner></response>` を 1 応答 1 個。XML 以外を出さん。同じ表現を繰り返さん。場面を進める。18 歳未満を出さん |
| 4 例示 1 個 | `character.greeting` を `<dialogue>` に入れた 1 応答（キャラの声の例。action/inner は短い定型） |

肯定形で書く。ノルマ（「必ず N 文」）を書かん。合意・同意・セーフワード・境界・配慮の語を書かん（§9 のテストが見張る）。合計が 3,000 字を超えたら `Error("system prompt が 3000 字を超えた: N 字（sheet M 字）")`。

---

## 8. @v2/judge（決定的、M0）

| 関数 | 仕様 |
|---|---|
| `splitChunks(raw)` | `</action>`, `</dialogue>`, `</inner>` の直後、または空行（`\n\n`）で切る。タグの途中では切らん。trim して空は捨てる |
| `ngramCheck(text, previous: string[])` | 空白を潰した文字列の 8 文字 n-gram 集合。`previous`（直近 20 chunk）の集合との一致率 `ratio = |∩| / |chunk|`。`text.length >= 24 && ratio >= 0.30` で ng |
| `extractVoice(sheet)` | シートから正規表現で `一人称`, `二人称`, `語尾` を抜く（例: `一人称[はは:：]?\s*[「『]?([^」』、。\s]+)`、語尾は `「…」` 列挙）。見つからん項目は `null` |
| `voiceCheck(text, voice)` | `<dialogue>` 内に、シートの一人称と異なる一人称（私/わたし/あたし/俺/僕/うち/自分）が出たら ng。語尾はシートの列挙に 1 つも当たらん場合 `warn: true`（M0 は ng にせん） |
| `formatCheck(text)` | タグの開閉が揃う。`action/dialogue/inner/response` 以外のタグ無し。コードフェンス・`**`・`User:`/`Assistant:` 無し。ng の理由を返す |
| `emptyCheck(text)` | タグを剥がして trim が空なら ng |
| `judgeChunk(text, ctx)` | 上 4 つを束ねて `JudgeResult` |

LLM 判定は M0 では無し（`V2_JUDGE_LLM=1` の口だけ型に用意、実装は M1）。

---

## 9. `no-injected-consent-framing.test.ts` の拡張

```ts
import { existsSync, readFileSync, readdirSync } from "node:fs";
const SKIP_DIRS = new Set(["__tests__", "node_modules", "dist"]);
// collectTsFiles: entry.isDirectory() → SKIP_DIRS.has(entry.name) ? [] : 再帰
const SCANNED_DIRS = ["functions/api", "src/lib", "packages/prompt/src", "packages/engine/src"] as const;
// readRouteSource: SCANNED_DIRS.filter((dir) => existsSync(path.join(ROOT, dir))) してから走査
```

追加アサーション（v2 だけを対象に別途走査）: `packages/prompt/src` と `packages/engine/src` の本文に `合意` `同意` `セーフワード` `境界` `consent` `safeword` を含まん。

---

## 10. TanStack Start（apps/v2）M0

### `vite.config.ts`

```ts
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";
export default defineConfig({ plugins: [tanstackStart(), viteReact()] });   // 順序: Start → React
```

### `wrangler.jsonc`

```jsonc
{
  "$schema": "../../node_modules/wrangler/config-schema.json",
  "name": "adult-ai-v2",
  "compatibility_date": "2025-01-01",
  "d1_databases": [{
    "binding": "DB", "database_name": "adult-ai-db",
    "database_id": "b617800c-cf4c-4122-adbb-ce872a258da6",
    "preview_database_id": "b617800c-cf4c-4122-adbb-ce872a258da6",
    "migrations_dir": "../../drizzle"
  }],
  "r2_buckets": [{ "binding": "BUCKET", "bucket_name": "adult-ai-images" }],
  "env": {
    "remote": {
      "d1_databases": [{ "binding": "DB", "database_name": "adult-ai-db",
        "database_id": "b617800c-cf4c-4122-adbb-ce872a258da6", "remote": true }],
      "r2_buckets": [{ "binding": "BUCKET", "bucket_name": "adult-ai-images", "remote": true }]
    }
  }
}
```

ローカル D1 の識別子は `preview_database_id ?? database_id ?? binding` なので root `wrangler.toml` と同じ UUID を置けば、`.wrangler/state/v3/d1/miniflare-D1DatabaseObject/` 配下の同じ sqlite を共有する。マイグレーションは今までどおり root の `pnpm db:migrate:local` で流す（`migrations_dir` は参照用に合わせとく）。

### ルート

| ファイル | 役割 |
|---|---|
| `src/router.tsx` | `export const getRouter = () => createRouter({ routeTree, scrollRestoration: true })` |
| `src/routes/__root.tsx` | `createRootRoute({ head, shellComponent })`。`HeadContent`/`Scripts`/`Outlet` |
| `src/routes/index.tsx` | `loader: () => listCharacters()`（`createServerFn({ method: "GET" }).handler(...)` が `@v2/cf` の D1 から `select id,name,avatar from character order by display_order, created_at`）。`/chat/$id` への `Link` 一覧 |
| `src/routes/chat/$id.tsx` | 画面。`loader` で character（server fn）。入力 → `fetch("/api/chat/"+id, { method: "POST", body: JSON.stringify({ conversationId, text }) })` → `response.body` を `ReadableStream` で読み SSE を自前パース（`EventSource` は POST 不可）。`token` は暫定表示、`chunk` で確定置換、`done` で conversationId を保持 |
| `src/routes/api/chat/$id.ts` | `createFileRoute("/api/chat/$id")({ server: { handlers: { POST: async ({ request, params }) => … } } })`。engine/cf を import するのはこのファイルと `src/server/*` だけ（サーバ専用依存をクライアントバンドルから確実に切るため、画面ファイルと分ける） |
| `src/server/engine.ts` | `getTurnGraph()` singleton: `const { env } = await getCfEnv(); createTurnGraph({ model: createOpenRouterModel(env), store: createD1TurnStore(createDb(env.DB)) })`。`V2_FAKE_MODEL=1` なら `FakeListChatModel` |
| `src/server/sse.ts` | `TurnEvent` → `event: <type>\ndata: <json>\n\n` を書く `ReadableStream`。`Response` ヘッダ `content-type: text/event-stream`, `cache-control: no-cache`, `x-accel-buffering: no` |

POST body zod: `{ conversationId?: string; text: string(min 1, max 4000) }`。conversationId 無しなら新規（`crypto.randomUUID()`、thread_id = conversationId）。

---

## 11. @v2/cf

```ts
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPlatformProxy, type PlatformProxy } from "wrangler";

export type CfEnv = { DB: D1Database; BUCKET: R2Bucket; OPENROUTER_API_KEY?: string; V2_MODEL?: string };
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const remote = process.env.CF_REMOTE === "1";
let proxy: Promise<PlatformProxy<CfEnv>> | null = null;

export const getCfEnv = (): Promise<PlatformProxy<CfEnv>> =>
  (proxy ??= getPlatformProxy<CfEnv>({
    configPath: path.join(REPO_ROOT, "apps/v2/wrangler.jsonc"),
    persist: { path: path.join(REPO_ROOT, ".wrangler/state/v3") },
    remoteBindings: remote,                       // 既定は明示的に false
    environment: remote ? "remote" : undefined,   // env.remote に remote:true の束縛
  }));
```

- option 名は installed wrangler 4.76.0 の `GetPlatformProxyOptions`（`configPath`, `persist: boolean | {path}`, `remoteBindings`, `environment`）と一致（確認済み）。
- `.dev.vars` は config と同じディレクトリ（`apps/v2/.dev.vars`）から `env` に載る。`OPENROUTER_API_KEY` はそこから取る。
- `CF_REMOTE=1` は Mac 専用（`wrangler login` 済みが前提）。CI・このコンテナは常にローカル。
- `src/check.ts`: `const { env, dispose } = await getCfEnv(); const r = await env.DB.prepare("select count(*) as n from character").first<{ n: number }>(); console.log(r); await dispose();`

---

## 12. M0 起動手順（1 コマンドに寄せる）

```
pnpm install
pnpm db:migrate:local          # root。0070 も入る。ローカル D1 が空なら pnpm db:seed
pnpm v2:db:check               # {"n": N} が出る
pnpm v2:dev                    # http://localhost:3100  （Start + engine は同一プロセス）
```

- OpenRouter 実行: `apps/v2/.dev.vars` に `OPENROUTER_API_KEY=…` → `/chat/<id>` で 1 ターン。
- キー無し: 起動はする。POST 時に `OPENROUTER_API_KEY が未設定…` を SSE `error` イベントで返し、サーバログにも出る。
- このコンテナでの代替検証: `V2_FAKE_MODEL=1 pnpm v2:dev` で fake model が固定 XML を流し、SSE が `token→chunk→done` の順で届くことを `curl -N -X POST localhost:3100/api/chat/<id> -d '{"text":"こんにちは"}'` で確認。

---

## 13. 検証コマンド（パッケージごと）

| 対象 | コマンド | 期待 |
|---|---|---|
| M-1 既存 CI | `cd /workspace/adult-ai-app-v2 && NODE_OPTIONS=--experimental-sqlite task ci:fast` | 緑（lint/typecheck/test とも `apps/`, `packages/` を触らん） |
| M-1 root eslint が無視しとる | `pnpm exec eslint --debug apps packages 2>&1 \| grep -c "Ignored"` または `pnpm lint`（apps/ を lint せん） | 0 件の lint 対象 |
| root vitest が拾わん | `pnpm test -- --reporter=verbose 2>&1 \| grep -c "packages/"` | 0 |
| ワークスペース全体 | `pnpm v2:ci` | 緑 |
| @v2/db | `pnpm --filter @v2/db typecheck && pnpm --filter @v2/db test`（テスト: `node:sqlite` で 0070 の DDL を流し `v2ConversationTable` の列名が PRAGMA と一致） | 緑 |
| @v2/cf | `pnpm v2:db:check` | `{ n: <数> }`。マイグレーション前なら `no such table` を明示エラー |
| @v2/prompt | `pnpm --filter @v2/prompt test`（3,000 字超で throw／合意系語彙を含まん／セクション順） | 緑 |
| @v2/judge | `pnpm --filter @v2/judge test`（分割・n-gram・voice・format の表駆動） | 緑 |
| @v2/engine | `pnpm --filter @v2/engine test`（Jest: fake model + memory store で `token* → chunk+ → done`、失敗 chunk で `regenerate_chunk` が 1 回だけ走る、persist が store に 6 種書く） | 緑 |
| @v2/engine 型 | `pnpm --filter @v2/engine typecheck` | 2 つの tsconfig とも 0 エラー |
| @v2/app | `pnpm --filter @v2/app typecheck && pnpm --filter @v2/app build` | `.output/` 生成 |
| @v2/app SSE | `V2_FAKE_MODEL=1 pnpm v2:dev &` → `curl -N -X POST -H 'content-type: application/json' localhost:3100/api/chat/<char-id> -d '{"text":"こんにちは"}'` | `event: token` … `event: chunk` … `event: done` |
| @v2/bench | `pnpm v2:bench` | fake model 1 ターンの judge 集計を stdout に |
| ガード | `pnpm test -- functions/api/__tests__/no-injected-consent-framing.test.ts` | 緑。`packages/prompt/src/v0001.ts` に「合意」を書き足すと赤 |

---

## 14. 未決・要確認

1. `character.system_prompt` の実長。3,000 字の上限にシート原文が入らんキャラがあるなら、上限の扱い（シートは原文のまま・上限をシート除外で数える等）を決める必要がある。計測: `pnpm exec wrangler d1 execute adult-ai-db --local --command "select id, length(system_prompt) as n from character order by n desc limit 10"`。
2. `StateSchema`（zod v4）を @swc/jest の CJS 変換で通した実績が無い。落ちたら `Annotation.Root` へ置換（設計は同じ）。
3. `@langchain/langgraph-checkpoint-sqlite`（better-sqlite3 native）は M1 で入れる。M0 は `MemorySaver` なのでプロセス再起動で thread は消える（DB 側の履歴は残る）。
4. `getPlatformProxy` を Vite dev のサーバプロセスで 1 回だけ起こす singleton は、Vite の SSR モジュール再評価（HMR）で二重起動しうる。`globalThis` にキャッシュを置いて回避する想定。
5. Cloudflare へのデプロイ（`@cloudflare/vite-plugin`, wrangler 4.128 系）は M0 の範囲外。root wrangler 4.76 との共存方針はその時に決める。
