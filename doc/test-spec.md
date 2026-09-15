# テスト仕様書

対象コミット: `chore/tech-debt-refactor`（`origin/chore/tech-debt-refactor` と同一）
調査範囲: `functions/api/**`（Hono メインルーター・lib・`routes/` 配下10本のサブルーター）、
`functions/api/__tests__/**`、`src/component/ouse/**`（メイン画面群）、`vitest.config.ts`

本書はエンドポイント一覧・画面一覧・受け入れ基準・AIキャラ能力の非退行確認手順・
現状のカバレッジ実測値・既知の未カバー領域をまとめたテスト仕様書である。

---

## 検出した問題

漫画生成・AI動画生成機能は「フロント/バックエンドとも完全削除済み」との前提で調査したが、
`functions/` 配下には comic/video の参照は無かった一方、**`src/` 側に video 関連の
削除し損ないが3件見つかった**。バグとしてここに記録する（回避はしていない）。

> **追記**: 下記2・3（`video-action-button.tsx`、`.ou-video-layer` CSS）と、
> `settings-panel.tsx` の「人のいる場所では、写真も動画もそっとぼかす」という
> レンダリング済み文言（このリストには無いが同時に発見）は本PR内で修正済み。
> 1（`message.ts` の死にカラム6個）は D1 スキーマ変更を伴うため、リファクタと
> 同時にランタイム影響のある変更を避ける方針から本PRでは対応せず未着手のまま残す。

1. **`src/schema/message.ts:31-36`** — D1 の `message` テーブル定義に
   `videoUrl` / `videoKey` / `videoPrompt` / `videoModel` / `videoStatus` / `videoTaskId`
   の6カラムが残っている。バックエンドのどのルートもこれらのカラムを読み書きしていない
   （`functions/` 配下を `comic|video` で全文検索してもヒット0件）ため、完全な死にカラム。
   D1 マイグレーションは追記専用なので過去のカラム自体は消せないが、Drizzle スキーマ定義
   側からは削除できるはずで、されていない。
2. **`src/component/ouse/video-action-button.tsx`** — 「動画化」ボタンの React コンポーネント
   一式（`VideoActionButton`、`aria-label="動画化"`）がまるごと残っている。
   `grep -r "VideoActionButton" src/` はこのファイル自身以外にヒットせず、**どこからも
   import されていない孤立コンポーネント**。
3. **`src/component/ouse/ouse.css:415-416`** — `.ou-video-layer`（「動画の再生UI」）という
   CSS ブロックが残っている。対応する `ou-video-layer` を使う tsx は存在せず、これも孤立。

漫画機能（`comicTable` 等）は `src/schema/index.ts` から完全に消えており、
過去の `drizzle/0006_comic.sql` `drizzle/0046_comic_series.sql` はマイグレーション履歴として
残るのみで実害はない。video 側だけ Drizzle スキーマとフロントの掃除が漏れている。

**推奨対応**（本タスクの範囲外だが記録しておく）: `videoUrl` 等6カラムを `message.ts` から
削除する Drizzle マイグレーションを1本追加し、`video-action-button.tsx` と
`.ou-video-layer` ブロックを削除する。

---

## 1. バックエンド API 一覧

`functions/api/[[route]].ts`（メインルーター、`basePath("/api")`、2,253行）と
`functions/api/routes/*.ts`（サブルーター10本: `admin` `auth` `avatar` `characters`
`conversations` `groups` `images` `memory` `scene-bookmarks` `share`）を全量読んで
洗い出した。全65本。ルーター分割によるエンドポイントの増減は無く（本書初版と同じ65本）、
変わったのは**どのファイルに定義されているか**だけである。

サブルーターのマウントには2種類あり、実効パスの決まり方が違う。ここを取り違えると
一覧そのものが嘘になるので、`[[route]].ts` の `.route(...)` 呼び出しを基準にする。

| マウント | サブルーター | 実効パスの決まり方 |
|---|---|---|
| `.route("/", …)` | `auth` `avatar` `characters` `conversations` `images` `share` | サブルーター側のリテラルパスがそのまま `/api` 直下に付く（例: `characters.ts` の `/characters/:characterId` → `/api/characters/:characterId`） |
| `.route("/memory-notes", …)` | `memory` | 接頭辞が前置される（`/` → `/api/memory-notes`、`/:noteId` → `/api/memory-notes/:noteId`） |
| `.route("/scene-bookmarks", …)` | `scene-bookmarks` | 同上（`/` → `/api/scene-bookmarks`、`/:id` → `/api/scene-bookmarks/:id`） |
| `.route("/groups", …)` | `groups` | 同上（`/` → `/api/groups`、`/:id/messages` → `/api/groups/:id/messages`） |
| `app.route("/admin", …)` | `admin` | 同上。`basePath("/api")` 済みの `app` へ後付けするので `/api/admin/...` |

認証は原則 `getUserEmail(c)` による Cookie/JWT/Basic 認証で、
未認証は一律 `401 { error: "unauthorized" }`。以降の表では「認証」列に △ がある行だけ
認証方式が異なる（公開 or 別方式）ことを示す。「定義」列は実装ファイル
（`functions/api/` からの相対パス）で、パスのパラメータ名は実装どおりに書いてある。

### 1.1 認証・セッション（すべて `routes/auth.ts`、`.route("/", …)` マウント）

| Method | Path | 認証 | リクエスト | 成功 | エラー |
|---|---|---|---|---|---|
| GET | `/api/me` | 必須 | - | `{ email, logoutUrl, isLocal }` | 401 |
| POST | `/api/auth/basic-login` | △公開（Basic認証ヘッダ） | form: username/password | Cookie発行 + 303 or JSON `{token,email}` | 401 login failed / 503 signing_key_not_configured |
| POST | `/api/auth/session` | 必須 | - | `{ token, expiresAt }`（90日JWT再発行） | 401 / 503 |

### 1.2 会話（conversations）

