# ユビキタス言語 — adult-ai-app

このドキュメントはプロジェクト全体で共有する用語の定義集。コード・ドキュメント・会話で同じ言葉を使うことで認知負荷を下げる。

---

## ドキュメントメタ

| 項目 | 値 |
|---|---|
| 最終確認コミット | `450035a` |
| 確認日 | 2026-05-11 |
| 確認対象ブランチ | `main` |

**更新トリガーファイル**（変更した時はこのドキュメントも見直す）：

| ファイル | 影響する用語 |
|---|---|
| `src/store/chat-store.ts` | ChatMessage |
| `src/lib/api.ts` | ConversationSummary, PersistedMessage |
| `src/schema/character.ts` | Character（DB層） |
| `src/schema/message.ts` | PersistedMessage |
| `src/schema/conversation.ts` | ConversationSummary |
| `src/lib/prompt-builder.ts` | Character（SP層）, EroticProfile, Relationship, HonorificStage |
| `src/lib/scene-phase.ts` | ScenePhase |
| `src/lib/chat-message-adapter.ts` | QualityCheck, PersonaReminder, LangReminder, AntiRepetition |
| `src/lib/tts-constants.ts` | SpeechSynthesis, VoiceType |
| `functions/api/[[route]].ts` | ModelRouting, QualityRetry, RateLimit |

---

## 境界コンテキスト（Bounded Context）一覧

