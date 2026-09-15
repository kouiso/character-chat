# バグ報告 — リファクタリング開始前（2026-08-09）

局長指示による「リファクタリング**開始前**のバグ出し」。
このリポジトリのコードを **1行も変更していない時点** で確認した不具合を記録する。

すべて自分で再現手順を踏んで確認済み。推測・未確認のものは含めない。
確認していないものは「未確認」と明記する。

- 対象コミット: `9da5447`（`origin/main` と同一）
- 調査範囲: `src/` `functions/` `.github/` `drizzle/` `script/` `scripts/` 設定ファイル一式
- 規模: 71,797 行 / 541 TS ファイル

---

## 総評

**このコードベースは「型が汚い」のではなく「構造が壊れている」。**

型安全は極めて良好で、本番コードに `any` は **0件**、`@ts-ignore` も **0件**。
Zod がほぼ全ての境界を検証しており、テストも 202 ファイルある。ここは素直に良い。

問題は 3 つに集中している。

1. **安全網が静かに壊れている** — 動いていないゲートが4つある（B1〜B4）。
   「CI がグリーンだから安全」という前提そのものが成立していない。
2. **死んだコードが本番に混ざっている** — 到達不能なコード約2,500行に加え、
   **ハードコードのモック画面が本番URLで配信されている**（B7）。
3. **god モジュール** — 2ファイルで backend 本番コードの 74%。

---

## Aランク — 安全網が動いていない

「テストが通った」を根拠に完了判断ができない状態。**リファクタ前に必ず直す必要がある。**

### B1. 依存脆弱性スキャンが PR で一度も動いていない

`/.github/workflows/security-audit.yml:6`

```yaml
    paths:
      - \"pnpm-lock.yaml\"
```

YAML にリテラルのバックスラッシュ + クォートが入っている。`cat -A` で
`- \ " p n p m - l o c k . y a m l \ "` というバイト列を確認済み。

YAML はこれをプレーンスカラー文字列 `\"pnpm-lock.yaml\"` として解釈するため、
**どのパスにも一致せず、PR では一度もトリガーされていない。**
`audit-ci.jsonc` の `high: true, critical: true` ゲートは事実上無効。

**影響**: 依存の既知脆弱性が野放し。`workflow_dispatch` の手動実行のみ有効。

---

### B2. JWT 認証のテストが実行されていない

`/vitest.config.ts:20-25`

```js
include: [
  "src/**/*.test.{ts,tsx}",
  "script/**/*.test.ts",
  "scripts/**/*.test.ts",
  "functions/api/__tests__/**/*.test.ts",   // ← lib/ 直下に一致しない
],
```

以下の2ファイルはどの glob にも一致せず、**vitest に収集されていない**。

- `functions/api/lib/app-jwt.test.ts` — **JWT 検証のテスト**
- `functions/api/lib/openrouter-provider-routing.test.ts`

**影響**: 認証まわりのテストが「存在するのに走っていない」。`find` では 202 件に数えられるため、
テスト数を見ても気づけない。

---

### B3. カバレッジ閾値が一度も実行されていない

`/vitest.config.ts:39-45` に閾値 70/70/60/70 が定義されている。しかし
`.github/workflows/` `.lefthook.yml` `Taskfile.yml` を `coverage` で grep しても **0件**。

CI が実行するのは `pnpm run test`（= `vitest run`）のみで、閾値は評価されない。
`test:coverage` は手動スクリプト。

さらに `coverage.include` は `src/lib/**` `src/store/**` `functions/api/lib/**` のみで、
**`functions/api/[[route]].ts`（5,097行・86エンドポイント）が計測対象外**。
UI（`src/component/**`）も丸ごと対象外。

**影響**: 70% という数字が実態を表していない。

---

### B4. 哲学ガードが分割で静かに無効化される（最重要）

`/functions/api/__tests__/no-injected-consent-framing.test.ts:17`

```js
readSource("functions/api/[[route]].ts") + readSource("functions/api/lib/route-context.ts");
```

`prompt/instructions/no-injected-ai-filter.md` の「合意・同意・境界といった枠を
プロンプトへ足さない」を守るための機械ガード。**ファイルパスを直接読んでいる。**

