# Novita / Runware 画像生成 API 完全リファレンス（自作プラグイン）

**目的**: 画像生成のたびに「毎回違う答え」になるのを機構的に根絶する。このファイルが唯一の真実（single source of truth）。再調査したくなったらまずここを読む。

**確定日**: 2026-07-13（局長プラン反映）。`⚠️要検証` が付いた項目だけ本番コンソールで実額・body を取得する。それ以外は再調査不要。

---

## 0. モデル固定（絶対厳守）

- キャラ画像生成のモデルは **`waiNSFWIllustrious_v90_1187991.safetensors` 以外使わない**（局長指示 2026-07-12）。
- **Runware の `aiadultapp:waiillustrious@9` は同一ファイル**（CivitAI 827184 v9.0 = versionId 1283437・SHA256接頭 `178FC987B2` が Novita/CivitAI/Runware 3者のAPIレコードで一致・2026-07-18確認。ファイル名の「1187991」は v9.0 初版アップの旧versionIdの名残で、バージョン違いやない）→ **Runware経由の推論もモデル固定ルール内**。
- codex（Cloud / bg-MCP）経由の画像生成・macmini `$imagegen` は **どちらも禁止**。Novita API（LoRA無し）／Runware API（LoRA有り・§1.8）を直接叩く。
- 生成前に **枚数と概算コストを局長に提示**する（下記コスト式で計算）。

### 0.1 provider選択の決定表（2026-07-18確定・sakura 10点実証）

| 用途 | provider | 理由 |
|---|---|---|
| **キャラLoRA画像**（身元固定） | **Runware一択** | Novita共有APIは自作Illustrious LoRAを構造的に弾く（whitelist 77/2589・Illustrious系0個・実測400） |
| LoRA無し素画像 | Novita本命 → 402/429/5xxでRunwareフォールバック | 既存実装・クレジット消化 |
| LoRA学習 | Novita GPUレンタル（RTX4090 $0.33/hr） | おまかせ学習はwaiNSFW土台不可＋キュー死亡（46h QUEUING実測） |

### 1.8 Runware LoRA推論（sakura 局長10点満点の実証レシピ・2026-07-17）

```
POST https://api.runware.ai/v1
[{"taskType":"authentication","apiKey":RUNWARE_API_KEY},
 {"taskType":"imageInference","taskUUID":"<uuidv4>",
  "positivePrompt":"<trigger+身元短タグ+シーン層>","negativePrompt":"<下記>",
  "model":"aiadultapp:waiillustrious@9",
  "lora":[{"model":"aiadultapp:sakurakoharu@1","weight":0.85}],
  "width":832,"height":1216,"steps":30,"CFGScale":5,"numberResults":1,"seed":<n>,"outputType":"URL"}]
```

- **同期レスポンス**（task_id無し・imageURLが直で返る）。タイムアウトは90s取る
- taskUUIDは**UUIDv4必須**（形式違いは400 invalidTaskUUID）
- プロンプトは「trigger `sakurakoharu`＋短い身元タグ＋シーン層」— identity-prompt-builderの重み付きブロックと**二重にしない**（盛る失敗モード再発防止）
- バスト誇張はnegativeの `huge breasts, gigantic breasts` で殺す
- 完全レシピ（プロンプト全文・seed・negative）: `.work/seeds/images/20260717-sakura-lora-ero-10ten.md`
- LoRAアップロード: `taskType:"modelUpload"`・category="lora"・beta無料（$0.05/GB/月）。ToSはアップロードモデルの秘密保持を明記（NDAオプションあり・2026-07-17一次ソース確認）

---

## 1. Novita（本命・アダルト実績あり）

### 1.1 基本

| 項目 | 値 |
|---|---|
| Base URL | `https://api.novita.ai` |
| 認証 | `Authorization: Bearer <NOVITA_API_KEY>` |
| **User-Agent 必須** | ブラウザ UA を送る。no-UA は Cloudflare `error code: 1010` bot-block で 403。実装済み UA は `src/lib/image-gen/novita-provider.ts:16-17` |

`error code: 1010/1015/1020/1009` は **認証エラーではなく CF WAF ブロック**。キー再発行ではなく UA 付与・別 HTTP クライアント・実ブラウザ経由で直す（`prompt/instructions/prohibitions.md`「Cloudflare エッジコードを認証失敗と誤診断禁止」）。

### 1.2 生成（非同期・3 エンドポイント）

```
POST /v3/async/txt2img          # 参照画像なし
POST /v3/async/img2img          # image_base64 + strength あり
GET  /v3/async/task-result?task_id=<id>   # 結果ポーリング
```

- init は `{ task_id }` を返す。`task-result` を `TASK_STATUS_SUCCEED` までポーリング。
- 実 seed は task-result の **`j.extra.seed`**（画像配列の `seed` / `image_seed` にも出る。schema: `provider.ts:39-62`）。
- 既存実装のエンドポイント切替は「`image_base64` の有無」で分岐（`novita-provider.ts:87-88`）。