| Method | Path | 認証 | リクエスト | 成功 | エラー | 定義 |
|---|---|---|---|---|---|---|
| GET | `/api/conversations` | 必須 | - | `{ conversations[] }`（キャラJOIN・最新assistant発言プレビュー付き） | 401 | `routes/conversations.ts` |
| POST | `/api/conversations` | 必須 | `conversationCreateSchema`（title?, characterId?） | `{ conversation }` 201（greeting自動投入） | 401 / 404 character not found / 400 character required / 400 no_character | `routes/conversations.ts` |
| POST | `/api/conversations/:conversationId/branch` | 必須 | `branchConversationSchema`（messageId, title?） | `{ conversation }` 201（分岐元メッセージまでコピー） | 401 / 400 invalid id / 404 conversation or message not found | `[[route]].ts` |
| GET | `/api/conversations/:conversationId/branches` | 必須 | - | `{ conversations[] }` | 401 / 400 / 404 | `routes/conversations.ts` |
| DELETE | `/api/conversations` | 必須 | - | `{ ok: true }`（全会話削除） | 401 | `routes/conversations.ts` |
| DELETE | `/api/conversations/:conversationId` | 必須 | - | `{ ok: true }` | 401 / 400 / 404 | `routes/conversations.ts` |
| PATCH | `/api/conversations/:conversationId/title` | 必須 | `conversationUpdateTitleSchema` | `{ ok: true }` | 401 / 400 | `[[route]].ts` |
| PATCH | `/api/conversations/:conversationId/character` | 必須 | `conversationUpdateCharacterSchema` | `{ ok: true }` | 401 / 400 / 404 / 400 no_character | `[[route]].ts` |
| POST | `/api/conversations/:conversationId/generate-title` | 必須 | `generateTitleSchema`（messages, model） | `{ title }`（OpenRouter呼び出し） | 401 / 429 rate_limited / 200 `{title:null}`（上流失敗はフェイルオープン） | `[[route]].ts` |
| GET | `/api/conversations/search/messages` | 必須 | query: `messageSearchSchema`（q, limit） | `{ results[] }`（スニペット付き全文検索） | 401 | `routes/conversations.ts` |

### 1.3 メッセージ

| Method | Path | 認証 | リクエスト | 成功 | エラー | 定義 |
|---|---|---|---|---|---|---|
| GET | `/api/conversations/:conversationId/messages` | 必須 | - | `{ messages[] }`（feedback JOIN） | 401 / 400 / 404 conversation not found | `routes/conversations.ts` |
| POST | `/api/conversations/:conversationId/messages` | 必須 | `messageCreateSchema` | `{ ok: true }` 201（`<remember>`抽出・シーン状態更新も同時実行） | 401 / 400 / 404 / 500 failed to persist message | `[[route]].ts` |
| DELETE | `/api/conversations/:conversationId/messages/:messageId` | 必須 | - | `{ ok: true }` | 401 / 400 invalid id / 404 message not found | `routes/conversations.ts` |
| DELETE | `/api/conversations/:conversationId/messages-after/:messageId` | 必須 | - | `{ ok: true }`（再生成・編集用の一括削除。pivot は対象会話内に限定） | 401 / 400 / 404 | `routes/conversations.ts` |
| POST | `/api/messages/:messageId/feedback` | 必須 | `messageFeedbackSchema`（rating, reason?, variantId?） | `{ ok: true }`（upsert） | 401 / 400 / 404 message not found | `routes/conversations.ts` |
| PATCH | `/api/messages/:messageId/image` | 必須 | `messageUpdateImageSchema` | `{ ok: true }` | 401 / 400 imageUrl or imageKey required | `routes/conversations.ts` |
| PATCH | `/api/messages/:messageId/content` | 必須 | `messageUpdateContentSchema` | `{ ok: true }`（再生成用の本文更新、`<remember>`再抽出） | 401 / 400 / 404 / 500 | `[[route]].ts` |
| GET | `/api/chat/stream` | 必須 | query: messageId | SSE再送 | 401 / 400 messageId required / 404 stream not found / 409 stream not complete — **未実装のscaffold。クライアントから呼ばれていない旨がコメントに明記** | `[[route]].ts` |

### 1.4 チャット・判定・画像生成（コア機能）

| Method | Path | 認証 | リクエスト | 成功 | エラー | 定義 |
|---|---|---|---|---|---|---|
| POST | `/api/chat` | 必須 | `chatSchema`（messages, model, safeMode, characterId, responseLength, scenePhase） | SSE ストリーム（`x-model-used` 等ヘッダ付き） | 401 / 403 content_blocked / 429 rate_limited / 404 character not found / Claude session expired 応答 | `[[route]].ts` |
| POST | `/api/judge` | 必須 | `judgeSchema`（response, previousResponse, phase） | 品質判定JSON | 401 / 429 rate_limited | `[[route]].ts` |
| POST | `/api/image` | 必須 | `imageSchema` | `{ task_id, ... }` | 401 / 403 content_blocked（プロンプト・キャラ説明） / 429 rate_limited / 404 image context not found / 404 character not found / 502 upstream | `[[route]].ts` |
| GET | `/api/image/task/:taskId` | 必須 | - | タスク結果（`TASK_STATUS_*`）。SUCCEED時はVLM尤度ゲートを通す | 401 / 400 invalid task_id format / 500 invalid_upstream_task_result / 504 image_task_timeout / 502 upstream service error | `[[route]].ts` |
| GET | `/api/image/providers` | 必須 | - | `{ novita, runware }`（APIキー有無のブール） | 401 | `routes/images.ts` |
| POST | `/api/image/persist` | 必須 | `imagePersistSchema`（imageUrl, messageId） | `{ imageKey }` | 401 / 400 unsupported content type / 413 image too large / 502 failed to fetch image / 404 message not found or already updated / SSRF: `validateAllowedImageUrl` によるドメイン検証 | `routes/images.ts` |

### 1.5 キャラクター CRUD

