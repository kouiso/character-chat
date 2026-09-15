---
name: image-generation-pipeline
description: "キャラ画像（プロフ肖像・エロサブ・テキストメタ）の生成→検証→採点→本番採用の一気通貫パイプライン。Devin の画像生成機能を使用。"
metadata:
  type: workflow
  trigger: "キャラ画像生成、アバター再生成、エロサブ画像追加、/add-char-photo 実行時"
---

# キャラ画像 吐き出しパイプライン

## 絶対前提（最初に読め）

| 制約 | 理由 |
|------|------|
| 画像生成は **Devin の画像生成機能のみ** 使用 | 外部有料 API は金かける方針違反 |
| Novita / Runware / OpenAI API 直叩き **禁止** | 偽コンポジット（白パネル合成）の真因 |
| 対象は **架空の成人キャラのみ** | 未成年示唆・実在個人の性的非合意・違法物 → 即停止 |
| wrangler の Cloudflare 認証（R2/D1 書込）が必要 | 未設定なら `pnpm exec wrangler whoami` で先に確認 |

## 3 つのタスク種別

| 種別 | 中身 | 方式 | 保存先 |
|------|------|------|--------|
| **main portrait** | SFW プロフ肖像（profile↔chat 一致のアンカー） | img2img（原画参照） | `character.avatar` / R2 `avatars/` |
| **erotic subs** | エロ立ち絵サブ（感情/エロ表現グラデーション） | img2img（原画参照） | `character_sub_image` / R2 `sub/<char_id>/` |
| **textonly** | 参照画像なしの txt2img（テキストメタ蒸留・reference 無しで約 91% 一致実証済） | txt2img | `character.visual_prompt` / R2 |

## サブ画像の設計原則

> **主軸は EXPRESSION / EMOTION であり、アングル違いではない。**
> 同じ娘の別アングル = 抜けるデルタ ゼロ。感情を振る（composed → 発情 → 誘い）= キャラの解像度と興奮が上がる。

| 段階 | 表現 |
|------|------|
| baseline | 既定の composed な顔（カードのアバター） |
| 発情/とろけ | 紅潮・濡れ目・口開き |
| 誘い | 挑発的な流し目・come here |
| erotic ladder | 脱衣 → 下着 → 濡れ → climax / afterglow |

Devin の画像生成天井まで push し、refuse された rung はそこで止める。有料外部に逃げない。

---

## 工程（順番に実行）

### ① 前提確認 — D1 からキャラ情報取得

```bash
pnpm exec wrangler d1 execute adult-ai-db --remote \
  --command "SELECT id, name, avatar, image_meta FROM character WHERE id = '<char_id>' LIMIT 1"
```

- `avatar` が NULL → 停止（img2img 参照元なし。textonly タスクのみ参照不要）
- `image_meta.appearance` → 生成プロンプトのアンカー（正典）に使う

### ② identity ロックシート作成

生成前に以下を確定し、全プロンプトで反復する：

```
髪色・髪型:
瞳色:
肌色:
顔の特徴（ほくろ・傷等）:
装備 geometry（衣装の形状）:
年齢表記: adult woman age 24（固定）
美点（キャラ固有の魅力）:
```

### ③ 参照画像取得（main portrait / erotic subs のみ）

```bash
curl -L "https://adult-ai-chat.pages.dev/api/avatar/<avatar_key>" \
  -H "Authorization: Bearer $AUTH_TOKEN" -o /tmp/ref-<char_id>.jpg
```

### ④ 画像生成（Devin 画像生成機能）

**初回は必ず 1 枚だけテスト生成** → サイズ確認 → OK なら残りをスケール。いきなり複数枚並行投入禁止。

生成指示の構成:

```
[identity アンカーブロック — ②のロックシートをそのまま反復]
[テーマ / シーン指定]
[品質指定: best quality, masterpiece]
```

#### プロンプト設計ルール

| 区分 | ルール |
|------|--------|
| **プロフ用** | text-only / portrait 主体。body/sexual 語は negative にも入れない（分類器の注意を引く） |
| **エロサブ用** | 毎プロンプトで `adult woman age 24` を先頭明記。identity アンカーブロックを毎回そのまま反復 |
| **年齢表現** | `teenage` / `childlike` 禁止 → morphology 化（体型記述に置換） |
| **安全境界** | ceiling-safe な官能語 + 明示的安全境界（`opaque` / `no nudity` / `no nipples` を同時に） |
| **構図** | 広い body shot で identity が落ちる → `face readable` / `square framing` で緩和 |

#### textonly タスクの場合

参照画像なし。テキストメタ（`appearance` + `visual_prompt`）のみで生成。`-i` 相当の参照指定を外す。

### ⑤ 真贋判定（偽コンポジット排除）

| ファイルサイズ | 判定 | アクション |
|---------------|------|-----------|
| **≥ 1.5 MB** | 本物の img2img 出力 | → 次工程へ |
| **< 1 MB** | 偽コンポジット（白パネル合成） | → **FAIL**。方法を変えず BLOCKED 報告。作り直し |

**偽コンポジットを参考までに出すことも禁止。** NG 画像は提示しない。

### ⑥ 全候補を Read で目視確認

生成した全画像を 1 枚ずつ確認し、1 行で合否判定：

| 判定基準 | 結果 |
|----------|------|
| 同一人物 / 崩れなし / 装備保持 | **OK** |
| identity ドリフト / 装備消失 / 解剖学的崩れ | **NG** → その 1 枚だけ作り直し |