### 1.3 request フィールド（`request` オブジェクト内）

| フィールド | 制約・意味 |
|---|---|
| `model_name` | チェックポイント（= 上記固定モデル） |
| `prompt` / `negative_prompt` | **各 max 1024 runes**（超過で 400 VALIDATOR → 502 に化ける。`novita-provider.ts:49` の `clampToRunes` で切り詰め済み） |
| `width` / `height` | ピクセル |
| `image_num` | 1–16 |
| `steps` | サンプリングステップ |
| `guidance_scale` | CFG。青被り・タッチ崩れ対策で **CFG5 前後**を基準（プラン役割分離） |
| `sampler_name` | 既定 `DPM++ 2M Karras`（`novita-provider.ts:67`） |
| `seed` | `-1` = ランダム |
| `sd_vae` | VAE 指定 |
| `clip_skip` | CLIP skip |
| **`loras`** | `[{ model_name, strength }]` **最大 5**（2026-07-16 doc直読で訂正・旧記載3は誤り）。ただし**自作Illustrious LoRAは通らん**（whitelist＋base_model 2枚ゲート → §0.1: LoRA推論はRunware） |
| `embeddings` | `[{ model_name }]` |
| **`controlnet`** | `{ units: [{ model_name, image_base64, strength, preprocessor, guidance_start, guidance_end }] }`。ポーズ固定（Track1 構図制御） |
| **`ip_adapters`** | `[{ model_name, image_base64, strength }]`。※アニメ身元固定には**不適**（下記 §3） |

body 全体は `{ extra: { response_image_type: "jpeg" }, request: {...} }` の形（`novita-provider.ts:73-83`）。

### 1.4 モデル列挙

```
GET /v3/model?filter.types=<checkpoint|lora|controlnet|vae|textualinversion>
  &pagination.limit=100&pagination.cursor=<cursor>
  &filter.query=<検索語>&filter.source=<civitai|training>
```

- 自分で学習したモデルは `filter.source=training` に出る → `loras[]` で即使える。

### 1.5 SDXL ControlNet 実在モデル名

`controlnet-openpose-sdxl-1.0` / `controlnet-depth-sdxl-1.0` / `controlnet-canny-sdxl-1.0` / `controlnet-softedge-sdxl-1.0` / `ip-adapter_xl.pth`

### 1.6 LoRA 学習（⚠️要検証あり）

| エンドポイント | 状態 |
|---|---|
| `GET /v3/training` | 200（学習ジョブ一覧・実測） |
| `POST /v3/training/subject` | キャラ学習（人物の身元） |
| `POST /v3/training/style` | 画風学習 |

- 学習済みは `GET /v3/model?filter.source=training` に出て `loras[]` で即使える。
- **⚠️要検証（プレモーテム #1・課金前に必ず canary）**: Novita 学習が **Illustrious ベース**（waiNSFW の土台）に対応するか。非対応なら焼いた LoRA が waiNSFW と不整合で品質劣化。ダメなら **CivitAI 学習（Illustrious 対応確認済）→ Runware で推論**にフォールバック。
- **⚠️要検証**: create-task の body 形式・学習料金の実額。着手前に本番コンソールで取得し局長へ提示・承認。

### 1.7 編集系

`/v3/async/upscale` / `/v3/async/inpainting`（顔・手の手直し） / `remove-bg` / `replace-bg`

---

## 2. Runware（保険・自前モデル持込が強い）

- taskType: `imageInference` / `controlNet` / `ipAdapters` / `photoMaker` / `upscale` / **`training`** / **`modelUpload`** / `modelSearch`
- **Model Upload**: 自前 checkpoint / LoRA / LyCORIS / VAE / embedding を **URL 取込** → 生成参照可。**beta 無料**（以後 $0.05/GB/月）。public/private・版管理あり。
- `photoMaker`（v2）は**実写顔用でアニメ不可**。
- 権利: 規約で「生成物はユーザー所有・Runware 所有権なし」。「ユーザー画像で AI 学習」条項は未発見。

---

## 3. 身元固定ツールの選択（設計の核・海外/先人手法で裏取り済み）

| ツール | アニメ身元固定 | 用途 |
|---|---|---|
| **LoRA（キャラごと 1 個）** | ✅ 本命 | 日本の同人 AI-CG 集の標準。Civitai 定番レシピ |
| Vibe Transfer / 素 IP-Adapter | △ 補助 | 少枚数 bootstrap（ベスト 1 枚を 20–30 枚に増やす） |
| **FaceID / InstantID / PhotoMaker** | ❌ 不可 | **実写顔用**。アニメに誤用すると破綻（Runware 過去失敗の正体） |

**Civitai 定番 LoRA レシピ**: ~20–50 枚 / WD1.4 タグ付け閾値 0.35–0.5 / trigger word / **identity タグ（髪色・目色・体型・顔・バスト）を pruning して trigger に吸収** / シーンタグは残す（= 可変層）。→ 局長の「不変ベース＋可変シーン層」原則そのもの。

