# UIテスト仕様書

> 注記: 依頼で参照指定された `.work/plans/create-flow-explorations.md` はこの作業環境に存在しないため、`src/component/ouse/ouse-screen-types.ts` の画面 inventory と、`src/lib/app-route.ts` のハッシュルート、`functions/api/[[route]].ts` / `src/lib/api.ts` の実 API 連動を根拠に網羅する。

## 共通前提

- ビューポートはスマホ基準 `375x667`。
- 年齢確認が出た場合は「はい、18歳以上です」を押して通過する。
- 初回オンボーディングが出た場合は 3 項目を選び「会いに行く →」で閉じる。
- 下部タブは「ホーム」「さがす」「アルバム」「マイ」の 4 つが常時利用できることを確認する。
- API エラー分類は `src/lib/api.ts` の `classifyApiError` / `ApiResponseError` の文言に従い、401/403、429、5xx、ネットワーク断を別々に確認する。

## ホーム

### 到達手順
- `http://localhost:5173` を開く。
- 必要なら年齢確認とオンボーディングを完了する。
- 下部タブ「ホーム」を押す。

### 表示チェック
- ホーム見出し、現在の相手、最近の会話、出会い導線が表示される。
- キャラクターカードが 0 件の場合も作成/探索の空状態導線が表示される。
- 下部タブ「ホーム」が選択状態になる。

### インタラクションチェック
- 「さがす →」でさがす画面へ遷移する。
- キャラクターカードを押すと talk 画面へ遷移する。
- 作成導線からキャラクター作成シートが開く。

### 裏側連動チェック(API+persistence)
- キャラクター一覧は `GET /api/characters`（`listCharacters`）で取得し、失敗時は再試行/エラー表示になる。
- 会話一覧は `GET /api/conversations`（`listConversations`）で取得し、最近の会話カードに反映される。
- 選択中キャラクターや会話状態は Zustand/Dexie 側のローカル状態と D1 の会話永続化が矛盾しない。

### 異常系チェック
- `GET /api/characters` が 401 の場合はログイン/セッション切れ文言を表示する。
- 408/ネットワーク断では再読み込み導線を出す。
- キャラクター 0 件でも root が空にならず、作成/探索導線が残る。

## さがす

### 到達手順
- 下部タブ「さがす」を押す。

### 表示チェック
- 検索入力、フィルター（すべて/公式/つくった子/話したことがある）、キャラクターグリッドが表示される。
- キャラクター名、タグ、アバターまたは頭文字フォールバックが表示される。

### インタラクションチェック
- 検索語入力で名前/挨拶/タグに一致するカードだけに絞り込まれる。
- フィルター切替で公式/自作/会話済みが絞り込まれる。
- カード押下で talk 画面へ遷移する。
- 0 件時の「その条件でつくる」導線から作成シートへ進める。

### 裏側連動チェック(API+persistence)
- キャラクター一覧は `GET /api/characters` と `Character` スキーマに依存する。
- 会話済み判定は `GET /api/conversations` の characterId と突合する。
- アバター画像は認証付き画像取得経路を通り、R2/静的 avatar path の取り扱いが崩れない。

### 異常系チェック
- API 失敗時も検索 UI 自体は操作不能にならない。
- 画像取得失敗時は頭文字フォールバックを表示する。
- 長い検索語や該当なしでもレイアウトが崩れない。

## アルバム

### 到達手順
- 下部タブ「アルバム」を押す。

### 表示チェック
- アルバム見出し、生成画像一覧、空状態、読み込み状態、エラー状態を確認する。
- 画像カードにキャラクター/会話文脈が表示される場合は欠落しない。

### インタラクションチェック
- 画像タップでプレビュー/詳細が開く。
- 戻る/閉じる操作でアルバム一覧へ戻る。
- キャラクター別アルバム導線がある場合は対象キャラクターで絞り込まれる。

### 裏側連動チェック(API+persistence)
- 全体ギャラリーは `GET /api/gallery/images`（`listGalleryImages`）を利用する。
- キャラクター別は `GET /api/character/:characterId/gallery`（`listCharacterGallery`）を利用する。
- 画像生成後の保存は `POST /api/image/persist` と `PATCH /api/messages/:messageId/image` で D1/R2 の参照が一致する。

### 異常系チェック
- 画像 URL が失効/404 の場合もカード枠と代替表示を維持する。
- `GET /api/gallery/images` 5xx では「アルバムを読み込めませんでした」を表示する。
- 画像 0 件では生成を促す空状態を表示する。

## マイ

### 到達手順
- 下部タブ「マイ」を押す。

### 表示チェック
- 見出し「マイ」、自作/所持キャラクター、設定、記憶、ログ、宴導線が表示される。
- キャラクターカードには編集・会話開始の導線が表示される。