| Method | Path | 認証 | リクエスト | 成功 | エラー | 定義 |
|---|---|---|---|---|---|---|
| GET | `/api/characters` | 必須 | - | `{ characters[] }`（visualMeta付き、表示順ソート） | 401 | `routes/characters.ts` |
| GET | `/api/characters/:characterId` | 必須 | - | `{ character }` | 401 / 400 / 404 | `routes/characters.ts` |
| POST | `/api/characters` | 必須 | `characterCreateSchema` | `{ character }` 201 | 401 | `routes/characters.ts` |
| PUT | `/api/characters/:characterId` | 必須 | `characterUpdateSchema` | `{ ok: true }` | 401 / 400 / 404 | `routes/characters.ts` |
| PATCH | `/api/characters/:characterId/visual-meta` | 必須 | `visualMetaSchema` | `{ ok: true }` | 401 / 400 / 404 | `routes/characters.ts` |
| DELETE | `/api/characters/:characterId` | 必須 | - | `{ ok: true }` | 401 / 400 / **409 character is in use by conversations**（使用中は削除不可） | `routes/characters.ts` |
| POST | `/api/characters/:characterId/sub-avatars` | 必須 | `{ imageUrl }` | `{ subKey }` | 401 / 400 imageUrl required / 400 unsupported content type / 413 image too large / 404 / 502 | `routes/characters.ts` |
| GET | `/api/characters/:characterId/sub-images` | 必須 | - | `{ images[] }`（アーカイブ済み除外） | 401 / 404 character not found（所有権チェック） | `routes/characters.ts` |
| POST | `/api/generate-character` | 必須 | `generateCharacterSchema` | 生成キャラJSON | 401 / 429 rate_limited / 502 upstream / 502 failed to parse character JSON | `[[route]].ts` |

### 1.6 画像配信・アップロード

| Method | Path | 認証 | リクエスト | 成功 | エラー | 定義 |
|---|---|---|---|---|---|---|
| POST | `/api/avatar/upload` | 必須 | `{ data(base64 dataURL), mimeType }` | `{ avatarKey }` | 401 / 400 invalid_input / 400 invalid_base64 / 400 file_too_large（5MB上限） | `routes/avatar.ts` |
| GET | `/api/avatar/:key{.+}` | △公式キャラは認証不要、私物は必須 | - | 画像バイナリ | 400 invalid key format / 401（私物） / 404 not_found | `routes/avatar.ts` |
| GET | `/api/image/r2/:key{.+}` | 必須 | - | 画像バイナリ | 401 / 400 invalid key format / 404 not found（IDOR対策で403でなく404を返す） | `routes/images.ts` |

`:key{.+}` はスラッシュを含むキー（`sub/...` 等）を1パラメータで受けるための Hono の
正規表現付きパラメータで、`:key` 単独とは一致範囲が違う。

### 1.7 記憶（memory notes）

`memory` サブルーターは `.route("/memory-notes", memoryRoutes)` でマウントされるため、
`memory.ts` 側の `/` `/:noteId` が `/api/memory-notes` `/api/memory-notes/:noteId` になる。
`/api/memory/extract` だけは名前が似ているがサブルーターではなくメインルーター側の実装。

| Method | Path | 認証 | リクエスト | 成功 | エラー | 定義 |
|---|---|---|---|---|---|---|
| GET | `/api/memory-notes` | 必須 | query: characterId? | `{ notes[] }` | 401 | `routes/memory.ts` |
| POST | `/api/memory-notes` | 必須 | `memoryNoteCreateSchema` | `{ note }` 201 | 401 / 403 content_blocked / 404 character not found | `routes/memory.ts` |
| PATCH | `/api/memory-notes/:noteId` | 必須 | `memoryNoteUpdateSchema`（content） | `{ ok: true }` | 401 / 400 / 403 content_blocked | `routes/memory.ts` |
| DELETE | `/api/memory-notes/:noteId` | 必須 | - | `{ ok: true }` | 401 / 400 | `routes/memory.ts` |
| POST | `/api/memory/extract` | 必須 | `memoryExtractSchema` | `{ inserted, facts[] }`（LLM抽出・重複排除） | 401 / 429 rate_limited / 404 character or conversation not found / 400 character mismatch | `[[route]].ts` |

### 1.8 ギャラリー・シーンブックマーク・提案・共有

| Method | Path | 認証 | リクエスト | 成功 | エラー | 定義 |
|---|---|---|---|---|---|---|
| GET | `/api/gallery/images` | 必須 | - | `{ images[] }`（imageUrl NOT NULL） | 401 | `routes/images.ts` |
| GET | `/api/character/:id/gallery` | 必須 | query: `characterGalleryQuerySchema`（limit, cursor） | `{ items[], next_cursor }` | 401 / 400 | `routes/characters.ts` |
| GET/POST | `/api/scene-bookmarks` | 必須 | list: `sceneBookmarkListSchema`（query） / create: `sceneBookmarkCreateSchema` | `{ items, nextCursor }` / `{ bookmark }` 201 | 401 / 404 conversation or message not found / 404 character not found | `routes/scene-bookmarks.ts` |
| PATCH/DELETE | `/api/scene-bookmarks/:id` | 必須 | `sceneBookmarkUpdateSchema`（title） | `{ bookmark }` / `{ ok: true }` | 401 / 400 / 404 bookmark not found | `routes/scene-bookmarks.ts` |
| POST | `/api/suggestions` | 必須 | `suggestionsSchema` | `{ suggestions[] }` | 401 / 429 rate_limited / 404 character not found / 503 suggestion_unavailable | `[[route]].ts` |
| POST | `/api/share` | 必須 | `{ conversationId }` | `{ shareId, createdAt }`（直近500件を凍結） | 401 / 429 rate_limited（burst別軸） / 404 conversation_not_found / 413 payload_too_large | `routes/share.ts` |
| GET | `/api/share/:shareId` | 不要（URL自体がトークン） | - | `{ shareId, createdAt, payload }` | 404 not_found / 410 payload_corrupt | `routes/share.ts` |

### 1.9 グループチャット（`routes/groups.ts`、`.route("/groups", groupRoutes)`）

| Method | Path | 認証 | リクエスト | 成功 | エラー |
|---|---|---|---|---|---|
| POST | `/api/groups` | 必須 | `groupCreateSchema`（name, characterIds, scenario?） | `{ group }` 201 | 401 / 400 duplicate character ids / 403 content_blocked / 404 character not found |
| GET | `/api/groups` | 必須 | - | `{ groups[] }` | 401 |
| GET | `/api/groups/:id` | 必須 | - | `{ group }` | 401 / 400 / 404 |
| DELETE | `/api/groups/:id` | 必須 | - | `{ ok: true }` | 401 / 400 |
| POST | `/api/groups/:id/messages` | 必須 | `groupMessageSendSchema` | SSEストリーム | 401 / 400 / 403 content_blocked / 429 rate_limited / 404 group not found / 502 |
| GET | `/api/groups/:id/messages` | 必須 | query: `groupMessageListSchema` | `{ messages[], nextCursor }` | 401 / 400 / 404 |

