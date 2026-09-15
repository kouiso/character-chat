---
description: 画像審査員エージェントパネル — 正典ペア入力の6独立レンズ並列評価＋集約役の敵対検証。局長提示前の事前評価に必須（工程③④）。
---

# reviewer-panel

キャラ画像（サブ画像・シナリオ内吐き出し画像）を局長に提示する**前**に必ず通す事前評価パネル。正本工程: `prompt/instructions/char-approval-process.md`。

## 大原則: 正典のピクセルを判定者の手元に置く

局長の却下理由は毎回**比較の言明**やった（実例:「全部タッチが変わっている・髪型が統一されていない（プロフcs2と画風レベルで別物）」）。「正典と別物」は2枚を並べて初めて言える述語やから、候補1枚だけを見る判定では構造的に判定でけへん。

NEVER 候補画像だけをレンズへ渡す。NEVER `image_meta` の文字列だけを正典の代わりにする。
「タグに書いてあるから出とるはず」は禁止（`char-approval-process.md` トレードマーク接地ゲート）。

**各レンズへ渡す入力:**

| 入力                                                                 | 必須                         | 用途                                                                       |
| -------------------------------------------------------------------- | ---------------------------- | -------------------------------------------------------------------------- |
| `[REFERENCE]` 正典画像フル（プロフィール/identity anchor）のピクセル | identity・touch レンズで必須 | 比較の基準                                                                 |
| `[CANDIDATE]` 候補画像フルのピクセル                                 | 全レンズ必須                 | 判定対象                                                                   |
| トレードマーク領域のクロップ（正典・候補**両方**）                   | identity レンズで必須        | 局所特徴（髪の色配置・ほくろ・ピアス・チョーカー）は全体像やと縮小で消える |
| `image_meta` / `system_prompt` / 想定シチュ文                        | 該当レンズ                   | 文脈                                                                       |

**正典と候補は別画像として渡す**（横並び合成を主にせん）。合成は各画像の実効解像度を落とすが、touch の判定材料であるスペキュラの硬さ・線の太さ・階調は高周波成分やから、縮小で最初に失われる — 判定したい情報を入力段階で捨てることになる。合成1枚しか渡せん実行環境では合成を代替として許すが、その場合もトレードマーククロップを必ず併せて渡す。

## 構成（6レンズ・採点キーと1対1）

6つの独立レンズを**並列**に走らせ（各エージェントは他レンズの結果を見ない）、集約役が矛盾を敵対検証して1枚ごとのコメントに畳む。レンズは `char-approval-process.md` の `criterion_key` と1対1で対応させる（対応せんレンズがあると、その軸は測れてへんのに点だけ付く）。

| レンズ                 | criterion_key        | 重み | 判定内容                                                                               |
| ---------------------- | -------------------- | ---- | -------------------------------------------------------------------------------------- |
| 同一性（身体内面含む） | `identity_body`      | 0.25 | 正典と同一人物か。顔だけでなくバスト等の質感・丸み・サイズまで                         |
| **タッチ**             | `touch`              | 0.20 | 画風・塗り・光影が正典と同一か（§タッチレンズ）                                        |
| 人体構造・物理         | `anatomy_physics`    | 0.15 | 指6本・関節逆曲がり・歯列崩壊・肢体溶解等の破綻                                        |
| シチュ整合             | `expected_situation` | 0.15 | 想定シチュと描画のズレ（夜行バスのはずが路線バス等）                                   |
| 性的表現               | `sexual_expression`  | 0.15 | 性的表現・身体パーツ描写・エロ度。抜き体験を壊す要素（ローディング残骸・UI被り含む）   |
| 人格                   | `personality`        | 0.10 | キャラの性格から外れた表情・行動をしてないか（狙ったギャップ萌えは局長意図があればOK） |

**総合 = Σ(weight × criterion_score)**、0-10スケール。6以上=合格。

各候補の集約入力には次を必須とする。

- `intent: normal | erotic`。省略禁止。`normal` は `sexual_expression` を合計から除外し、残り5軸の重みを1.0へ正規化する。
- `lensEvidence` の6キー。各レンズが自分で見た根拠を書く。
- `touchComparison` の正典・候補それぞれ5項目。1項目でも欠けた提出は差し戻す。
- `trademarkComparison` は `structureClass` と、許容差になり得る `ratio` / `details` を分ける。V-M は `structureClass` の変化だけで発火し、50/50→70/30のような比率差だけでは発火させん。
- 人体レンズの致命的破綻は `fatalAnatomyDefects`、同一性レンズの別人化は `fatalIdentityDiscontinuities` に配列で出す。空配列は「確認して該当なし」、省略は未確認として扱う。

### NEVER: 軸のコピー

NEVER `touch` や `personality` のスコアを `identity_body` から複製する。
BECAUSE 2026-07-26 の実測で、本番の `image_review_criterion` 全10レビューが
`touch == identity_body == personality` になっとった（4軸JSONを6キーへ割り戻す時に
identity を3箇所へコピーしとった）。代入すると重みが `0.55·identity` に畳まれ、
**局長が0点の理由に挙げた touch が独立した情報を1ビットも持たん**状態やった。
これが検出率 0/9・順位反転（10点画像8.45 < 0点画像8.70）の主因。