`route-context.ts` を分割すると、**移動先のファイルをこのガードは見なくなる**。
テストは通り続けるので、保護が外れたことに気づけない。
このリポジトリが過去に踏んだ「6週間気づかれなかった」型の事故と同じ構造。

**影響**: リファクタの副作用でプロダクトの存在理由に関わるガードが失われる。
**分割前にディレクトリ走査型へ直す必要がある。**

---

## Bランク — ユーザーに見える不具合

### B7. 本番URLでハードコードのモック画面が配信されている

`/src/component/ouse/chatscope-talk.tsx`

```js
const SENDER_BOT = "Sakura";
const INITIAL_MESSAGES: MockMessage[] = [
  { id: "1", role: "assistant", text: "こんにちは。今日はどんな話がしたい？" },
  ...
];
// 送信すると必ずこれが返る
{ id: `${Date.now()}-bot`, text: "うん、わかった。続けて。" }
```

到達経路を確認済み:

- `src/lib/app-route.ts:22` — `| { page: "chatscope" }`
- `src/lib/app-route.ts:64` — `chatscope: "/chatscope"`
- `src/component/ouse/ou-app.tsx` — `centerScreen === "chatscope"` で `<ChatscopeTalk />` を描画

**`/chatscope` にアクセスすると、実在しないキャラ "Sakura" が定型文だけを返す画面が出る。**
実験用プロトタイプが本番に残っている。

---

### B6. 返信設定の4つのトグルが完全に無反応

`/src/component/ouse/ou-reply-settings-sheet.tsx`

ユーザーが操作できる `photoMix` / `photoFrequency` / `receiveVideo` / `textOnly` を
`useCharacterSettingsStore` へ書き込んでいる。しかし **読み手が存在しない。**

`grep` 結果（シート自身とストア定義以外に出現しない）:

| 設定 | 出現箇所 | 読み手 |
|---|---|---|
| `photoMix` | シート3 + ストア2 | **0** |
| `photoFrequency` | シート2 + ストア2 | **0** |
| `receiveVideo` | シート2 + ストア2 | **0** |
| `textOnly` | シート2 + ストア2 | **0** |

送信経路は per-character ではなくグローバルの `useSettingsStore` を読んでいる
（`ou-app.tsx:903-904`）。

**影響**: ユーザーがトグルを操作しても何も起きない。設定できているように見えるのが特に悪い。

---

### B5. 「全会話削除」後もメッセージキャッシュが24時間残る

`/src/hook/use-chat-query.ts:81`

```js
queryClient.removeQueries({ queryKey: ["conversationMessages"] });
```

実際のキーは `/src/lib/query-key.ts:3-4`:

```js
conversationMessageList: (conversationId) => ["conversation-message-list", conversationId]
```

**キーが一致しないため `removeQueries` は完全な no-op。**
コードベース全体でここだけが `queryKey` ファクトリを使わず文字列リテラルを直書きしている。

キャッシュは Dexie に永続化され `maxAge: 24h`（`main.tsx`）なので、
**会話を全削除してもメッセージ本文が端末に24時間残る。** プライバシー影響あり。

---

### B15. 動画の月次予算上限が機能していない

- `/src/store/settings-store.ts:31` — `videoMonthlyBudgetUsd` を保持、`settings-panel.tsx:394` で設定可能
- `/src/lib/video-monthly-spend.ts` — 支出台帳の読み書きモジュール。**import 元 0件**

上限を強制するコードが存在しない。**予算を設定しても効かない。** 課金に直結。

同ファイル群で `videoModel`（`settings-store.ts:57`）は永続化されているが
`setVideoModel` が存在せず、永久に既定値のまま。

---

### B16. 発火しない分岐

`/src/component/ouse/ou-app.tsx:92` `readSubCharacter` が
`solo-sub-character:{convId}` を localStorage から読むが、**このキーへの書き手が
`src/` 全体に存在しない**。結果 `appendSubCharacterPrompt`（`:101`）は永久に発火しない。

---

### B8. 存在しないAPIをクライアントが呼んでいる（契約ドリフト）

`/src/lib/api.ts:1596,1605,1616` が呼ぶエンドポイント:

- `GET /api/characters/:id/outfits`
- `POST /api/characters/:id/outfits`
- `DELETE /api/characters/:id/outfits/:outfitId`

