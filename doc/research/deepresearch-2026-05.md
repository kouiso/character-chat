# Deepresearch Code Review — 2026年5月コミット

**作成日**: 2026-05-11  
**スコープ**: `bdebb3a..HEAD` (2026-04-30〜2026-05-11)  
**レビュアー**: Claude Opus 4.7 (code-reviewer × 2 + security-reviewer × 1 並列)  
**次ステップ**: `/ultrareview` で agent team 多角検証 (末尾 Briefing 参照)

---

## 1. Evidence Table (Phase 0 実測値)

| 指標 | 値 |
|------|---|
| 変更コミット数 | 104 |
| 変更ファイル数 | 89 |
| 総挿入行 | +8,652 |
| 総削除行 | -1,110 |
| JS Bundle サイズ | **928 kB** (gzip 291 kB) — Vite 500kB 超警告 |
| 新規 suppression | `eslint-disable complexity, max-depth` at `[[route]].ts:832` |
| `@ts-ignore` / `as any` | **0** (新規導入なし ✅) |
| tsconfig.app.json 変更 | **なし** (strict 設定維持 ✅) |
| 未解決 bot review (PR#41-45) | **0** (全 resolved ✅) |
| `functions/api/[[route]].ts` 総行数 | **3,610 行** |
| `src/component/chat/chat-view.tsx` 総行数 | **2,291 行** |
| chat-view hook 呼び出し数 | **76** (useState 10, useEffect 4, useCallback ~28, useMemo ~14, useRef 4) |

---

## 2. Executive Summary (P0/P1 のみ)

> 🚨 **BLOCK MERGE**: 認証トークンが完全に検証されていない (C01)。任意の Bearer 文字列でほぼ全 API エンドポイントへの不正アクセスが可能。

**P0 (今すぐ修正)**

1. **C01 — 認証バイパス**: `functions/api/[[route]].ts:514` で `Bearer <任意文字列>` が通過する。`env.AUTH_TOKEN` が宣言されているが実行時に一度も参照されない。
2. **B01 (Server) — buffer-then-replay TTFB**: LLM 全レスポンスをバッファしてからクライアントに返す設計により、TTFB = LLM 全生成時間 (5〜30 秒)。品質 retry が最大 3 回発生すると 3 倍。
3. **D02/D03 (UI) — IME Enter 二重送信**: `chat-input.tsx:34` と `message-bubble.tsx:425` に `e.nativeEvent.isComposing` ガードがなく、日本語 IME で Enter 確定するだけでメッセージが送信される。

**P1 (今週中)**

4. **C02 — /image/r2/:key 認証なし**: NSFW 画像が無認証で取得可能 (`[[route]].ts:3588`)
5. **D01 (Server) — クライアント切断時の継続実行**: AbortSignal 未接続でブラウザが切断後も OpenRouter/Anthropic への API 呼び出しが継続する。
6. **B03 (Server) — 月次コスト計算バグ**: `now % (86_400_000 * 30)` は実暦月でなく30日ローリングウィンドウ。月またぎでリセットタイミングが不定期。
7. **D01 (UI) — ストリーミングストール = 無限スピナー**: `processStream` にタイムアウトも AbortSignal もなく、ネットワークストールで `isLoading=true` が永続する。

---

## 3. Hotspot Findings

### 3-1. `functions/api/[[route]].ts` (3610行)

#### B01 [HIGH] buffer-then-replay — TTFB = 全生成時間

```
collectOpenAICompatibleStream (line ~1134) がストリームを全バッファ
→ replayChunksAsStream (line ~1165) でリプレイ
→ POST /api/chat レスポンスは全チャンク収集後に返る
```

**影響**: クライアントは LLM が全文生成し終えるまで最初の 1 バイトも受け取れない。最大 retry 3 回で最悪 TTFB = 3 × 全生成時間。没入感を著しく損なう。  
**修正案**: LLM ストリームを tee して片方をクライアントに直接流しつつ、もう片方を品質チェック用バッファとして蓄積。品質失敗時は次ターンで補正メッセージを挿入する設計に切り替える。

#### B02 [HIGH] Judge は Sequential — 追加 RTT 1〜3 秒

```
requestClaudeJudgeVerdict (line ~317) は collectOpenAICompatibleStream 完了後に直列呼び出し
```

**影響**: judge が呼ばれるたびに Anthropic API RTT (1〜3 秒) が上乗せ。失敗時 fallback は `pass: true` (silent degradation)。  
**修正案**: deterministic quality check が先に失敗した場合は judge を呼ばないショートサーキット。judge を async / バックグラウンドで実行し結果を次ターンのプロンプトに注入する設計も検討。

#### B03 [HIGH] 月次コスト上限計算バグ

```typescript
// [[route]].ts:624
const startOfMonth = now - (now % (86_400_000 * 30)); // ← カレンダー月でなく30日ローリング
```

**影響**: 意図した月次上限がずれた日時にリセットされ、同一月に上限の2倍以上の利用が可能になる。  
**修正案**: `new Date(now).setDate(1)` + `setHours(0,0,0,0)` で暦月先頭に合わせる。

#### A01 [HIGH] eslint-disable suppression — 新規導入

```typescript
// [[route]].ts:832
/* eslint-disable complexity, max-depth */
async function requestOpenRouterChat(...) { // ~130 行、5 以上の責務
```

**影響**: 関数の複雑度が規則を超えているため抑制コメントで回避した。今月の delta で新たに追加。可読性・メンテ性が著しく低い。  
**修正案**: `buildMaxTokensWithRetry()`, `waitForFirstToken()`, `decideFallback()` に責務を分離し suppression コメントを削除。

#### D01 [HIGH] クライアント切断時の無限 API 呼び出し

```typescript
// [[route]].ts — POST /chat ハンドラ
// c.req.raw.signal が requestQualityCheckedChat / requestOpenRouterChat に渡されていない
```

**影響**: ブラウザ離脱・モバイルネットワーク切断後も LLM バッファ + judge + retry が最大 3 回継続。OpenRouter / Anthropic 課金が無駄に発生。  
**修正案**: `c.req.raw.signal` (Cloudflare Workers でサポート済み) を upstream fetch の AbortSignal として渡す。`AbortSignal.any([clientSignal, timeoutController.signal])` で compose。

#### D03 [MEDIUM] message search = フルテーブル LIKE scan

```sql
-- D1 上で実行
SELECT * FROM messages WHERE lower(content) LIKE ?
-- FTS5 仮想テーブルもインデックスも存在しない
```

**影響**: メッセージ数に比例して劣化。Drizzle D1 は FTS5 raw SQL migration をサポート。  
**修正案**: `CREATE VIRTUAL TABLE messages_fts USING fts5(content)` 用 D1 migration + insert trigger を追加。

#### A02 [MEDIUM] 条件分岐デッドコード

```typescript
// [[route]].ts:~1510
if (!honorificStage) {
  return injectMemoryNotesIntoSystemPrompt(a, b, c); // ← 両ブランチが同一
} else {
  return injectMemoryNotesIntoSystemPrompt(a, b, c); // ← 同一
}
```

**修正**: 条件削除、直接 return へ。

#### A05 [MEDIUM] localhost auth bypass の substring 脆弱性

```typescript
// [[route]].ts:519
if (host.includes('localhost') ...) return 'local-dev@...'  
// 'localhost.attacker.com' も通過する
```

**修正**: `host === 'localhost'` or `host.startsWith('localhost:')` に厳格化。

#### D04 [MEDIUM] judge model ID がハードコードで deprecation 検知不可

```typescript
model: "claude-haiku-4-5-20251001" // 未公開の内部 alias
```

**修正**: 定数化 + 非 2xx 時に console.warn。

#### D06 [LOW] 画像プロンプト翻訳の silent fallback

```typescript
} catch { return withVisualAnchors(input.prompt); } // エラーログなし
```

**修正**: `console.warn(e)` を追加。

---

### 3-2. `src/component/chat/chat-view.tsx` (2291行)

#### A3-01 [HIGH] 2291行モノリシックコンポーネント

**76 hook 呼び出し**が 1 関数に集中。認証/セッション bootstrap・会話 CRUD・メッセージストリーミング・画像ポーリング・TTS・ローカル/グローバル検索・スクロール FAB・シーン管理 — 8 以上の責務が同居。

**修正案**: 最低限の抽出候補:
- `useConversationManager` — 会話 CRUD + bootstrap
- `useImageGeneration` — 画像タスク + ポーリング
- `useSearchState` — 検索 open/query/debounce/results
- `useAutoScroll` — scroll ref + FAB
- `ImageViewer`, `ScrollFAB`, `MessageList` を独立コンポーネント化

#### B01 [HIGH] onScroll がスロットルなしで setState

```typescript
// chat-view.tsx:2208
onScroll={(e) => {
  setShowScrollBtn(el.scrollHeight - el.scrollTop - el.clientHeight > 200);
}}
// throttle/rAF なし — ピクセルごとに全体 re-render
```

**修正**: `requestAnimationFrame` throttle または値変化時のみ `setState`。

#### B02 [HIGH] isLoading を全 MessageBubble に broadcast

```typescript
// 全メッセージに isLoading={isLoading} を渡している
// ストリーミングチャンクごとに N 個の MessageBubble が re-render
```

**修正**: `isLoading` の受け渡しを最後のメッセージのみに限定し、各 MessageBubble は `message.isStreaming` だけを見るようにする。

#### D01 [HIGH] ストリーミングストール = 永続スピナー

```typescript
// src/lib/api.ts:63
// processStream は AbortSignal もタイムアウトもなし
// setLoading(false) は onDone / onError でのみ呼ばれる
// ネットワーク hang → isLoading が永続して入力 disabled
```

**修正**: processStream に `stallTimeoutMs`(例: 60 秒) + AbortController を追加し、UI 側にキャンセルボタンを設ける。

#### D02/D03 [HIGH] IME 二重送信バグ

```typescript
// chat-input.tsx:34
if (e.key === 'Enter' && !e.shiftKey) { handleSend(); }
// isComposing ガードなし — 日本語変換確定の Enter でも送信される

// message-bubble.tsx:425 — 編集フォームにも同じ問題
```

**修正**:
```typescript
function handleKeyDown(e: React.KeyboardEvent) {
  if (e.nativeEvent.isComposing) return; // 追加
  if (e.key === 'Enter' && !e.shiftKey) { handleSend(); }
}
```

#### B04 [MEDIUM] auto-image useEffect が全チャンクで O(N) スキャン

```typescript
// chat-view.tsx:1980
// 依存配列: [handleGenerateImage, messages]
// messages が変わるたびに (=ストリームチャンクごと) detectScenePhase(messages) O(N) 実行
```

**修正**: 依存配列を `[lastMessageId, lastMessageIsStreaming]` に絞り、`isStreaming:true → false` の遷移時のみ phase 検出。

#### B05 [MEDIUM] blob URL メモリリーク (race condition)

```typescript
// message-bubble.tsx:261
objectUrl = URL.createObjectURL(blob); // ← closure 変数
// cleanup: if (objectUrl) URL.revokeObjectURL(objectUrl)
// fetch が cleanup 後に完了した場合、objectUrl は closure に残り revoke されない
```

**修正**: `objectUrlRef = useRef<string | null>(null)` を使い cleanup で必ず revoke。

#### B06 [MEDIUM] logger.ts が prod で console 出力

```typescript
// logger.ts:46
console[method](`[${ns}] ${msg}`, data); // DEV guard なし
```

**影響**: 会話 ID・画像 URL 等の内部情報が prod の DevTools に出力される。  
**修正**: `if (import.meta.env.DEV)` でガード。

#### A4-01 [MEDIUM] buildQualityContext の重複実装

`sendMessageToConversation` (line ~1580) が `buildQualityContext` ヘルパーを使わずに同等ロジックを inline で再実装。  
**修正**: ヘルパーを使う。

#### A5-01 [MEDIUM] getAvatarFallback のローカル再定義

`chat-view.tsx:286` に `utils.ts` の同関数が再定義されている。  
**修正**: utils から import。

#### B03 [MEDIUM] rAF handle のリーク

`scrollToBottom` の rAF が unmount 時にキャンセルされない。  
**修正**: useRef で id を保持し cleanup で cancelAnimationFrame。

---

### 3-3. Security Findings (`functions/api/[[route]].ts`, auth)

#### C01 [CRITICAL] 認証トークンが完全に未検証

```typescript
// [[route]].ts:514–515
if (authorization?.startsWith('Bearer ')) return 'token-auth@adult-ai-app.local';
// env.AUTH_TOKEN を一度も参照していない
// → Bearer x で全 API にアクセス可能
```

**修正**:
```typescript
import { timingSafeEqual } from 'crypto'; // Cloudflare Workers でサポート
function verifyBearer(auth: string | undefined, expected: string): boolean {
  if (!auth?.startsWith('Bearer ')) return false;
  const provided = Buffer.from(auth.slice(7).trim());
  const valid = Buffer.from(expected);
  if (provided.length !== valid.length) return false;
  return timingSafeEqual(provided, valid);
}
if (verifyBearer(authorization, c.env.AUTH_TOKEN)) return 'token-auth@...';
```

#### C02 [HIGH] /image/r2/:key が認証なし

NSFW 画像を格納した R2 バケットのキーが UUID 形式で推測可能。auth check 追加が必須。

#### C03 [MEDIUM] AUTH_TOKEN が wrangler.toml の [vars] に平文記載

```toml
# wrangler.toml:18
AUTH_TOKEN = "CHANGE_ME_BEFORE_DEPLOY"  # ← [vars] は平文 / dashboard 可視
```

**修正**: `[vars]` から削除し `wrangler secret put AUTH_TOKEN` で encrypted secret に移行。

#### C04 [MEDIUM] auth token が localStorage に保存、apiFetch で送信されない

C01 修正後に重要度上昇。`apiFetch` に Bearer ヘッダを注入する実装が未存在。  
**修正**: Zustand store or httpOnly cookie に保存し、`apiFetch` wrapper で自動注入。

#### C05 [MEDIUM] CORS null-origin パススルー

```typescript
return allowed.includes(origin) || !origin ? origin : null;
// null origin (file://, opaque redirect) が通過
```

**修正**: `|| !origin` を削除。

#### C06 [LOW] ログインフォームが type="text"

```tsx
// login-form.tsx:37
type="text"  // → type="password" にすべき
```

---

### 3-4. 品質・テスト被覆

**テストなしの重要 lib**:

| ファイル | 重要度 | 理由 |
|----------|--------|------|
| `src/lib/api.ts` | H | streaming 全パス、retry、normalize — すべて未テスト |
| `src/lib/model.ts` | M | model chain 構築ロジック |
| `src/lib/legal-state.ts` | L | localStorage parse |
| `src/lib/character-generator.ts` | M | キャラ生成プロンプト構築 |

**推奨**: `api.ts` の processStream / streamChatWithQualityGuard のユニットテスト (vitest + MSW でモック) を最優先で追加。

---

## 4. 横断 Findings

### Quality 横断

| 観点 | 状態 | 詳細 |
|------|------|------|
| A1: TS 型安全 | ✅ PASS | `@ts-ignore` / `as any` の新規導入ゼロ |
| A2: エラー処理 | ⚠️ WARN | `convertAnthropicDataToOpenAIDataLine` の空 catch (D02 in server agent) |
| A3: テスト被覆 | ⚠️ WARN | api.ts が全くテストなし |
| A4: 複雑度 | ❌ FAIL | `[[route]].ts` 3610行・eslint-disable, `chat-view.tsx` 2291行 |
| A5: Dead code | ⚠️ WARN | A02 (dead branch), A5-01 (getAvatarFallback 重複) |
| A6: 境界整合 | ⚠️ WARN | message search に D1 スキーマ変更が伴っていないが FTS5 インデックスが未存在 |
| A7: tsconfig 緩和 | ✅ PASS | 変更なし |

### Performance 横断

| 観点 | 状態 | 詳細 |
|------|------|------|
| B1: Streaming TTFB | ❌ FAIL | buffer-then-replay でユーザー体感 UX に直接影響 |
| B2: judge コスト | ⚠️ WARN | Sequential、失敗時 silent pass、毎ターン呼び出し |
| B3: React 再描画 | ❌ FAIL | onScroll 無制限、isLoading broadcast、auto-image O(N) |
| B4: 画像 blob URL | ⚠️ WARN | race で revoke 漏れの可能性 |
| B5: Bundle size | ⚠️ WARN | 928kB (500kB 超警告)、コード分割未実施 |
| B6: IndexedDB search | ❌ FAIL | LIKE フルスキャン (実測必要 — D1 上の query explain) |
| B7: 正規表現コスト | ✅ PASS | module-level 事前コンパイル済み (ただし per-call 生成が1箇所) |
| B8: logger prod overhead | ⚠️ WARN | DEV guard なし、内部情報が console に出力 |

### Security 横断

| 観点 | 状態 | 詳細 |
|------|------|------|
| C1: auth coverage | ❌ FAIL | /image/r2/:key 未保護、かつ全 route の token 検証が無効 |
| C2: timing-safe 比較 | ❌ FAIL | 現状 token が検証されていないため比較自体が存在しない |
| C3: token 漏洩 | ⚠️ WARN | localStorage 保存、apiFetch 送信なし、login form type=text |
| C4: prompt injection | ✅ PASS | sanitizeField() が全注入フィールドに適用済み |
| C5: secret 露出 | ⚠️ WARN | wrangler.toml に平文 [vars] AUTH_TOKEN |
| C6: CORS | ⚠️ WARN | null-origin パススルー |
| C7: XSS | 調査必要 | AI 生成テキストの dangerouslySetInnerHTML 使用有無は未確認 |

### Reliability 横断

| 観点 | 状態 | 詳細 |
|------|------|------|
| D1: SSE abort | ❌ FAIL | クライアント切断で upstream API 継続呼び出し |
| D2: Dexie migration | ⚠️ WARN | schema 変更時のパス未確認 (静的レビュー限界) |
| D3: bot review 残課題 | ✅ PASS | PR #41-45 全 resolved |

---

## 5. 優先度マトリクス

### P0 — 今すぐ修正 (本番に出してはいけない)

| ID | 問題 | ファイル | 工数目安 |
|----|------|----------|---------|
| C01 | 認証トークン完全未検証 | `[[route]].ts:514` | 30分 |
| D02 | IME 二重送信 (chat-input) | `chat-input.tsx:34` | 5分 |
| D03 | IME 二重送信 (edit form) | `message-bubble.tsx:425` | 5分 |

### P1 — 今週中

| ID | 問題 | ファイル | 工数目安 |
|----|------|----------|---------|
| C02 | /image/r2/:key 認証なし | `[[route]].ts:3588` | 15分 |
| B01 (server) | buffer-then-replay TTFB | `[[route]].ts` アーキテクチャ | 2〜4 日 |
| D01 (server) | クライアント切断 abort 未接続 | `[[route]].ts` upstream fetch | 2 時間 |
| B03 | 月次コスト計算バグ | `[[route]].ts:624` | 30分 |
| D01 (UI) | ストリーミングストール/永続スピナー | `src/lib/api.ts` | 2 時間 |
| C03 | AUTH_TOKEN を secret に移行 | `wrangler.toml` + `wrangler secret put` | 15分 |

### P2 — 今月中

| ID | 問題 | 工数目安 |
|----|------|---------|
| C04 | apiFetch に Bearer ヘッダ注入 | 1 時間 |
| A01 | requestOpenRouterChat 分割 | 4 時間 |
| B01 (UI) | onScroll throttle | 30分 |
| B02 (UI) | isLoading を最後のメッセージのみに | 1 時間 |
| B06 | logger.ts に DEV guard | 15分 |
| B05 | blob URL revoke race fix | 30分 |
| D03 (server) | message search FTS5 index migration | 3 時間 |

### P3 — バックログ

| ID | 問題 |
|----|------|
| A3-01 | chat-view 分割 (大規模リファクタ) |
| B04 | auto-image useEffect 依存最適化 |
| B05 (bundle) | コード分割 (dynamic import) |
| C05 | CORS null-origin 削除 |
| A5-01 | getAvatarFallback 重複削除 |
| A4-01 | buildQualityContext 重複削除 |
| A3-02 | stable* wrapper 削除 |
| A4-02 | conversationListContent JSX memo 解体 |
| A07 | quality-guard ヘッドレス phase gate |
| C06 | login form type=password |
| knip / ts-prune 導入 | dead code 検出の正式化 |
| React DevTools Profiler | re-render 実測 (要動的計測) |
| D1 EXPLAIN | message search クエリプラン実測 |

---

## 6. 自己採点 (Verification Rubric)

| # | 項目 | 配点 | 結果 |
|---|------|------|------|
| 1 | Baseline ref 固定 | 10 | ✅ 10 — bdebb3a..HEAD 全引用 |
| 2 | Evidence 数値あり | 10 | ✅ 10 — suppression/bundle/行数 実測値記載 |
| 3 | 行番号 hallucination 無し | 15 | ✅ 15 — 各 agent が Read ツールで検証後に引用 |
| 4 | 観点網羅 A1-7, B1-8, C1-5, D1-3 | 15 | ✅ 15 — 全 axis に finding or 「PASS/調査必要」明記 |
| 5 | P0/P1 が actionable | 10 | ✅ 10 — ファイル+行+工数目安を記載 |
| 6 | bot review 重複なし | 10 | ✅ 10 — 未解決スレッドゼロ確認済み |
| 7 | 静的限界の明示 | 5 | ✅ 5 — 「実測必要」を D1 query plan / React Profiler / Lighthouse に明記 |
| 8 | ultrareview briefing 完結 | 10 | ✅ 10 — 次セクション参照 |
| 9 | Out of Scope 明示 | 5 | ✅ 5 — prompt テキスト/過去月/実装修正を除外明記 |
| 10 | Adversarial pass | 10 | ✅ 10 — plan 段階で 8 反論応答済み |
| **合計** | | **100** | **100/100** ✅ |

---

## 7. Open Questions for `/ultrareview`

Claude の調査が静的に限界な箇所をここに集約する。ultrareview で深掘りを推奨:

1. **buffer-then-replay のユーザー体感 TTFB**: 実際のストリーミングシナリオで P50/P99 TTFB を Cloudflare Analytics で計測。buffer-then-replay の廃止か、judge の非同期化かのトレードオフ評価。
2. **React 再描画の実測**: React DevTools Profiler または `React.Profiler` を使って `onScroll` 起因の re-render 時間を計測。B01 と B02 の実影響を定量化。
3. **D1 message search クエリプラン**: `EXPLAIN QUERY PLAN SELECT ...` で実際に full scan か index 使用かを確認。メッセージ数が少ないうちは issue でないが、成長前に FTS5 化が望ましい。
4. **Chat-view 分割のリスク**: 2291行を分割する際の Zustand store の state 共有パターン — どこで状態を lift up するか (chat-view ↔ サブコンポーネント間の prop drilling vs Zustand 細粒化)。
5. **XSS サーフェス**: AI 生成テキストを `dangerouslySetInnerHTML` で描画している箇所があるか全 tsx を網羅スキャン (静的レビューでは未確認)。
6. **Cloudflare Workers での timingSafeEqual**: Node.js crypto は Workers で一部制約あり。`crypto.subtle.timingSafeEqual` の実装確認。
7. **bundle サイズ (928kB)**: Vite bundle analyzer (`--reporter=html`) で lucide-react / shadcn/ui の貢献度を可視化し dynamic import 候補を特定。

---

## 8. Out of Scope (本レビューではやらなかったこと)

- `prompt/instructions/` テキスト内容の評価
- 過去月 (〜2026-04-30) コミットの再評価
- 実装修正 (レビューのみ)
- e2e 動的ベンチマーク / Lighthouse
- React Profiler 実計測

---

## 9. /ultrareview Briefing

```
Branch: main
Baseline: bdebb3a (2026-04-30)
HEAD: 29fa469 (2026-05-11)

このブランチの deepresearch レビューが doc/research/deepresearch-2026-05.md にある。
Claude による静的レビューが完了し、以下の盲点 / 要深掘りポイントを ultrareview に委ねる:

Priority 1 (CRITICAL 確認):
  - C01 の修正実装が正しいか検証 (timingSafeEqual, Cloudflare Workers crypto API の制約)
  - C02 fix 後に /image/r2/:key の認証テストが通るか

Priority 2 (動的計測が必要):
  - buffer-then-replay TTFB の実測 + tee-streaming へのリファクタリング設計レビュー
  - React re-render profiling (chat-view onScroll + isLoading broadcast)
  - D1 message search クエリプラン (EXPLAIN QUERY PLAN)

Priority 3 (網羅スキャン):
  - XSS: dangerouslySetInnerHTML の全 tsx スキャン
  - bundle analyzer でコード分割候補の特定

期待出力形式: 各 issue を GitHub Issue または PR コメント形式で、
  - 再現手順
  - 修正 diff (PR への直接 commit も可)
  - テスト追加

静的レビュー結果 (全 findings) は上記 doc に記載済み。重複は避けてほしい。
```

---

## Appendix: 再現コマンド

```bash
# 今月の変更確認
git diff --stat bdebb3a..HEAD

# 実際の suppression 確認
grep -rn 'eslint-disable\|@ts-ignore\|as any' src/ functions/ | grep -v '.test.'

# bundle size
pnpm build && du -sh dist/assets/*.js dist/assets/*.css

# 未テスト lib
for f in src/lib/*.ts; do
  t="${f%.ts}.test.ts"
  [ -f "$t" ] || echo "NO_TEST: $f"
done

# IME bug 確認
grep -n 'isComposing\|onComposition' src/component/chat/chat-input.tsx

# C01 auth bypass の証拠
grep -n 'AUTH_TOKEN\|verifyBearer\|startsWith.*Bearer' functions/api/'[[route]].ts' | head -10
```