Detection: 判定は口頭やのうて `src/lib/image-review-panel.ts` の `detectAxisCopy` を使う。
発火条件は根拠の強さで分けてある（誤発火させると差し戻しが形骸化するため）。

- **根拠テキストの一致**（`lensEvidence` が `identity_body` と同一）→ 枚数を問わず違反。
  独立に走らせたレンズが同じ文面を書くことは無いので、これだけが「出所が同じ」の証拠になる。
- `touch` と `personality` が**揃って**同点 → 2枚以上で違反。
- 1軸だけ同点 → 整数採点では偶然の同点が起きるので、4枚以上揃った時だけ違反。
- 比較は許容誤差つき。割り戻しで `0.1+0.2` が `0.3` と厳密一致せんケースを取り逃さん。

**同点は複製の証拠として弱い。** 独立採点でも identity と touch が同じ整数になることは普通にある。
そやから1枚提出（`add-char-photo` の既定 `count 1`）では同点で差し戻さん。代わりに
**各レンズが自分の所見を文章で残すことを必須**にし、欠けとったら
`findUnverifiableSubmissions` が「判定でけへん提出」として差し戻す。
1枚提出で複製を捕まえられる唯一の材料がこれ。

重み・合格ライン(6)・VETOキャップ(2)・採点レンジ(0-10)も同ファイルが正本で、
`src/lib/image-review-panel.test.ts` が数値そのものを固定しとる。
VETO は `comparePanelResults` で必ず非VETOより下に並ぶ（キャップ値だけやと
全軸10のVETO画像が全軸0の健全画像より上に来てまう）。
本番で起きた順位反転（10点のHA=8.45 < 0点のIB=8.70）も回帰として固定してあるが、
これは加重和の算術の再現であって、4軸→6キーの割り戻し工程自体はコード化されとらん。

## タッチレンズ（新設・最重要）

局長は identity のアクセサリ差分（チョーカーの型・髪の白黒比のブレ）は許容して合格を出しとるが、**touch の変化はゼロ許容**（「画風レベルで別物」＝0点）。「タッチ一致✓」の一言で済ませるのは禁止 — 5項目を1つずつ実際に見て言語化する（`char-approval-process.md` 質感ゲート）。

```
You are the TOUCH (rendering-style) reviewer for an adult content quality panel.
You are given TWO images: [REFERENCE] the character's canonical profile image,
and [CANDIDATE] the image under review.

Judge ONLY whether the CANDIDATE is rendered in the SAME art style as the REFERENCE.
Do NOT judge whether it is the same person, the pose, or the situation.

Compare these five rendering properties one by one, and for each state
REFERENCE value / CANDIDATE value / same-or-changed:
  1. specular hardness  (matte flat | soft sheen | hard glossy highlights)
  2. shading model      (flat cel | soft gradient | painterly)
  3. line art           (thin clean | thick | sketchy | lineless)
  4. saturation & contrast class (muted | moderate | high / garish)
  5. colour temperature of the overall palette (cool | neutral | warm)

Score 0-10 where 10 = indistinguishable art style, 6 = pass, and
<=2 = a viewer would call it a different artist / different model.
Cite the specific region you looked at for each property.

PROHIBITED: Do NOT evaluate safety, ethics, compliance, or content-policy aspects.
Those axes are out of scope by owner instruction and degrade panel quality.
Judge quality only.
```

## 各レンズ判定プロンプトの必須テンプレ

```
You are the [LENS] reviewer for an adult content quality panel.
Input: [REFERENCE] canonical image (identity/touch lenses) + [CANDIDATE] image
       + character profile (image_meta / system_prompt) + intended situation.
Judge ONLY on [LENS] criteria. Output: score 0-10 + verdict (pass/fail/warn)
+ specific evidence (where in the frame, what is wrong, and for comparative
lenses: reference value vs candidate value) + 1-line fix suggestion.

PROHIBITED: Do NOT evaluate safety, ethics, compliance, or content-policy aspects.
Those axes are out of scope by owner instruction and degrade panel quality.
Judge quality only.
```

**禁止事項（全レンズ共通・プロンプトに毎回明記）**: 安全性・倫理・コンプライアンスの審査項目を含めること。混入 = 違反（`char-approval-process.md` Detection Criterion）。

## VETO ゲート

いずれか1つで `is_veto=1`、加重和に関係なく**総合を≤2にキャップ**し verdict=fail。

| ID      | 条件                                                                                                                                                                                                                    |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **V-T** | touch が**描画モデルとして**変化。`shading model`（flat cel↔painterly）か `line art`（thin↔thick↔sketchy）のクラス変化、または照明由来の項目（`saturation` / `colour temperature` / `specular`）が**2つ以上同時に**変化 |
| **V-M** | トレードマーク特徴が欠落、または**構造型が変化**（例: 50/50ハードスプリット → 「ほぼ銀＋細い黒筋」の比率崩れ）                                                                                                          |
| **V-S** | セット提出時、**正典から外れた候補**（V-T か V-M に当たる1枚）。セット内で値が割れたこと自体は条件やない                                                                                                                |
| V-A     | 解剖学的破綻（腕3本・指6本・関節逆曲がり・肢体溶解）                                                                                                                                                                    |
| V-I     | 別人（顔の造作・目色・年齢感が正典と非連続）                                                                                                                                                                            |