### 1.10 管理者（`routes/admin.ts`、`app.route("/admin", adminRoutes)`）

すべて認証必須（管理者専用ロールの区別は無く、ログインユーザーなら誰でも到達可能な点に注意）。

| Method | Path | リクエスト | 成功 | エラー |
|---|---|---|---|---|
| GET | `/api/admin/review-images` | query: cursor? | `{ items, cursor }`（R2 `review/` 一覧） | 401 |
| GET | `/api/admin/review/:key` | - | 画像バイナリ | 401 / 400 bad_key / 404 not_found |
| GET | `/api/admin/ratings` | - | 判定記録一覧 | 401 |
| PUT | `/api/admin/rating` | `adminRatingSchema` | `{ ok: true }`（upsert） | 401 |
| GET | `/api/admin/dedup-candidates` | - | `{ candidates[], note? }` | 401 |
| POST | `/api/admin/dedup-delete` | `adminDedupDeleteSchema` | `{ deletedCount, freedBytes }` | 401 |

---

## 2. 既存テストとのクロスリファレンス

`functions/api/__tests__/*.test.ts`（52ファイル）を全件確認した。多くは HTTP 経路
（`app.request(...)`）ではなく、`route-context.ts` からエクスポートされた個別関数
（`validateImageGenerationOwnership` 等）や `lib/*.ts` を直接呼ぶ**ユニットテスト**である。
HTTP 経路（`app.request`）で実際にエンドツーエンド検証されているのは次のみ:

- `POST /api/chat`（`chat-history-turn-cap`, `chat-length-directive-integration`,
  `chat-live-relay-regeneration`, `chat-long-erotic-keeps-relayed-attempt`,
  `scene-continuity`, `runtime-base-rules`, `phase-de-escalation-overlap` 等、最も厚く
  カバーされている）
- `GET /api/chat/stream`（`stream-resume-ownership`）
- `GET /api/conversations/:conversationId/messages`（`conversation-message-ownership`）
- `POST /api/conversations`, `DELETE /api/conversations/:conversationId/messages-after/:messageId`
  （`conversation-write-integrity-realdb`、本リファクタで追加。2.1 を参照）
- `GET /api/avatar/:key{.+}`, `GET /api/characters`（`avatar-endpoint`）
- `GET /api/characters/:characterId/sub-images`（`sub-image-archive-filter`, `sub-image-archive-realdb`）
- `PUT /api/admin/rating`, `POST /api/admin/dedup-delete`（`admin-routes`, `dedup-delete-image-review`）
- `POST /api/messages/:messageId/feedback`（`message-feedback-endpoint`）
- `POST /api/image/persist`（`image-persist`）
- `GET /api/image/r2/:key{.+}`（`image-r2-ownership`）
- `GET /api/me`, ルートHTML配信（`public-shell-middleware`、正確には `_middleware.ts` 側）

**それ以外の全エンドポイント（conversations の分岐/削除/タイトル変更、
memory-notes 全CRUD、scene-bookmarks 全CRUD、groups 全CRUD、share 2本、
auth の basic-login / session、gallery、
characters の作成/更新/削除/sub-avatars、generate-character、avatar/upload、
judge、image POST/task/providers、admin の review-images 系4本、suggestions）は
HTTP 経路のテストが存在しない。** 詳細は 6 節「既知の未カバー領域」を参照。

### 2.1 本リファクタで追加した回帰テスト

ルーター分割と並行して、分割中に踏んだ不具合をそれぞれ回帰テストで縛った。
以下は**すでに保護済み**なので、同じ範囲のテストを重複して足す必要はない。

| 対象 | テスト | 何を縛っているか |
|---|---|---|
| `GET /api/avatar/:key{.+}` | `functions/api/__tests__/avatar-endpoint.test.ts`「refuses a foreign-namespace key even when the caller owns a character row matching it」 | アバター以外の R2 名前空間（`images/` `review/` `image-gen-task/` `avatars/`）へキーで抜け出す取得を、character 行が一致していても 404 で止める（R2 の `get` 自体を呼ばない） |
| `MessageBubble` のアバター表示 | `src/component/chat/message-bubble.test.tsx`「MessageBubble avatar key hardening」 | 不正キー（`../` 混じり・ヌルバイト・拡張子なし）を `/api/avatar/` へ素通ししない。正規のキーは従来どおり同ルートへ乗る |
| 共有ビューのアバター表示 | `src/component/share/shared-conversation-view.test.tsx`「SharedConversationView avatar key hardening」 | 同上を共有スナップショット側でも縛る（未認証で開く画面なので経路が別） |
| `DELETE /api/conversations/:conversationId/messages-after/:messageId` | `functions/api/__tests__/conversation-write-integrity-realdb.test.ts` | 別会話の `messageId` を pivot に渡されても対象会話のメッセージを消さず 404。同一会話なら以降を消す |
| `POST /api/conversations` | 同上 | greeting の保存に失敗したら作りかけの会話行を残さない（ロールバック）。成功時は会話と greeting の両方が残る |
| 返事のかたちの「この子だけ」設定 | `src/store/character-settings-store.test.ts` | キャラ別設定が全体設定に勝ち、他の子へ漏れないこと。`ou-app` の送信経路と会話中チップの両方がキャラ別設定へ書くこと |
| 再生成の保存失敗 | `src/component/ouse/ou-app.test.tsx`「OuApp regenerate persistence」 | 再生成の永続化に失敗したらトーストで知らせ送信ロックも解く。成功時は何も出さない（成功したように見える無言の失敗を作らない） |

---

## 3. 画面・フロー一覧（`src/component/ouse/`）

ルートは `ou-app.tsx`（`OuApp`）。URL 駆動のルーティングで `useOuRouting` が
`OuScreen` を決定し、画面本体は `CenterScreenContent` が分岐する。
下記は各画面の役割と受け入れ基準（すべて日本語）。

### 3.1 オンボーディング（`ou-onboarding.tsx`）

3タップで「距離感」「相手」「ことば」の3軸を選び最初のキャラへ進む。登録不要、
選択は端末（localStorage）に残す。