### インタラクションチェック
- 設定ボタンで設定シートを開閉できる。
- 記憶で memory 画面へ遷移する。
- ログで log 画面へ遷移する。
- 宴で utage 画面へ遷移する。
- 編集で edit 画面へ遷移する。

### 裏側連動チェック(API+persistence)
- 現在ユーザー情報は `GET /api/me`（`fetchCurrentUser`）で取得する。
- キャラクター一覧/作成/更新/削除は `GET/POST /api/characters`、`PUT/DELETE /api/characters/:id` に連動する。
- 記憶は `GET/POST /api/memory-notes`、`PUT/DELETE /api/memory-notes/:noteId` で D1 永続化を確認する。

### 異常系チェック
- 自作キャラクター 0 件でも作成導線が表示される。
- 設定保存失敗時はトースト/エラー表示で通知する。
- 削除済みキャラクターが会話一覧に残る場合でも画面が落ちない。

## talk

### 到達手順
- ホームの最初のキャラクターカードを押す。
- 代替として `#/chat/:characterId` を開く。

### 表示チェック
- ヘッダーにキャラクター名/戻る/プロフィール導線が表示される。
- 挨拶または既存メッセージ、入力欄、送信ボタン、画像生成導線が表示される。
- オフライン時はオフラインバナーを表示する。

### インタラクションチェック
- テキスト送信でユーザーメッセージが即時表示され、AI 応答がストリーム表示される。
- 画像生成ボタンで生成進捗が表示される。
- メッセージの再生成/削除/フィードバック/画像添付更新が操作できる。
- シーン選択、顔差分、返信設定などのドロワーを開閉できる。

### 裏側連動チェック(API+persistence)
- 会話作成は `POST /api/conversations`、分岐は `POST /api/conversations/:id/branches`。
- メッセージ一覧は `GET /api/conversations/:id/messages`、作成は `POST /api/conversations/:id/messages`。
- AI 応答は `POST /api/chat`、再開は `GET /api/chat/stream?messageId=...`。
- フィードバックは `POST /api/messages/:messageId/feedback`、削除は `DELETE /api/messages/:messageId`、以降削除は `DELETE /api/messages/:messageId/after`。
- 画像は `POST /api/image`、`GET /api/image/task/:taskId`、`POST /api/image/persist`、`PATCH /api/messages/:messageId/image`。
- 動画は `POST /api/video`、`GET /api/video/task/:taskId`、`POST /api/video/persist`。

### 異常系チェック
- 429 は利用制限メッセージを出し、入力欄を復帰させる。
- SSE 切断時は resumeStream で復帰でき、失敗時は再試行導線を出す。
- AI upstream timeout/unavailable/credit_exhausted は分類済み文言を表示する。
- scenePhase はクライアント値だけで昇格せず、サーバー側検証結果と矛盾しない。

## log

### 到達手順
- マイ画面から「ログ」を押す。

### 表示チェック
- 会話履歴一覧、検索/空状態、戻る導線が表示される。

### インタラクションチェック
- 会話を押すと talk 画面で該当会話を開く。
- 検索がある場合はメッセージ本文検索結果を表示する。

### 裏側連動チェック(API+persistence)
- 履歴一覧は `GET /api/conversations`。
- メッセージ検索は `GET /api/conversations/search/messages`。
- タイトル生成/更新は `POST /api/conversations/:id/title`、`PATCH /api/conversations/:id/title` と整合する。

### 異常系チェック
- 会話 0 件は空状態を表示する。
- 削除済み conversationId を開いた場合はホーム/空状態へ戻す。

## memory

### 到達手順
- マイ画面から「記憶」を押す。

### 表示チェック
- キャラクター名、記憶ノート一覧、追加/編集/削除導線、戻る導線が表示される。

### インタラクションチェック
- 記憶追加、内容編集、削除確認ができる。
- 戻るでマイ画面へ戻る。

### 裏側連動チェック(API+persistence)
- `GET /api/memory-notes?characterId=...`、`POST /api/memory-notes`、`PUT /api/memory-notes/:noteId`、`DELETE /api/memory-notes/:noteId` を確認する。
- talk のプロンプト注入は保存済み memory note と関連度選択に連動する。

### 異常系チェック
- characterId が null/削除済みの場合は安全な空状態を表示する。
- 保存失敗時は編集内容を失わず再試行できる。

## edit

### 到達手順
- マイ画面のキャラクター編集を押す。

### 表示チェック
- 名前、挨拶、タグ、プロフィール、アバター/ビジュアル設定、衣装設定、保存/削除/戻るが表示される。

### インタラクションチェック
- 入力変更後に保存できる。
- 削除確認を経て削除できる。
- 衣装の追加/削除ができる。