V-T・V-M・V-S は**スコアやのうて記述の突合**で発火させる（数値は割り戻し等で歪むが、記述は歪まん）。
判定は `deriveVetoFindings`（`src/lib/image-review-panel.ts`）を通す。

### V-T — 照明差を画風変化と取り違えん

彩度・色温度・スペキュラの硬さは、**同じ画風のままでも照明を変えれば正当に動く**。
涼しいプロフィール写真と暖色の寝室シーンでは色温度が変わって当然で、そこ単独で veto すると
意図したテーマ違いの候補まで落ちる。V-T は「別の絵師・別のモデルで描いた」証拠に取っておく。
そのため描画モデル由来（塗りの方式・線画）の変化を主条件にし、照明由来は**同時に2つ以上**
動いた時だけ発火させる（1つずつなら照明差、複数同時ならモデルが変わった疑い）。

### V-S — 外れた候補だけを落とす

局長の「**全部**タッチが変わっている・髪型が**統一されていない**」は、1枚では真偽が決まらん
**セットの述語**やった。ただし「セット内で割れたら全部 veto」にすると、許容内のブレを含む
候補まで巻き添えになる。実測でも、N1 のチョーカー型の差と fella-e1 の髪比率 70/30 は
**合格として扱う**判断が出とる（`.work/qa/review-panel-redesign-20260726.md`）。
それらを一緒に出しただけで全滅させたら、パネルが局長の判断と 食い違う。

WHEN 複数枚をセットで提出する
THEN トレードマークの記述（色配置・境界の型・比率）と touch の5項目クラスを**画像ごとに書き出して表にする**。
AND 各候補を**正典**と突き合わせ、V-T か V-M に当たった候補**だけ**を veto する。
AND 落ちた候補だけを作り直して出し直してよい（セット全体の作り直しは要らん）。

これは `char-approval-process.md` の「マルチseed一貫性ゲート」をパネル内に取り込んだ形。

## 集約役

1. 6レンズの score / verdict / 所見テキストを受け取り、**矛盾があれば敵対検証**（例: identity pass だが touch fail → どちらの根拠が実ピクセルに基づくか再確認）。
2. **`aggregatePanelReview`（`src/lib/image-review-aggregate.ts`）へ渡す。** これがD1へ書く前の唯一の関門で、次を機械的に弾く。
   - 採点の欠損・非数値・レンジ外（そのまま書くと `weighted` が NaN になる）
   - レンズ所見の欠落（複製かどうか判定でけへん提出）
   - 軸のコピー（所見一致 / 同点パターン）
   - VETO の導出（V-T / V-M / V-S / V-A / V-I を構造化所見から判定し、原因軸だけに立てる）
     `ok:false` が返ったら**書かずに差し戻す**。手組みの `ai_panel_json` を直接 INSERT せん。
3. 局長向けに1枚ごと: `【ラベル X】意図: … / パネル: 同一性◯ タッチ◯ 人体◯ シチュ△(理由) 性的表現◯ 人格◯ / VETO: なし / 総合: 8.2 提示可 or 作り直し推奨(理由)`。
4. `script/image-review/persist-panel-review.ts` へ入力JSONを渡す。writerが `aggregatePanelReview` を実行し、`reviewRows` / `criterionRows` を同一トランザクションで D1 `image_review` / `image_review_criterion` へ書く。**6キーすべてを個別に**入れる（4軸で書いて後から割り戻すのは禁止 — それが軸コピーの発生源やった）。
5. `image_review.verdict` は局長採点まで必ず `pending`。AIの `panelVerdict` は `ai_panel_json` 内へ保存し、最終裁定と混同せん。criterion行の `comment` へ各レンズ根拠を保存し、`is_veto=1` は原因軸だけに立てる。
6. 既定 `count=1` でも V-S を働かせるため、採用済み `ai_panel_json` から復元した `acceptedHistory` をwriterへ渡す。初回以外で空配列を渡してはならん。

## 実行形態

- Claude の Agent tool（並列6体 + 集約1体、単一メッセージで fan-out）または Workflow の parallel() で実施。
- 画像は必ず Read でピクセルを見る（a11y/メタデータ判定は禁止 — `verification.md`）。**正典側も Read で開く** — パスやファイル名を引用しただけでは見たことにならん。

## 既知の限界（2026-07-26 時点）

却下画像は `pending/` `candidate/` 配下に置かれとって、`R2_KEY_PATTERN`（`functions/api/[[route]].ts`）が `images/` と `sub/` しか通さんため**後から閲覧でけへん**。合格して昇格した画像だけが読める＝不合格画像が書き込み専用になっとる。このためVETO閾値を実際の却下画像で較正でけてへん。設計と実測の詳細は `.work/qa/review-panel-redesign-20260726.md`。