---

## 4. コスト（ロック・再調査不要）

| provider | 単価 | 備考 |
|---|---|---|
| Novita | ≈ **$0.0025 / メガピクセル / 枚** | 実装済みの `estimateCostUSD`（`novita-provider.ts:141-144`）と一致 |
| Runware | ≈ $0.0008 / 枚 | 計算時間課金・やや安 |

- どちらも 1 枚コンマ数円〜1 円未満 = 実質同じ・**選定理由にならん**。
- アルバム 1 体分（生成 50–100 回）= 数十円〜$1。
- **LoRA 学習 1 回 = 相場 $1–5（⚠️要実額確認・着手前提示）**。

### 4.1 流し込みパターン可否（実測）

| # | パターン | 可否 |
|---|---|---|
| ① | Novita 完結 | ✅ 確定（本命・手渡し無し） |
| ② | Runware 完結 | ✅ 可（NSFW 生成に過去失敗歴あり） |
| ③ | 外部学習 → Runware | ✅ 可 |
| ④ | Runware → Novita | ⚠️ Novita 外部取込口未発見（不要） |

---

## 5. 生成パイプライン（毎回この 3 段）

```
① 構図生成:  txt2img（LoRA + ControlNet + シーンタグ）
              ※ 構図は常に txt2img 産。img2img は 0.3–0.4 低強度リファイン専用
                （strength ≤0.5 で構図変更不可 / ≥0.65 でタッチ崩壊 — 2026-07-13 実証）
② 仕上げ:    img2img strength 0.35 / CFG5
③ 顔手 inpaint: 破綻部だけ inpainting で修正
```

役割分離: **身元 = LoRA**（無ければ強タグ） / **構図 = ControlNet + シーンタグ** / **色 = CFG5・暗色照明タグ弱め・必要なら生成後 WB 補正** / **解剖 = inpaint**。

### 5.1 メタプロンプト設計（不変ベース＋可変シーン層・局長制定 2026-07-13）

- 生成プロンプト = `不変ブロック（image_meta 由来・verbatim）` ＋ `シーン差分タグ`。
- **不変（identity core・上書き禁止）**: 髪 / 目 / 花飾り / 肌 / **バスト（`natural proportions, medium bust` が正。`large breasts` 等で上書き禁止 = AV 女優化の原因）** / 年齢 / 画風・塗り・光影のタッチ。
- **可変（シーン層でのみ変える）**: 表情 / ポーズ・構図・カメラ / 衣装状態 / シチュ・背景 / 性的行為。
- バスト誇張抑制の negative: `huge/gigantic/ball-shaped/shiny/glossy/wet breasts, harsh breast shadows, hard rim light`。

---

## 6. 2 トラック戦略

```
Track1【即出荷・課金ゲート無し】no-LoRA で質を出す
  txt2img/img2img + ControlNet(ポーズ) + 青被り/解剖修正 + inpaint(顔手)

Track2【durability・課金ゲートあり】LoRA で身元を機械固定
  Step0: Novita 学習が Illustrious 互換 LoRA を吐けるか安価に canary 検証（課金前・必須）
  Step1: ダウナー 14 枚で LoRA 学習／Sakura は画像が貯まってから
```

### 6.1 キャラ別ステージ（D1 実測 2026-07-13）

| キャラ | 本番サブ画像 | LoRA 学習データ | 戦略 |
|---|---|---|---|
| ダウナー | 14 枚あり | 即学習可 | Track1 でエロ 4 枚先行出荷 ＋ Track2 で LoRA 学習 |
| Sakura（古橋こはる） | 0 枚（プロフのみ） | 不足＝焼けない | まず Track1 でアルバム生成→合格を貯めてから LoRA |

---

## 7. 審査接続（工程 v2 を再利用・再発明しない）

- 採点は **0–10 点・6 以上合格**（馬場馬術式。100 点満点 90 合格は会話テキスト用で流用禁止）。
- 重み付け加重和（`identity_body 0.25 / touch 0.20 / anatomy_physics 0.15 / expected_situation 0.15 / sexual_expression 0.15 / personality 0.10`）。VETO: anatomy か identity に致命破綻で総合 ≤2。
- PASS 即 3 点セット（R2 put + D1 `character_sub_image` INSERT + seed 保存）＋ pHash 台帳登録 ＋ `image_review` / `image_review_criterion` INSERT。
- **△マーク付き（合格点でも）は `character_sub_image` に入れない**。審査データのみ保存。
- 詳細は `prompt/instructions/char-approval-process.md`（正本）。

---

## 8. route.ts 拡張の残タスク（完成 C へ）

`ImageGenRequest`（`src/lib/image-gen/provider.ts:8-23`）は現状 txt2img/img2img の基本のみ。`loras` / `controlnet` / `ip_adapters` フィールド未対応。`buildInitBody`（`novita-provider.ts:60-84`）に追加すれば LoRA/ControlNet 生成がランタイム内で回る。