### 裏側連動チェック(API+persistence)
- 更新は `PUT /api/characters/:id`、削除は `DELETE /api/characters/:id`。
- ビジュアルメタ更新は `PATCH /api/characters/:id/visual-meta`。
- 衣装は `GET/POST /api/characters/:characterId/outfits`、`DELETE /api/characters/:characterId/outfits/:outfitId`。

### 異常系チェック
- 必須項目不足/長すぎる入力は保存前に検知する。
- 削除失敗時に一覧から消えたように見せない。

## scene

### 到達手順
- talk 画面のシーン選択導線を押す。

### 表示チェック
- シーン候補、ブックマーク、戻る導線が表示される。

### インタラクションチェック
- シーン選択で talk に戻り、初回メッセージ/指示が送信される。
- ブックマーク作成/リネーム/削除ができる。

### 裏側連動チェック(API+persistence)
- 一覧は `GET /api/scene-bookmarks`、作成は `POST /api/scene-bookmarks`、リネームは `PATCH /api/scene-bookmarks/:bookmarkId`、削除は `DELETE /api/scene-bookmarks/:bookmarkId`。
- 選択後の送信は `POST /api/chat` と `POST /api/conversations/:id/messages` に連動する。

### 異常系チェック
- ブックマーク 0 件でもプリセット候補を表示する。
- 保存失敗時は選択済みシーンを失わない。

## utage

### 到達手順
- マイ画面から「宴」を押す。

### 表示チェック
- グループ/複数キャラクター会話の入口、参加キャラクター、戻る導線が表示される。

### インタラクションチェック
- グループ作成、キャラクター選択、グループ会話開始ができる。
- 既存グループを開ける。

### 裏側連動チェック(API+persistence)
- グループ作成/一覧/取得/削除は `POST /api/groups`、`GET /api/groups`、`GET /api/groups/:groupId`、`DELETE /api/groups/:groupId`。
- グループメッセージは `GET /api/groups/:groupId/messages`、`POST /api/groups/:groupId/messages`。

### 異常系チェック
- 参加キャラクター不足時は作成/探索導線を出す。
- グループ送信失敗時は重複送信を防ぎ、再試行可能にする。

## photo overlay / character gallery

### 到達手順
- アルバム画面、または talk の画像プレビューから開く。

### 表示チェック
- 大きな画像、閉じる、関連メッセージ/キャラクター、保存/共有導線が表示される。

### インタラクションチェック
- スワイプ/閉じる/戻るができる。
- 関連会話へ戻る導線がある場合は該当 talk へ遷移する。

### 裏側連動チェック(API+persistence)
- 画像 URL は `GET /api/gallery/images` / `GET /api/character/:characterId/gallery` の結果と一致する。
- 共有がある場合は `POST /api/share`、`GET /api/share/:shareId` の会話共有と整合する。

### 異常系チェック
- 画像読み込み失敗時に閉じる操作が残る。
- 不正な R2 key/path は表示せず安全な代替表示にする。

## share

### 到達手順
- `#/share/:shareId` を開く。

### 表示チェック
- 共有会話のタイトル、メッセージ、発言ディープリンクのハイライト、戻る/発見導線が表示される。

### インタラクションチェック
- `?m=:messageId` で対象発言へスクロール/強調される。
- 発見へ戻るリンクで discover に遷移する。

### 裏側連動チェック(API+persistence)
- 共有作成は `POST /api/share`、取得は `GET /api/share/:shareId`。
- 共有 payload は conversation/message/character 情報のスナップショットとして表示し、元会話削除後も仕様通り表示できることを確認する。

### 異常系チェック
- shareId 不正/期限切れ/404 ではエラー状態と発見導線を表示する。
- focusMessageId が存在しない場合も通常表示にフォールバックする。

## legal / admin / settings

### 到達手順
- legal は `#/legal/tos`、`#/legal/privacy`、`#/legal/tokushoho` を開く。
- admin は `#/admin` を開く。
- settings はアプリ共通の設定導線から開く。

### 表示チェック
- legal は戻るリンクと各文書本文が表示される。
- admin はレビュー画像/評価/重複候補の管理 UI が表示される。
- settings は設定項目と保存/閉じるが表示される。

### インタラクションチェック
- legal の戻るで discover に戻る。
- admin の評価更新/重複削除操作が確認ダイアログを経由する。
- settings の変更が保存され、再オープン後も維持される。

### 裏側連動チェック(API+persistence)
- admin は `GET /api/admin/review-images`、`GET /api/admin/review/:key`、`GET /api/admin/ratings`、`PUT /api/admin/rating`、`GET /api/admin/dedup-candidates`、`POST /api/admin/dedup-delete` を利用する。
- settings はローカル設定と認証トークンの保持に連動する。

### 異常系チェック
- admin 未認証/権限なしでは管理データを表示しない。
- legal は API なしでも必ず表示できる。
- settings 保存失敗時はユーザーに通知する。