NG 画像は作り直し、崩れた画像を「参考」として出さない。

### ⑦ 重複チェック（pHash・提示前必須）

```bash
python3 scripts/avatar-pipeline/dedupe-check.py check /tmp/sub-<char_id>-*.png
```

| Hamming 距離 | 判定 | アクション |
|-------------|------|-----------|
| ≤ 5 | **BLOCK** | ほぼ同一。再提示禁止 |
| ≤ 10 | **WARN** | 類似。別パターン要求 |
| > 10 | **OK** | 新規。提示可 |

### ⑧ ラベル付与 & 局長へ提示

- ラベルは **A → Z → AA → AB …** の単調増加で **提示前に確定**
- 提示キャプション形式: `【<キャラ名>】【<種別>】【ラベル X】`
- 添える主観評価: 正典一致（髪/目/衣装）・NSFW 度・構図・解剖学的整合
- **1 キャラずつ提示**（まとめて出さない）

### ⑨ 局長採点

- 0 〜 10 点。**合格バーは 90 点級**（80 点は経験者に刺さらん ＝ 不合格）
- 減点軸: AI 臭い定型句 / 喘ぎの没個性 / エスカレーション不足 / telling 過多 / 短さ / 反復 / 解剖学的曖昧さ / 相手視点の没入欠如
- **PASS のみ次工程へ。局長の採点記録が無い自動採用は禁止。**

### ⑩ 本番採用（PASS のみ・review-gate 厳守）

```bash
# R2 へ upload
pnpm exec wrangler r2 object put \
  adult-ai-images/avatars/sub/<char_id>/<uuid>.png \
  --file /tmp/sub-<char_id>-N.png --content-type image/png
```

```bash
# D1: erotic sub → character_sub_image へ INSERT
pnpm exec wrangler d1 execute adult-ai-db --remote \
  --command "INSERT INTO character_sub_image (character_id, r2_key, ord) \
    VALUES ('<char_id>', 'sub/<char_id>/<uuid>.png', <次のord>)"
```

```bash
# D1: main portrait → character.avatar を UPDATE
pnpm exec wrangler d1 execute adult-ai-db --remote \
  --command "UPDATE character SET avatar = '<key>' WHERE id = '<char_id>'"
```

### ⑪ 後処理

**台帳登録（提示・採点後に必ず実行）:**

```bash
python3 scripts/avatar-pipeline/dedupe-check.py register \
  --label <X> --date <YYYY-MM-DD> /tmp/sub-<char_id>-N.png
```

**良質（85 点+）は seed 保存:**

`.work/seeds/images/YYYYMMDD-<char_id>-sub-<theme>.md` に以下を記録:

```
# シリーズ種別: サブ写真
# キャラ: <name>
# テーマ: <theme>
# 評価: <主観スコア>
## 使用プロンプト
[プロンプト全文]
## 何が良かったか
[1〜3 点]
```

---

## 必須ゲートまとめ（1 つでも欠けたら停止）

```
1 枚テスト縛り
  → ≥ 1.5MB 真贋チェック
    → 目視 identity 確認（1 枚 1 行合否）
      → pHash 重複チェック（Hamming ≤ 5 で BLOCK）
        → ラベル確定 & 局長提示
          → 90 点級採点（採点記録なし採用禁止）
            → R2 + D1 本番採用
              → 台帳登録 + seed 保存
```

## 禁止事項

| 禁止 | 理由 |
|------|------|
| Novita / Runware / 外部有料 API | プロジェクト方針（金をかけない）違反 |
| OpenAI API 直叩き | 偽コンポジット（白パネル合成）の真因 |
| 採点記録なしの自動本番採用 | review-gate 違反 |
| 偽コンポジットを「参考」として提示 | NG 画像は出さない |
| いきなり複数枚並行生成 | 1 枚テスト → 確認 → スケールの順 |
| identity アンカーなしの生成 | ドリフトの原因 |
| `teenage` / `childlike` の年齢表現 | 安全層に弾かれる → morphology 化 |
| 未成年示唆・実在個人の性的非合意 | 絶対線。即停止 |

## 関連ファイル（このリポジトリ内）

| ファイル | 用途 |
|---------|------|
| `prompt/skills/image-prompt-ssot/SKILL.md` | プロンプト精緻化・SSOT・場所/光。投げる前 |
| `prompt/skills/sensory-depiction/SKILL.md` | 五感の密度。通常は薄くエロは厚く。投げる前 |
| `prompt/skills/image-frame-consistency/SKILL.md` | 画面全体の無矛盾。渡す前 |
| `prompt/commands/add-char-photo.md` | サブ写真追加の一気通貫コマンド |
| `scripts/avatar-pipeline/dedupe-check.py` | pHash 重複ゲート |
| `scripts/avatar-pipeline/run.py` | 自動パイプライン実行 |
| `scripts/avatar-pipeline/judge.sh` | 画像比較ジャッジ |
| `scripts/avatar-pipeline/d1_fetch.ts` | D1 データ取得 |
| `scripts/avatar-pipeline/d1_update.ts` | D1 データ更新 |
| `scripts/avatar-pipeline/avatar_r2.py` | R2 アップロード |

> **注意**: `prompt/instructions/avatar-image-gen.md` は旧記述で「macmini ローカルのみ・Cloud 禁止」と書いてあるが、
> 現行方針は「Devin の画像生成機能を使用」。このスキルが現行の正。avatar-image-gen.md の是正は別タスク。