**受け入れ基準**
- [ ] 初回起動時にオンボーディングが表示され、3軸すべてを選ぶまで「はじめる」等の完了操作が有効化されない。
- [ ] 3軸を選択して完了すると `saveOnboarding` が呼ばれ、以後同一端末では再表示されない。
- [ ] オンボーディングをスキップしても致命的にクラッシュしない（未選択状態のデフォルト挙動を確認）。

### 3.2 ホーム（`ou-home-screen.tsx`）

キャラクター一覧・最近の会話・「さがす」への導線を表示するトップ画面。

**受け入れ基準**
- [ ] `activeCharacterId` に一致するキャラがハイライトされる。
- [ ] キャラをタップすると `onSelectCharacter`（プロフィールシート経由）が呼ばれる。
- [ ] 会話をタップすると `onSelectConversation` が呼ばれ、対応する会話が復元される。
- [ ] キャラ0件（新規ユーザー）でも画面がクラッシュせず「つくる」導線が出る。

### 3.3 さがす（`ou-discover-screen.tsx`）

公式キャラと自作キャラを横断検索。名前・タグ・雰囲気の自由語検索。

**受け入れ基準**
- [ ] 検索語入力で候補が絞り込まれる。
- [ ] ゼロ件時に「つくる」への導線が出る（行き止まりにしない設計方針）。
- [ ] `onAddCharacter` がウィザードを正しく開く。

### 3.4 トーク（`ou-message-list.tsx` + `ouse-composer.tsx` + `talk-header.tsx`）

チャット本体。ストリーミング表示・画像生成ボタン・フィードバック・再生成・パーマリンクを持つ。

**受け入れ基準**
- [ ] メッセージ送信後、アシスタント応答がストリーミングで逐次更新される（`isStreaming`）。
- [ ] オフライン時は送信せずキューに積み、再接続で自動再送する（設計 C-3）。
- [ ] 送信の永続化が失敗した場合、`toast.error` で明示され、画面が「成功したように見える」状態を作らない。
- [ ] `focusMessageId`（`?m=` クエリ）指定時、該当メッセージへスクロールしハイライトする。
- [ ] グッド/バッドのフィードバックが送信され、UIに反映される。
- [ ] 「以降を削除して再生成」が対象メッセージ以降を正しく一括削除する。
- [ ] 画像生成ボタン押下でポーリングが開始し、成功時に R2 永続化・失敗時にエラートーストが出る。

### 3.5 プロフィールシート（`ou-profile-screen.tsx`）

キャラのプロフィールを閲覧するシート。編集導線は無し（トーク開始のみ）。

**受け入れ基準**
- [ ] `activeCharacter` の名前・アバター・自己紹介（自然文整形済み）が表示される。
- [ ] 「はじめる」で `talk` 画面へ遷移しシートが閉じる。

### 3.6 マイページ（`ou-my-screen.tsx`）

自作キャラの管理ハブ。編集・記憶・設定・宴（グループ）・記録への導線。

**受け入れ基準**
- [ ] 自作キャラ一覧が表示され、`onEdit` で編集画面へ、`onMemory` で記憶画面へ遷移する。
- [ ] 「つくる」でキャラ作成ウィザードが開く。

### 3.7 キャラ編集（`ou-edit-screen.tsx`）

保存は「次の返事から」反映、進行中シーンは変えない設計。

**受け入れ基準**
- [ ] 既存の `systemPrompt` が `parseSystemPrompt` で正しく分解され、フォームに反映される。
- [ ] 保存時に `buildSystemPrompt` で再構築した内容が `updateCharacterEntry` に渡る。
- [ ] 保存成功で `my` 画面へ戻る。保存失敗時は画面に留まりトーストでエラーを示す（黙って失敗を握り潰さない）。
- [ ] 削除成功で `my` 画面へ戻る。削除失敗時（**409: 使用中の会話がある場合**を含む）はトーストでエラーを示す。
- [ ] 編集対象キャラが直前に削除済みの場合、何もレンダリングせず落ちない。

### 3.8 記憶（`ou-memory-screen.tsx`）

「覚えておく」で溜まった記憶ノートの閲覧・書き換え・削除。

**受け入れ基準**
- [ ] キャラごとの記憶一覧が表示される。
- [ ] 書き換え・削除が即座にサーバへ反映される（`PATCH`/`DELETE /api/memory-notes/:id`）。
- [ ] NSFWガードレールでブロックされた内容（403 content_blocked）はエラー表示され保存されない。

### 3.9 アルバム / 素材管理（`ou-photo-screen.tsx` / `ou-assets-screen.tsx`）

会話内で生成された画像の一覧（アルバム）と、キャラ作成へつなぐ素材選択（素材管理）。

**受け入れ基準**
- [ ] アルバムに画像付きメッセージのみが表示される（`imageUrl` 必須）。
- [ ] 素材管理から選んだ画像がキャラ作成ウィザードのアップロード欄へ引き継がれる（`createFromAssetSrc`、#823）。
- [ ] 画像タップで全画面オーバーレイ（`OuPhotoOverlay`）が開閉する。

### 3.10 宴（グループチャット、`ou-utage-screen.tsx`）

複数キャラとの同時チャット。`component/group/group-view.tsx` 等に委譲。

**受け入れ基準**
- [ ] グループ作成時、重複キャラID・NSFWガードレール（403）が正しく弾かれる。
- [ ] グループへのメッセージ送信がSSEでストリーミングされ、発言キャラが `speakerCharacterId` で判別できる。
- [ ] グループ削除で関連メッセージも削除される。

### 3.11 記録・分岐（`ou-log-screen.tsx` / `ou-branch-tree.tsx` / `ou-drawer.tsx`）

会話履歴一覧・分岐ツリー表示・「ふたりの記録」ドロワー。

**受け入れ基準**
- [ ] 会話一覧が日付単位でグルーピングされる。
- [ ] 会話を選ぶと `handleSelectConversation` が呼ばれ、対応する `characterId` へ `activeCharacterId` が同期する。
- [ ] 分岐元メッセージからの分岐が正しくツリー表示される。

### 3.12 シーン選択（`ou-scene-picker.tsx`）

「今夜のはじまり」を選んで会話を開始する導線。

**受け入れ基準**
- [ ] シーン選択で `handleSend` が呼ばれ、`talk` 画面へ戻る。
- [ ] `openScenePicker`/`closeScenePicker` が呼び出し元の画面へ正しく戻る（`sceneReturnScreenRef`）。