**`functions/` 側に該当ルートが存在しない**（`outfits` の grep ヒットは無関係なローカル変数2件のみ）。
かつ `getCharacterOutfits` / `createCharacterOutfit` / `deleteCharacterOutfit` は
**UI からの呼び出し元も0件**。

**影響**: 幻のAPIを叩く死んだクライアントコード。サーバとクライアントで Zod スキーマを
独立に約35本ずつ書いているため、型で検出できない。

---

## Cランク — セキュリティ / 堅牢性

### B10. Workers isolate 上のモジュールグローバル可変状態

`/functions/api/lib/route-context.ts:406`

```js
export const phaseTagHistoryCache = new Map<string, string[]>();
```

Cloudflare Workers の isolate は複数リクエスト・複数ユーザーで再利用される。
**リクエスト間・ユーザー間で状態が漏れる。** キーは無制限に増え続ける（キーごとの
履歴長は `PHASE_TAG_HISTORY_MAX = 4` で制限されるが、キー自体の増加に上限が無い）。

---

### B11. クライアント供給ヘッダが認証判断に混入

`/functions/api/lib/route-context.ts:1770-1802`

```js
if (isLocalhostRequest(c.req.header("Host"))) {
  return LOCAL_USER_EMAIL;   // = "sukererion@gmail.com"
}
```

`Host` ヘッダを見て本人と判定している。

**実効リスクは低い** — Cloudflare はホスト名でルーティングするため、本番ドメインへの
リクエストで `Host: localhost` を通すのは容易ではなく、加えて `_middleware` の
サイト全体 Basic ゲートがある。**単一運用者アプリなので現時点の実害は想定しにくい。**

ただしクライアント供給ヘッダを認証判断に使う設計自体は残すべきでない。

---

### B9. アバターURL正規化の複製にガードが無い

| 実装 | パストラバーサル(`..`)ガード | 拡張子ガード |
|---|---|---|
| `/src/lib/avatar-url.ts:10` `resolveAvatarSrc`（正） | あり | あり |
| `/src/component/chat/message-bubble.tsx:102` | **なし** | **なし** |
| `/src/component/share/shared-conversation-view.tsx:76` | **なし** | **なし** |

`shared-conversation-view.tsx:76` には「message-bubble と同じ正規化を行う」というコメントがあり、
**複製が意図的**。しかし正の実装が持つガードが写されていない。

---

## Dランク — ビルド / インフラ整合性

### B12. `main` への直 push で CI が全て skip される

`/.github/workflows/ci.yml` は `push: branches: [main]` を持つが、全ジョブに
`if: github.event.pull_request.draft == false` が付いている。
`push` イベントでは `github.event.pull_request` が `null` のため条件が falsy になり、
**`ci` マトリクス・`e2e`・`boot-smoke` が全て skip される。**
`push: branches:[main]` トリガーは事実上機能していない。

### B13. 本番マイグレーション経路でD1名が不一致

| 場所 | DB名 |
|---|---|
| `Taskfile.yml:260`（本番適用） | `DB` |
| `Taskfile.yml:149` | `adult-ai-db` |
| `package.json:39` `db:migrate:remote` | `adult-ai-db` |

同一操作に対して2つの識別子が混在している。

### B14. デプロイ準備ジョブが非サポートNodeで動いている

`/.github/workflows/pages-deploy-readiness.yml:20` が `node-version: 20`。
`package.json:9` は `"node": ">=22"` を要求し、他の全ワークフローは 22。

### B17. drizzle のジャーナルが破損

- `drizzle/*.sql` は **72本**、`drizzle/meta/_journal.json` のエントリは **21件**
- 順序も破損（`...0012 → 0032 → 0053 → 0016 → 0017 → 0057 → 0058 → 0020` で終わる）
- ファイル名の番号重複: `0002`×2, `0015`×2, **`0016`×3**, `0017`×2, `0020`×2, `0021`×2,
  `0022`×2, `0032`×2, `0033`×2, `0041`×2, **`0047`×3**, `0048`×2。`0037` `0038` は欠番

本番適用は `wrangler d1 migrations apply` がファイル名順で行うため**現在は動いている**。
問題は `AGENTS.md:49` が推奨する `pnpm db:generate`（drizzle-kit）で、
**50マイグレーション分古いスナップショットとの差分を生成してしまう。**

