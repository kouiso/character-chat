# モデル選定 & LoRA学習 戦略メモ（2026-07-14 調査）

局長指示で記録。ダウナーの髪トレードマーク固定＝LoRA が唯一解、と確定した後の「どのモデルで・どこで焼くか」の全調査結果。将来セッションはまずここを読む。

## 0. 結論（TL;DR）

- **髪の身元固定は LoRA が唯一解**（txt2img/img2img では髪スプリットが seed 依存でブレる。img2img 実証済み: `.work/e2e-results/downer-img2img-canonical/FINDING.md`）。LoRA はリアル専用技術やない、**アニメこそ主戦場**。
- **良いタッチ（waiNSFW/Illustrious系）を保つ道は全部 GPU 路線**。管理型の一発API学習で Illustrious を焼けるサービスは存在しない。
- **採択（局長 2026-07-14）= Path A（animagine 管理学習・ノーGPU）**。ラクさ・完全自動を優先し、タッチ/エロの妥協を許容。Path B（GPU学習でタッチ最高）は品質アップグレードとしていつでも移行可能な形で保持。

## 1. 核心の制約：Novita 管理学習の base_model は固定17個・Illustrious 不在

Novita `POST /v3/training/subject` の `base_model` は固定enum（`doc/novita-runware-api-guide.md` §1.6）。**Illustrious 系は1個も入っていない**。アニメに使えるのは実質:
- `animagineXLV31_v31_325600`（唯一の本命級アニメSDXL。ただしエヴァ風フラットでエロ乗りは waiNSFW に一歩劣る）
- `yesmixXL_v10_283329`（2.5Dセミリアル・肌リアル寄り＝アニメと方向違い。animagine と同程度）
- `abyssorangemix3AOM3_*`（SD1.5・低解像・世代遅れ＝ボツ）

→ 管理型ノーGPUで焼けるアニメは実質 animagine のみ。`class_prompt` は `expert_setting` 内・enum は `person` のみ（実測でハマった点）。

## 2. Novita 生成カタログの Illustrious 系 NSFW 候補（GPU路線 or 生成用）

| Novita sd_name | 系統 | 判定 |
|---|---|---|
| `waiNSFWIllustrious_v90_1187991.safetensors`（今） | WAI Illustrious | **実は古い（versionId的に≒WAI v8相当）**。本家 WAI は現在 v17。Novita に新しい WAI-NSFW は無い |
| `waiIllustriousSDXL_v150.safetensors` | WAI Illustrious v15 | **NSFW 出る（"SFW"フラグは誤り・実測確認）**。今のタッチのまま新しめ＝有力な同タッチ格上げ |
| `hassakuXLIllustrious_v13StyleA_1147687.safetensors` | Illustrious | 良好・近いタッチ。局長「めっちゃ良かった」 |
| `noobaiXLNAIXL_vPred06Version_975743.safetensors` | NoobAI v-pred | **Novita標準APIでノイズ崩壊**（v-pred特殊設定要）。ボツ |
| `Animagine XL 4.0.safetensors` / `animagineXL40_v4Opt_*` | Animagine v4 | 生成用にはある（学習enumは3.1のみ） |

局長評（エロA/B・2026-07-14）: 今の waiNSFW が肌の艶・描き込みで一段上。waiIllustrious v15 / Hassaku も「めっちゃ良かった」。animagine/yesmix は許容圏だがエロ乗りは落ちる。AOM3 ボツ。A/B現物: `.work/e2e-results/touch-ab/`

## 3. 学習プラットフォーム比較（自律API・カスタム土台・NSFW可の観点）

| 手段 | 学習API | カスタム/Illustrious土台 | NSFW | コスト | 判定 |
|---|---|---|---|---|---|
| **Novita 管理学習** | ✅一発API | ❌enum固定・Illustrious不可 | ✅ | 無料枠1回/~$1-3 | **Path A採用**（animagine限定） |
| **GPU + kohya**（Novita GPU or RunPod） | ✅API制御 | ✅**任意の土台（waiNSFW直乗せ可）** | ✅私有GPU | GPU ~$0.25-0.35/時 → **1回~数十円** | **Path B（品質最高・保持）** |
| CivitAI on-site trainer | △主に手動UI | ✅Illustrious可 | △成人はcivitai.com・クリプトBuzz | ~500Buzz(≒$0.5)/毎日無料Buzz | **却下**（手動・規約激変・自律不可） |
| Runware | ❌**学習機能なし**（upload+推論のみ） | — | — | 推論$0.0008/枚 | 学習では出番なし。推論/持込の保険 |
| Replicate | ✅API | ❌SDXL-base/Flux固定 | ❌ToS禁止 | 数$/run | 却下 |
| fal.ai | ✅API | ❌Flux専用 | ❌制限的 | $2/run | 却下 |

Novita GPU は Kohya_SS テンプレあり＋GPU instance REST API＋MCP。RunPod は runpod-python SDK + /runsync。どちらも「土台に waiNSFW を置いて kohya」で完全自律・数十円。

## 4. コスト & コンテンツポリシー要点

- Novita 生成 ≈ $0.0025/メガピクセル/枚。学習 無料枠 `free_trial.training`（1回）→消費済み。以降 管理学習~$1-3、GPU学習~数十円。
- Novita は NSFW 寛容・安い・量出せる（局長評「使いこなせば武器」）。**主戦場は Novita 固定**。
- CivitAI: 2025-05 に決済会社BAN→クリプト移行、civitai.green(PG/カード) と civitai.com(成人/クリプト) に分離、規約厳格化（実在人物/未成年/特定フェチ禁止）。自律運用に不向き。
- LoRA(.safetensors) は可搬。CivitAI/GPUで焼いた物を Novita(`upload_model`可)/Runware に持ち込み推論できる。

## 5. Path B に将来行くなら（保持オプション）

局長が「3つ(waiNSFW/v15/Hassaku)めっちゃ良かった」＝タッチ最優先に振るなら:
- GPU(Novita or RunPod)+kohya で **waiIllustrious v15**（今のタッチの新しめ）or **最新 waiNSFW v17を自前アップロード**を土台に学習。
- 生成は Novita に同モデルを置いて継続（v15 は既にNovitaにある）。完全自律・1体数十円。

## 参照
- API正本: `doc/novita-runware-api-guide.md` / skill `image-gen-api-novita-runware`
- 工程: `prompt/instructions/char-approval-process.md`（トレードマーク接地/質感ゲート）
- 引き継ぎ: `~/.claude/state/handoff-downer-images.md`