### 3.13 キャラ作成ウィザード（`ou-create-flow-entry.tsx`）

AI生成（`/api/generate-character`）または手動でのキャラ作成フロー。

**受け入れ基準**
- [ ] AI生成が上流エラー（502）でも画面がクラッシュせず、エラーが分かる形で表示される。
- [ ] 作成成功後、`onCreated` で新規キャラのトークへ遷移する。
- [ ] `initialUploadedImage`（素材管理からの引き継ぎ）がアップロード欄に反映される。

### 3.14 設定関連シート（`ou-reply-settings-sheet.tsx` / `ou-faces-sheet.tsx`）

「この子（またはこのシーン）だけ」に効く返信設定、キャラ切り替えシート。

**受け入れ基準**
- [ ] 返信設定の変更はキャラの人格（`systemPrompt`）を書き換えない（別物という設計方針の確認）。
- [ ] `OuFacesSheet` からのキャラ切り替えが `activeCharacterId` を正しく更新する。

---

## 4. AIキャラ能力の非退行確認

このアプリの中核的な品質基準は **「チャットの応答がキャラ設定どおりに振る舞い続けること」**
「画像生成がキャラの見た目を保つこと」「モデル側の一般的な安全文言・合意の枠を
勝手に注入しないこと」の3点である。リファクタや依存更新のたびにこれが壊れていないかを
確認する手順を以下にまとめる。

### 4.1 キャラ設定外の枠を注入していないことの確認（自動）

`functions/api/__tests__/no-injected-consent-framing.test.ts` が本丸のガード。
`functions/api` 配下の全 `.ts` ファイル（`__tests__` を除く。ルーター分割でルートが
`routes/` へ移っても走査から外れないよう、ファイル名ではなくディレクトリ丸ごとを読む）と
`src/lib/prompt-variant-defaults.ts`、
`drizzle/0055_strip_injected_framing_from_prompt_variant.sql` の**本文**を
文字列として読み、次を機械的に禁止している。

- エロ/絶頂フェーズの指示文に "has already consented" 等の合意の断定が無いこと
- 特定台詞（「待って」「ダメ」「やめて」等）を禁止語・不合格条件にしていないこと
  （Claude判定器の "Passive resistance" 基準の再発防止を含む）
- 品質リトライ指示が力関係・態度の型を指定していないこと（"プッシュ＆プル" 等）
- 画像タグ生成が表情を固定していないこと（"MANDATORY expression: blush..." 等）
- キャラ生成プロンプト（`character-generation.ts`）が「合意」の語を設定に焼き付けていないこと

**実行**: `npx vitest run functions/api/__tests__/no-injected-consent-framing.test.ts`

**手動確認が必要な理由**: このテストは「禁止フレーズの再侵入」は検知できるが、
「新しい言い回しで同じ枠が入る」ケースは検知できない（文字列一致ベースのため）。
`prompt/instructions/no-injected-ai-filter.md` の判定基準
（「その一文を消したらキャラ設定どおりに振る舞えるようになるか」）で、
プロンプト組み立てコードの diff を都度レビューする必要がある。

### 4.2 チャット応答の作中人物崩壊検知（自動 + 手動）

- `functions/api/__tests__/persona-break-detect.test.ts` — `containsApologyLeak` /
  `shouldRetryWithPhase`（`functions/api/lib/persona-break-detect.ts`）が、AIが
  作中人物を離れて謝罪・言い訳するような漏れ（persona break）を検知しリトライへ回すロジックを検証。
- `functions/api/__tests__/refusal-detect.test.ts` — `hardRefusalDetect` / `softRefusalDetect`
  （`functions/api/lib/refusal-detect.ts`）が拒否応答を検知するロジックを検証。
- `functions/api/__tests__/claude-judge-verdict.test.ts` / `claude-judge-openrouter.test.ts` —
  `POST /api/judge` が使う品質判定（`claudeJudgeQuality`）のロジック。
- `functions/api/__tests__/phase-de-escalation*.test.ts`（3ファイル） — フェーズの誤昇格/降格
  （日常語を絶頂表現と誤判定する等）を防ぐ分類器の検証。
- `functions/api/__tests__/response-length-band.test.ts` / `chat-length-behavior.test.ts` —
  応答の長さがキャラ設定・フェーズに応じた帯域を外れていないかの検証。

**手動確認手順（リファクタ後・モデル切替後に実施）**:
1. 既存キャラ（`isOfficial: true` の1体、自作キャラ1体）で `conversation → intimate →
   erotic → climax → afterglow` の5フェーズを通しで会話し、各ターンでキャラの一人称・口調
   ・性格が `systemPrompt` の記述から逸脱していないか目視確認する。
2. 同じ会話ログを `POST /api/judge` に通し、`ran: true` で判定が走ること、
   スコアが極端に劣化していないことを確認する。
3. `containsApologyLeak` が拾うべきフレーズ（「すみません、それはできません」等）を
   意図的に含む応答をモックし、リトライ経路（`shouldRetryWithPhase`）が発火することを確認する。

### 4.3 画像生成の同一性（likeness）非退行確認 — VLM尤度ゲート

キャラの見た目が生成画像で保たれているかは `functions/api/lib/route-context.ts` の
`decideVlmLikenessGate` / `applyVlmLikenessGate` が担う。

- **判定ロジック**: `decideVlmLikenessGate`（`route-context.ts:6012`）は
  `characterConsistency` スコアが `VLM_LIKENESS_GATE_REGEN_THRESHOLD`（35点）未満の場合のみ
  `regenerate` を返し、それ以外は `passthrough`。再試行は `VLM_LIKENESS_GATE_MAX_ATTEMPT`
  （1回）まで。
- **適用箇所**: `GET /api/image/task/:taskId` が `TASK_STATUS_SUCCEED` を受け取った直後、
  R2に保存された `VlmLikenessGateContext`（`image-gen-ctx/<taskId>.json`）を読み出し、
  キャラの参照画像（`getCharacterReferenceImageBase64`）と生成画像を VLM で比較採点し、
  低スコアなら同じ参照画像を使った img2img で自動的に1回だけ再生成する。