| コンテキスト | 主な関心事 |
|---|---|
| [会話](#会話コンテキスト) | メッセージの送受信・ストリーミング・永続化・モデルルーティング |
| [キャラクター](#キャラクターコンテキスト) | ペルソナ管理・一人称・ドリフト防止・関係性・エロプロファイル |
| [シーン](#シーンコンテキスト) | フェーズ遷移・プラットフォームルール |
| [品質](#品質コンテキスト) | チェック・リトライ・Judge |
| [画像生成](#画像生成コンテキスト) | Novita 連携・R2 永続化 |
| [プラットフォーム](#プラットフォームコンテキスト) | 認証・年齢確認・レート制限・音声合成 |

---

## 会話コンテキスト

### ChatMessage（チャットメッセージ）

> **注意**: ChatMessage は Zustand ストア（フロントエンド専用）の型。D1 の DB 永続化形式は [PersistedMessage](#persistedmessage永続化済みメッセージ) を参照。両者は別物。

ソース: `src/store/chat-store.ts` — `interface ChatMessage`

| フィールド | 型 | 説明 |
|---|---|---|
| id | string | メッセージ識別子 |
| role | `"user" \| "assistant" \| "system"` | 発言者。`"system"` は API には送るが UI には表示しない |
| content | string | 本文。アシスタントは XmlResponse 形式が標準 |
| createdAt | number? | Unix タイムスタンプ（DB 復元時のみ設定。ストリーミング中は未設定の場合あり） |
| imageUrl | string? | 表示用画像 URL。R2 永続化後は `/api/image/r2/:key` 形式に上書きされる |
| isStreaming | boolean? | ストリーミング受信中フラグ。`true` のうちは API 送信対象から除外 |
| error | boolean? | エラー状態フラグ。リトライ成功時に明示的にクリアされる |
| warningLevel | boolean? | 品質チェックが警告レベルで通過したことを示す。MessageBubble の警告表示に使用 |

> **imageKey について**: フロント ChatMessage に `imageKey` フィールドは存在しない。R2 永続化後の URL（`/api/image/r2/:key`）を `imageUrl` として格納する設計。imageKey は DB と PersistedMessage のみで保持する。

### ConversationSummary（会話サマリ）

会話一覧に表示されるオブジェクト。DB の `conversation` テーブルとキャラクタージョインの結果を含む。フル履歴は別 API で取得する。

ソース: `src/lib/api.ts` — `conversationSummarySchema`

| フィールド | 型 | 説明 |
|---|---|---|
| id | string | プライマリキー |
| title | string | 会話タイトル（自動生成または手動編集） |
| createdAt | number | 作成日時（Unix タイムスタンプ） |
| updatedAt | number | 最終更新日時（一覧ソートキー） |
| characterId | string | 紐付くキャラクターの ID |
| characterName | string | キャラクター名（join 済み） |
| characterGreeting | string | キャラクターの初回メッセージ（join 済み） |
| characterSystemPrompt | string | キャラクターのシステムプロンプト全文（join 済み） |
| characterAvatar | string \| null | アバター URL（join 済み） |

### PersistedMessage（永続化済みメッセージ）

D1 に保存済みのメッセージを API が返す際のシリアライズ形式。imageUrl と imageKey が共存するのは段階移行中のため。

ソース: `src/lib/api.ts` — `persistedMessageSchema`

| フィールド | 型 | 説明 |
|---|---|---|
| id | string | プライマリキー |
| role | `"system" \| "user" \| "assistant"` | 発言者 |
| content | string | 本文 |
| imageUrl | string \| null \| undefined | Novita 一時 URL（TTL あり）。imageKey 移行中につき共存 |
| imageKey | string \| null \| undefined | R2 オブジェクトキー（imageUrl の後継） |
| createdAt | number | 作成日時 |

### ApiMessage（APIメッセージ）

OpenAI 互換形式に変換した後のメッセージ。`role: "system"` を含む。`content` は最大 20,000 文字でクリップ。

### SystemPrompt（システムプロンプト）

キャラクター設定・プラットフォームルール・ペルソナリマインダーを結合した文字列。会話 API コール時に先頭に挿入する。内部は `【セクション名】` マーカーで区切られた名前付きセクション構造を持つ。

### PersonaReminder（ペルソナリマインダー）

3ユーザーターン（`USER_TURNS_PER_REMINDER = 3`）ごとに注入するシステムメッセージ。キャラクターの一人称・語尾・禁止ワードを再提示して PersonaDrift を防ぐ。

### DriftCorrectionReminder（ドリフト補正リマインダー）

`wrong-first-person` が検知された直後に注入する強めの修正指示。通常の PersonaReminder より強い表現を使う。

### LangReminder（言語リマインダー）

最後のユーザーメッセージ直前に注入するシステムメッセージ。LLM が英語で思考・出力するのを防ぐ。

内容: 「出力はすべて日本語のみ。英語や他言語を出力に含めないこと。推論過程も見せないこと」

ソース: `src/lib/chat-message-adapter.ts` — `LANG_REMINDER`

### StreamingContent（ストリーミング中コンテンツ）

SSE チャンクが到着中の状態。`ChatMessage.isStreaming = true` で表現され、UI は typing dots を表示し、API には送らない。

### XmlResponse（XML応答）

アシスタントの標準応答フォーマット。タグ構造：

```xml
<response>
  <action>行動・情景描写</action>
  <dialogue>「セリフ」</dialogue>
  <inner>心理描写（climax/erotic では必須）</inner>
  <narration>場面ナレーション（任意）</narration>
  <remember>内部メモ（ユーザーに非表示）</remember>
</response>
```

### MemoryNote（メモリノート）

`<remember>` タグ内のキャラクター内部メモ。次回以降のシステムプロンプトに文脈として注入して長期記憶を実現する。

### UserProfile（ユーザープロファイル）

ユーザー自身に関する任意の自由記述文字列。`buildMessagesForApi()` に渡されると `【ユーザー情報】` ブロックとしてシステムメッセージに注入され、キャラクターの応答をパーソナライズする。LLM メタトークン無害化とアプリ固有マーカー除去を経てから注入する。

### ModelRouting（モデルルーティング）

Claude 系モデルは Anthropic API に直接送信し、それ以外は OpenRouter 経由にする分岐ロジック。`requestRoutedChat()` が管理する。

ソース: `functions/api/[[route]].ts` — `type ChatProvider = "anthropic" | "openrouter"`

| Provider | 対象モデル | 用途 |
|---|---|---|
| `anthropic` | claude-* 系 | ClaudeJudge・ルーティングチャット |
| `openrouter` | それ以外（Qwen 等） | メインのキャラクター会話 |

### SearchScope（検索スコープ）

メッセージ検索の対象範囲。`"current"` = 現在の会話のみ、`"all"` = 全会話横断。

---

## キャラクターコンテキスト

### Character（キャラクター）

ユーザーが作成または AI 生成したペルソナ。属性には **DB フィールド層** と **SystemPrompt 内セクション層** の2層がある。両者を混同しないこと。

#### DB フィールド層（`src/schema/character.ts`）

| フィールド | 型 | 説明 |
|---|---|---|
| id | string | プライマリキー |
| userId | string | オーナー |
| name | string | キャラクター名 |
| avatar | string? | アバター画像 URL |
| systemPrompt | string | 全ペルソナ設定を格納するテキスト（以下の SP セクション群を内包） |
| greeting | string | 初回メッセージ |
| tags | string[] | 検索・分類用タグ |
| createdAt | number | 作成日時 |

#### SystemPrompt 内セクション層（`src/lib/prompt-builder.ts`）

`systemPrompt` テキスト内に `【セクション名】` マーカーで区切られて埋め込まれる。独立した DB フィールドではない。定数値はソースコードから直接確認済み。

| セクション | 定数名 | マーカー値（実値） | 内容 |
|---|---|---|---|
| 性格・口調 | `SECTION_PERSONALITY` | `"【キャラクター】"` | 名前 + 性格・話し方の記述 |
| 外見 | `SECTION_APPEARANCE` | `"【外見】"` | 髪色・体型・服装等の外見描写 |
| 関係性 | `SECTION_RELATIONSHIP` | `"【関係性】"` | ユーザーとの親密度・関係の文脈 |
| 出会いの状況 | `SECTION_SCENARIO` | `"【シナリオ】"` | キャラクターとユーザーの設定上の状況 |
| 追加設定 | `SECTION_CUSTOM` | `"【追加設定】"` | UI の「こだわり」入力欄の内容 |
| 口調サンプル | `SECTION_SPEECH_STYLE` | `"【口調サンプル】"` | 語尾・口癖・禁止ワード等の話し方特徴 |
| エロプロファイル | `SECTION_EROTIC_PROFILE` | `"【キャラクター性的特徴】"` | 性的感度・敏感な部位・性癖等（最大 2000 文字） |
| シーン品質ルール | `SECTION_SCENE_RULES` | `"【シーン品質ルール】"` | エロプロファイルがある場合にのみ自動付与 |
| キャラカード | `SECTION_CARD` | `"【キャラカード】"` | SceneCard 由来キャラクター情報 |

#### CharacterFormState（UI 編集フォームの入力項目）

UI 上でユーザーが直接編集できるフィールド。ソース: `src/component/character/character-manager.tsx`

| フィールド | 対応する SP セクション / DB フィールド |
|---|---|
| name | `SECTION_PERSONALITY` 内の `名前:` 行 |
| personality | `SECTION_PERSONALITY` 本文 |
| scenario | `SECTION_SCENARIO` |
| eroticProfile | `SECTION_EROTIC_PROFILE` |
| customPrompt | `SECTION_CUSTOM` |
| greeting | DB の `greeting` フィールド（SP 外） |
| avatar | DB の `avatar` フィールド（SP 外） |
| tagsRaw | DB の `tags` フィールド（SP 外） |

> `appearance`・`speechStyle` はフォームフィールドではなく AI 生成（CharacterWizard）または SceneCard 経由で構成される。

### DefaultCharacter（デフォルトキャラクター）

アプリ組み込みのキャラクター。`DEFAULT_CHARACTER_ID` で識別。削除・上書き不可。

### GeneratedCharacter（AI生成キャラクター）

CharacterWizard が LLM に生成させた下書き。`eroticProfile` を含む。ユーザーが確認・編集してから保存する。

ソース: `src/lib/character-generator.ts`

### EroticProfile（エロプロファイル）

キャラクターの性的感度・敏感な部位・性癖等を記述したテキスト（最大 2000 文字）。**シーンチャットが存在する場合にのみ** システムプロンプトに `【キャラクター性的特徴】` セクションとして注入される。このセクションが存在すると `SENSITIVE_SPOTS_ROTATION_RULE`（感度部位ローテーションルール）と `QUALITY_EXEMPLAR`（品質例示）も自動付与される。

ソース: `src/lib/prompt-builder.ts` — `SECTION_EROTIC_PROFILE = "【キャラクター性的特徴】"`

### Relationship（関係性）

SceneStartCharacter が持つフィールド。シーン開始時のキャラクターとユーザーの関係の文脈（例: 幼馴染・同僚・初対面等）を格納し、`【関係性】` セクションとして SystemPrompt に注入する。HonorificStage と組み合わせてキャラクターの言葉遣いの親密度を決定する。

ソース: `src/lib/prompt-builder.ts` — `SECTION_RELATIONSHIP = "【関係性】"`

### FirstPerson（一人称）

キャラクターが自分を指す代名詞（私・僕・俺 等、13種）。`extractFirstPerson()` でシステムプロンプトから抽出。逸脱すると **PersonaDrift** として検知される。

### PersonaDrift（ペルソナドリフト）

キャラクターが指定の一人称・語尾・口調から逸脱した状態。品質チェック `wrong-first-person` で検知し DriftCorrectionReminder を注入する。

### HonorificStage（呼称ステージ）

累積メッセージ数に応じてキャラクターがユーザーを呼ぶ敬称・親しみ度を段階的に変化させる仕組み。`getHonorificStage(totalMessageCount)` で計算する。

ソース: `src/lib/prompt-builder.ts`

| 累積メッセージ数 | 呼称指示の例 |
|---|---|
| 0–10 | 苗字 + さん（例: 佐藤さん） |
| 11–50 | 苗字呼び捨て or 名前 + さん |
| 51–200 | 名前（例: 健太） |
| 201〜 | 愛称 or 2人だけの呼び方（例: けんちゃん） |

> **旧エイリアス**: `getCallingStyleInstruction()` は互換エイリアス。新規コードでは `getHonorificStage()` を使う。

### VisualAnchor（ビジュアルアンカー）

キャラクターの外見特徴を正規化した構造体（髪色・目の色・体型等）。画像生成プロンプトと会話プロンプトの両方に注入してキャラクター一貫性を保つ。

### EmotionalArc（感情アーク）

フェーズごとの感情推移の記述（例: intimate フェーズ：緊張→ときめき→甘え）。`extractEmotionalArc()` でシステムプロンプトから抽出し、フェーズ遷移時に強調注入する。

### CharacterWizard（キャラクターウィザード）

3ステップのキャラクター作成 UI。

| ステップ | 内容 |
|---|---|
| Step 1 | 属性チップ選択（types・relations・personalities・bodyTypes・freeText） |
| Step 2 | シチュエーション選択 + こだわり入力 |
| Step 3 | 生成結果プレビュー（eroticProfile を含む）+ フィードバック付き再生成 |

---

## シーンコンテキスト

### ScenePhase（シーンフェーズ）

会話の熱量を5段階で表す。LLM へのトークン上限・プラットフォームルール・画像タグを切り替える核心概念。

ソース: `src/lib/scene-phase.ts`

| フェーズ | 意味 | トークン上限 |
|---|---|---|
| `conversation` | 日常会話 | 1024 |
| `intimate` | 親密（キス・抱擁・愛撫まで。挿入なし） | 1536 |
| `erotic` | 性的（挿入あり・絶頂なし） | 2048 |
| `climax` | 絶頂 | 2560 |
| `afterglow` | 余韻・事後 | 1536 |

### PhaseDetection（フェーズ検知）

直近のユーザー発言をキーワードマッチしてフェーズを判定する処理。`normalizePhaseScanText()` で正規化後に各フェーズの検知キーワードと照合する。品質リトライ由来のメッセージ（`isQualityRetryUserMessage()`）はスキャン対象外。

### PhaseCeiling（フェーズ天井）

フェーズごとに許容する最大の描写レベル。`intimate` は挿入を禁止、`erotic` は絶頂を禁止するなど、段階的に制御する。

### SceneCard（シーンカード）

管理者が定義した既製シナリオ。title・summary・firstMessage・character フィルターを持ち、ユーザーがシーンを選んで素早く開始できる。`SECTION_CARD` セクションを持つ SceneStartCharacter と組み合わせて使う。

### SensoryMandate（感覚指示）

視覚・触覚・嗅覚・聴覚・味覚をターンごとに回転させる指示。毎ターン同じ感覚に偏るのを防ぎ、描写の多様性を維持する。`buildSpecificSensoryMandate()` で生成する。

### PlatformBaseInstruction（プラットフォーム基底指示）

`conversation` 用と `scene`（intimate 以上）用の2種。フェーズに応じて `buildPlatformPrefix()` が切り替えて注入する。

### AfterglowLookback（アフターグロールックバック）

afterglow フェーズを検知するために参照する過去ターン数（`AFTERGLOW_LOOKBACK_TURNS = 6`）。直近6ターン以内に climax キーワードがあれば afterglow と判定する。

---

## 品質コンテキスト

### QualityCheck（品質チェック）

アシスタント応答を送信前に検査するルール群。失敗すると QualityRetry に入る。

ソース: `src/lib/chat-message-adapter.ts`

| チェックキー | 検出内容 | 適用フェーズ |
|---|---|---|
| `wrong-first-person` | 一人称の逸脱 | 全フェーズ |
| `meta_remark` | メタ的な説明口調 | 全フェーズ |
| `user-leak` | 「ユーザー」という語の露出 | 全フェーズ |
| `conversation-over-escalation` | conversation フェーズでの身体接触 | conversation のみ |
| `within-turn-repetition` | 同一ターン内のフレーズ重複 | 全フェーズ |
| `cross-turn-repetition` | 前ターン表現の繰り返し | 全フェーズ |
| `max-length-exceeded` | 応答が長すぎる | 全フェーズ |
| `multilingual-leak` | 日本語以外の言語の混入 | 全フェーズ |
| `no-english` | 英字の混入 | 全フェーズ |
| `xml-format-missing` | XML 構造の欠落 | 全フェーズ |
| `scene-min-length` | シーンフェーズで短すぎる | intimate 以上 |
| `self-third-person-action` | キャラクター名を主語に使っている | 全フェーズ |
| `inner-missing` | `<inner>` タグの欠落 | climax / erotic |
| `claude-judge` | ClaudeJudge による総合評価 | 全フェーズ |

### QualityRetry（品質リトライ）

品質チェック失敗時に FailureHint を付けてもう一度 LLM を呼ぶ処理。上限は環境変数 `MAX_QUALITY_RETRIES` で制御する（コードのデフォルト値 `MAX_SERVER_RETRIES = 3`、ローカル `.dev.vars` では `1` にオーバーライド）。

### FailureHint（失敗ヒント）

QualityRetry 時に追加するチェック種別ごとの修正指示文。「○○を直せ」と具体的に伝えて再生成の精度を上げる。

### ClaudeJudge（Claude判定）

Anthropic API を直接呼んで応答品質を評価するサブシステム。`POST /judge` エンドポイントで実行。401 などの失敗時は `pass: true` でフォールバックする。

### AntiRepetition（繰り返し防止）

過去のアシスタント応答から使用済みフレーズを抽出し、次の生成で禁止するシステム。`ANTI_REPETITION_BANNED_PHRASES`（58句）との照合も行う。

---

## 画像生成コンテキスト

### ImageGeneration（画像生成）

Novita API に対してシーンの状況を SD タグに変換して送信するプロセス。

### ImageTag（画像タグ）

Stable Diffusion に渡すカンマ区切りのプロンプト。`translatePromptToImageTags()` が会話テキストから生成し、フェーズに応じて explicit タグを追加する。

### AutoImageGeneration（自動画像生成）

フェーズ遷移を検知したとき、3ターン目以降（`AUTO_IMAGE_RECENT_TURN_LIMIT = 3`）に自動で画像生成をトリガーする機能。

### ImagePersistence（画像永続化）

Novita が返した一時 URL（TTL あり）を `POST /image/persist` で R2 にコピーして永続化する処理。SSRF 対策として `ALLOWED_IMAGE_HOSTS` ホワイトリストで URL を検証する。R2 保存後は `imageKey` を取得し、`ChatMessage.imageUrl` を `/api/image/r2/:key` 形式に差し替える。

### ImageKey（画像キー）

Cloudflare R2 に保存した画像のオブジェクトキー。DB の `message.imageKey` と `PersistedMessage.imageKey` で保持する。フロントエンドはこのキーを直接使用せず、`/api/image/r2/:key` として解決された URL を `ChatMessage.imageUrl` に格納する。

ソース: `src/schema/message.ts` の `imageKey` フィールド, `GET /image/r2/:key` エンドポイント

### NsfwBlur（NSFWブラー）

NSFW コンテンツをぼかし表示にするトグル。設定ストアで管理し、MessageBubble に `nsfwBlur` prop として渡す。

---

## プラットフォームコンテキスト

### AgeGate（年齢確認）

初回アクセス時に表示する成人確認モーダル。承認後は localStorage に90日間保持。未確認ユーザーはアプリコンテンツにアクセスできない。

### AuthToken（認証トークン）

`auth_token` として localStorage に保存するセッショントークン。API リクエストの `Authorization: Bearer` ヘッダーで送信。

### RateLimit（レート制限）

ユーザーごとの1日あたりリクエスト数と月間コスト上限。`POST /chat` 前に検査し、超過時はエラー返却。

### SearchSnippet（検索スニペット）

メッセージ検索結果に表示するテキスト抜粋。マッチ箇所を中心に前後64文字（`SEARCH_SNIPPET_RADIUS`）、最大160文字で「…」付きで切り出す。

### SpeechSynthesis（音声合成）

Web Speech API を利用してアシスタントの発言をキャラクターボイスで読み上げる機能。`use-speech-synthesis` フックが管理する。iOS PWA では初回ユーザージェスチャー時に空発話でウォームアップが必要（無音 utterance を発話してキャンセルする）。

ソース: `src/hook/use-speech-synthesis.ts`, `src/lib/tts-constants.ts`

| VoiceType | 意味 | 代表例（macOS） |
|---|---|---|
| `female-high` | 女性（高め・明るい）| Kyoko, O-Ren, Sayaka |
| `female-calm` | 女性（落ち着き）| Nanami, Haruka |
| `male` | 男性 | Otoya, Hattori |
| `synthetic` | 合成音声（Google / Microsoft Edge 等）| Google 日本語 |
| `multilingual` | クラウド系多言語音声 | Microsoft Online 系 |
| `other` | その他 | — |

---

## 略語・コード内短縮形

| コード表記 | 意味 |
|---|---|
| `phase` | ScenePhase |
| `msgs` | ChatMessage の配列 |
| `systemPrompt` | SystemPrompt（`sp` という略は使われていない） |
| `qualityContext` | QualityCheck 結果セット |
| `failedCheck` | 失敗した QualityCheck のキー |
| `env` | Cloudflare Workers の環境変数バインディング |
| `convId` | ConversationSummary の id |
| `msgId` | ChatMessage の id |
| `totalMessageCount` | 累積メッセージ数（HonorificStage の入力値）|

---

## 命名規則サマリ

| 対象 | 規則 | 例 |
|---|---|---|
| ファイル・ディレクトリ | kebab-case 単数形 | `chat-input.tsx`, `scene-phase.ts` |
| React コンポーネント | PascalCase | `ChatInput`, `MessageBubble` |
| 変数・関数 | camelCase | `buildMessagesForApi`, `currentPhase` |
| 型・インターフェース | PascalCase + 具体名 | `ChatInputProps`, `ScenePhase` |
| 定数 | UPPER_SNAKE_CASE | `AUTO_IMAGE_RECENT_TURN_LIMIT` |
| コードコメント | 日本語のみ（Why・制約・非自明な理由） | — |

---

## 使ってはいけない用語（Deprecated / 曖昧語）

| 禁止表記 | 理由 | 代替 |
|---|---|---|
| `imageUrl` でR2画像を指す | TTL付き Novita URL と混同する | R2 URL は `/api/image/r2/:key` 形式の `imageUrl`、キーは `imageKey` |
| 「ユーザー」をキャラクターに呼ばせる | `user-leak` 品質チェックで弾かれる | 自然な呼称や名前を使う |
| `getCallingStyleInstruction` | `getHonorificStage` の旧エイリアス | `getHonorificStage` を使う |
| 「フェーズ天井」以外の表記（上限・cap 等） | 用語が揺れる | PhaseCeiling / フェーズ天井に統一 |
| `sp` を SystemPrompt の略として使う | コードベースに `sp` という略は存在しない | `systemPrompt` をそのまま使う |
| Character の SP 内属性を「DB フィールド」と呼ぶ | `personality` 等は DB に存在せず `systemPrompt` テキスト内のセクション | 「SP 層の属性」または「`【セクション名】` セクション」と呼ぶ |
| `SECTION_EROTIC_PROFILE` を「【エロプロファイル】」と表記する | 実際のマーカー値は `"【キャラクター性的特徴】"` | `"【キャラクター性的特徴】"` と正確に記載する |