**修正調査（2026-08-09、#1238 リファクタ中）**: `_journal.json` を欠落エントリ51件込みで
手動再構築しようとしたが、正しい適用順を復元する信頼できる根拠が無いことが判明した。
`git log`（`--follow` 無し）でファイルごとの最古コミット日時を見ると、大半の旧マイグレーションが
同一タイムスタンプ（`2026-08-05 09:35:20`、リポジトリ履歴の一括インポート/圧縮時点）に
集まっており、真の作成順を git 履歴からは判別できない。番号順に頼るのも、この壊れた番号体系
そのものが問題の原因なので使えない。

**次にやるなら**: 各マイグレーション SQL の内容（`ALTER TABLE` が参照する列/テーブルが
どのマイグレーションで作られたか）からトポロジカルソートで真の依存順を復元する必要がある。
タイムスタンプに頼る方法では直せない。ファイル名のリネームは本番の `d1_migrations`
追跡テーブルと食い違うリスクがあるため、**リネームせず `_journal.json` の `idx`/`tag` のみを
直す**方針が安全（本番適用はファイル名順で既に正しく動いているため）。

---

## 死んだコード（本番到達不能）

削除候補。すべて本番呼び出し元 0件を grep で確認済み。

| 対象 | 規模 |
|---|---|
| `functions/api/lib/{chat-graph,graph,rag}/**` + `model-router.ts` + `xml-gate.ts` ほか | 本番 ~1,100行 + テスト ~600行 |
| テストだけが生かしている `src/` モジュール 13件 | ~800行 + テスト ~740行 |
| 未使用の本番依存 5件（`@ai-sdk/openai` `ai` `@supabase/supabase-js` `drizzle-zod` `next-themes`） | — |
| 死んだコンポーネント（`user-menu` `talk-surface` `ou-video-player` `input-bar` ほか） | — |
| `functions/api/d1-chunk.ts`（`lib/db-chunk.ts` と重複、本番未使用） | 14行 |

`runChatGraph` の本番呼び出し元は0件。グラフベースのチャットパイプラインが丸ごと未接続。

**ドキュメントとの乖離**: `CLAUDE.md` / `AGENTS.md` は技術スタックに
「AI SDK: Vercel AI SDK」と書いているが、`ai` / `@ai-sdk/openai` の import は **0件**。
「Local DB: Dexie (IndexedDB)」も実際は react-query の永続化バックエンドとしてのみ使用。

---

## 構造的負債（バグではないが再発の温床）

| 項目 | 実測 |
|---|---|
| `functions/api/lib/route-context.ts` | **7,468行 / 468 export**。35の無関係な責務が同居 |
| `functions/api/[[route]].ts` | **5,097行 / 86エンドポイント**。`POST /chat` 620行、`POST /image` 570行 |
| 上位2ファイル | backend 本番コードの **74%** |
| `functions/` → `src/` の深い相対 import | **52箇所 / 19モジュール**（共有境界が無い） |
| `getUserEmail` の重複 | **69回** |
| `drizzle(c.env.DB)` の重複 | **64回** |
| アドホックなエラー応答 `c.json({error},N)` | **228個**。`not_found` / `not found` / `character not found` が混在 |
| `src/component/ouse/ou-app.tsx` | 1,944行。`StageBodyProps` が **56フィールド** |
| HTTPレベルでテストされているエンドポイント | **86中12** |

`ou-app.tsx` には「ESLint の complexity 上限を避けるため」という趣旨のコメントが **7箇所**ある。
指標を回避するためにコードが歪められており、`eslint.config.js:238-242` は
`functions/**` に対して `complexity` を丸ごと無効化している。これが
`POST /chat` 620行を許した直接の原因。

型の契約が嘘をついている例: `ou-app.tsx:338` が `handleImageClick` を必須 prop として
型宣言しながら、`:1847` で `() => {}` を渡し、`:666` で実装を影武者として再定義している。

---

## 未確認（このバグ出しに含めないもの）

正直に書く。以下は**まだ確認していない**。

- **UI/UX の実機確認** — 画面の見た目・操作感・レイアウト崩れ・a11y は未検証。
  ブラウザでの動作確認をこれから実施する
- 本番環境での再現確認（本レポートは静的解析とコード読解に基づく）
- パフォーマンス（バンドルサイズ、レンダリング）

UI/UX バグの洗い出しは継続中。追加分は本ファイルへ追記する。