- **既存テスト**: `functions/api/__tests__/vlm-likeness-gate.test.ts`（コンテキストの
  read/write と `decideVlmLikenessGate` の閾値ロジック）、
  `functions/api/__tests__/image-graph-vlm-grader.test.ts`（採点ロジック本体、
  `functions/api/lib/image-graph/vlm-grader.ts`）。

**手動確認手順**:
1. 承認済みキャラ（プロフィールに参照画像あり）で画像生成を実行し、
   `GET /api/image/task/:taskId` のレスポンスに含まれる最終画像が、生成直後の1枚目と
   異なる場合（再生成が発火した場合）、コンソールログ `"vlm likeness gate regenerated
   image task"` が出力されることを確認する。
2. 参照画像が存在しないキャラ（`getCharacterReferenceImageBase64` が `null` を返す状況）
   では、低スコアでも再生成せずそのまま `passthrough` になることを確認する
   （`applyVlmLikenessGate` の `if (!referenceImageBase64) { ... return result; }` 分岐）。
3. モデル固定の確認: CLAUDE.md の指示どおり、Novita 生成が
   `waiNSFWIllustrious_v90_1187991.safetensors` **以外**のモデルを使っていないことを
   `src/lib/image-gen/novita-provider.ts` のモデル解決ロジックで確認する
   （本タスクでは未検証、別途 `prompt/commands/add-char-photo.md` の手順で確認すること）。

### 4.4 まとめ表

| 観点 | 自動テスト | 手動確認の要否 |
|---|---|---|
| 合意・境界枠の不在 | `no-injected-consent-framing.test.ts` | 要（新規言い回しの侵入は自動検知不可） |
| 作中人物崩壊（persona break） | `persona-break-detect.test.ts` | 要（実会話での目視） |
| 拒否応答検知 | `refusal-detect.test.ts` | 不要（ロジックのみで完結） |
| フェーズ誤昇格/降格 | `phase-de-escalation*.test.ts` | 推奨（実会話での境界ケース） |
| 画像の同一性（likeness） | `vlm-likeness-gate.test.ts`, `image-graph-vlm-grader.test.ts` | 要（実生成での目視） |
| 品質判定（judge） | `claude-judge-verdict.test.ts` | 要（スコア劣化の傾向確認） |

---

## 5. テストカバレッジ実測値

`npx vitest run --coverage`（2026-08-09 実行、`chore/tech-debt-refactor` = `a614e8f`、
Test Files 199 passed / Tests 2,365 passed + 1 expected fail）の**実測値**。

`vitest.config.ts` の計測対象は `src/lib/**` `src/store/**` `functions/api/**` のみで、
**`src/component/**`（画面コンポーネント）は対象外**（`.test.tsx` は動くが数値化されない）。

全体: **Stmts 77.74% / Branch 68.19% / Funcs 80.19% / Lines 78.99%**。

CI の閾値ゲートは `lines: 77 / functions: 79 / branches: 67 / statements: 76`。
サブルータへ HTTP テストを足した分、実測に合わせて引き上げ済み
（旧 `65 / 70 / 54 / 64` のままやと、足したテストを消しても CI が気づかん）。
強制されとることは `--coverage.thresholds.lines=99` を渡して
`ERROR: Coverage for lines (78.99%) does not meet global threshold (99%)` が出ることで確認した。

### 5.1 ディレクトリ別サマリ

| ディレクトリ | Lines | 所見 |
|---|---|---|
| `functions/api`（`[[route]].ts` 単体） | 29.34% | 2,253行に縮んだ後も**最重要ファイルが最低カバレッジ**。残っとるのは `chat` `image` `judge` `suggestions` `memory/extract` `generate-character` といった AI/モデル系で、このPRでは意図的に触ってへん経路 |
| `functions/api/lib` | 73.44% | `route-context.ts`（6,650行）が全体を押し下げる |
| `functions/api/routes` | — | **10本中6本が100%**（下表） |
| `src/lib` | 89% 台 | 良好 |
| `src/store` | 83.59% | 全ファイル実行されとる |

### 5.2 サブルーター別カバレッジ（`functions/api/routes/*.ts`）

分割で生まれた10本。**分割直後は `scene-bookmarks` `groups` `memory` `share` `auth` の
5本が1〜3%（＝モジュールが import された分だけ）やった**が、専用の HTTP テストを
足して解消した。

| ファイル | Stmts | Branch | Funcs | Lines | 専用テスト |
|---|---|---|---|---|---|
| `admin.ts` | 100% | 100% | 100% | **100%** | `admin-routes`, `admin-routes-http`, `dedup-delete-image-review` |
| `auth.ts` | 100% | 100% | 100% | **100%** | `auth-routes` |
| `images.ts` | 100% | 100% | 100% | **100%** | `images-routes`, `image-persist`, `image-r2-ownership` |
| `memory.ts` | 100% | 100% | 100% | **100%** | `memory-routes` |
| `scene-bookmarks.ts` | 100% | 97.61% | 100% | **100%** | `scene-bookmarks-routes` |
| `share.ts` | 100% | 100% | 100% | **100%** | `share-routes` |
| `conversations.ts` | 99.45% | 90.90% | 100% | **99.40%** | `conversations-routes`, `conversation-write-integrity-realdb`, `conversation-message-ownership` |
| `characters.ts` | 99.29% | 97.87% | 92.85% | **99.25%** | `characters-routes` |
| `groups.ts` | 92.39% | 85.18% | 100% | **91.89%** | `groups-routes` |
| `avatar.ts` | 64.06% | 73.68% | 50% | **63.63%** | `avatar-endpoint`（GET のみ。`POST /api/avatar/upload` が未検証） |

### 5.3 残っとる低カバレッジ（要注意）

| ファイル | Lines | 備考 |
|---|---|---|
| `functions/api/[[route]].ts` | 29.34% | AI/モデル系の経路。このPRの凍結対象なので意図的に未着手 |
| `functions/api/routes/avatar.ts` | 63.63% | `POST /api/avatar/upload` が未検証（GET 側は名前空間脱出の回帰テストあり） |
| `functions/api/lib/route-context.ts` | 60% 台 | 6,650行。分割は #1249 へ |
| `src/lib/conversation-share.ts` | — | `share-routes` の副次で 93% 台まで上がった |
| `functions/api/lib/slack-error-notifier.ts` | 40.9% | エラー通知経路の大半が未検証 |
| `functions/api/lib/image-explicit-tags.ts` | 33.33% | 明示的タグ検出ロジックの大半が未検証 |

## 6. 既知の未カバー領域（優先度順）

「1. バックエンド API 一覧」と「2. 既存テストとのクロスリファレンス」を突き合わせ、
HTTPレベルのテストが存在しないエンドポイント・フローを、認可/所有権チェック → データ変更系
→ 読み取り専用/表示系の順にリスク優先度で並べた。

### 優先度A: 認可・所有権チェックが絡む未テスト経路

他人のデータへアクセスできてしまうリグレッションが最も実害が大きい領域。

**この節に挙がっとった項目は、5.2 のとおり全て HTTP テストで塞いだ。**
`characters` `scene-bookmarks` `groups` `memory` `share` `auth` の各ルータへ
専用スイートを追加し、いずれも 91〜100% まで到達しとる。各スイートは
「認証を外す」「所有権の述語を落とす」といった変異を1つずつ入れて、
自分のテストが実際に落ちることを確認した上で入れとる。

残っとるのは次の1本だけ。

- `POST /api/avatar/upload`（`routes/avatar.ts` **63.63%**）
  — GET 側は名前空間脱出の回帰テストで保護済みやが、アップロード経路は未検証。
  data URL のデコード、MIME 判定、5MB 上限が対象になる。

### 優先度B: データ変更系エンドポイント

- `POST /api/conversations/:conversationId/branch`（分岐コピーの正確性、
  コピー中エラー時のロールバック — `copyError` catch節がテストされていない）
  ※ `POST /api/conversations` 側のロールバックは 2.1 で保護済み
- `DELETE /api/conversations`, `DELETE /api/conversations/:conversationId`（関連メッセージ削除の完全性）
- `PATCH /api/conversations/:conversationId/title`, `PATCH /api/conversations/:conversationId/character`
- `POST /api/conversations/:conversationId/messages`（`<remember>` タグ抽出・シーン状態更新の統合検証）
- `DELETE /api/conversations/:conversationId/messages/:messageId`
  （`messages-after` 側は 2.1 で pivot の会話スコープを保護済み）
- `PATCH /api/messages/:messageId/image`, `PATCH /api/messages/:messageId/content`
- `POST /api/memory-notes`, `POST /api/memory/extract`（LLM抽出結果の重複排除ロジック）
- `POST /api/characters`（新規作成、`visualMeta` 永続化込み）
- `POST /api/generate-character`（プロンプト構築は単体テスト済みだが、エンドポイント自体のレート制限・エラー整形は未検証）
- `POST /api/avatar/upload`（5MB上限・MIME検証のHTTPレベル検証）
- `POST /api/admin/dedup-delete` は検証済みだが、`GET /api/admin/dedup-candidates` は未検証（削除候補の選定ロジックがHTTP経路で確認されていない）

### 優先度C: 読み取り専用・表示系

- `GET /api/conversations`, `GET /api/conversations/:conversationId/branches`
- `GET /api/conversations/search/messages`
- `GET /api/gallery/images`, `GET /api/character/:id/gallery`
- `GET /api/scene-bookmarks`（一覧・検索クエリ）
- `GET /api/memory-notes`
- `GET /api/characters/:characterId`
- `POST /api/suggestions`
- `GET /api/image/providers`
- `GET /api/admin/review-images`, `GET /api/admin/review/:key`, `GET /api/admin/ratings`
- `GET /api/chat/stream`（**実装がscaffoldのまま**——クライアントが呼ばない前提のコードが
  本番に残っている。復活させる場合はまずこのエンドポイントの用途を再定義してからテストを書くべき）

### フロントエンド（`src/component/ouse/`）の未テスト画面

「3. 画面・フロー一覧」のうち `.test.tsx` が存在しないもの（優先度が高い順）:

- `ou-edit-screen.tsx`（キャラ編集・削除。409エラー時の挙動を含め未検証）
- `ou-scene-picker.tsx`, `ou-reply-settings-sheet.tsx`, `ou-faces-sheet.tsx`（設定変更系。
  返信設定の**中身**は `src/store/character-settings-store.test.ts` で縛られているが、
  シート側の操作は未検証）
- `ou-create-flow-entry.tsx`（`ouse/` 側のウィザード入口。`component/character/` の
  `ou-create-entry` / `ou-create-flow` にはテストがある）
- `ou-memory-screen.tsx`, `ou-log-screen.tsx`, `ou-utage-screen.tsx`, `ou-assets-screen.tsx`
- `ou-branch-tree.tsx`, `ou-stage.tsx`, `ou-rail.tsx`, `talk-surface.tsx`, `ouse-composer.tsx`

`ou-app.tsx` には本リファクタで `ou-app.test.tsx`（再生成の保存失敗、2.1）が付いたが、
ルートオーケストレーターとしての大部分は依然として未検証である。

なお、コンポーネントディレクトリはカバレッジ計測対象外（`vitest.config.ts` の
`coverage.include`）のため、`.test.tsx` の有無だけがテスト有無の唯一の手がかりであり、
数値でのモニタリングができない状態にある。

---

## 7. 関連ファイル索引

- ルーター本体: `functions/api/[[route]].ts`（2,253行。`chat` / `judge` / `image` /
  `generate-character` / `suggestions` / `memory/extract` と conversations の一部が残る）
- 共有ロジック（バリデーション・ゲート・プロンプト構築の大半）: `functions/api/lib/route-context.ts`（6,650行）
- サブルーター: `functions/api/routes/{admin,auth,avatar,characters,conversations,groups,images,memory,scene-bookmarks,share}.ts`
  （マウント方法と実効パスの対応は 1 節冒頭の表を参照）
- テスト: `functions/api/__tests__/*.test.ts`（52ファイル）
- フロントエンドAPIクライアント: `src/lib/api.ts`
- カバレッジ設定: `vitest.config.ts`
- 非注入ガード: `functions/api/__tests__/no-injected-consent-framing.test.ts`,
  `prompt/instructions/no-injected-ai-filter.md`
- VLM尤度ゲート: `functions/api/lib/route-context.ts`（`decideVlmLikenessGate` 等）,
  `functions/api/lib/image-graph/vlm-grader.ts`
