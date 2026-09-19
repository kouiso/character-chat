# 画像審査パネル 再設計（2026-07-26）

対象Issue: #926 / 正本: `prompt/agents/reviewer-panel.md`, `prompt/instructions/char-approval-process.md`

## 結論

孤立採点の仮説は**成立した**。ただしそれは2つある欠陥の片方で、単独では順位反転を説明でけへん。
もう1つが決定的で、**`touch` 軸は実際には存在してへんかった** — `identity_body` の値をコピーしとっただけで、
独立した情報を1ビットも持ってへん。局長が0点を付けた理由がまさに touch やから、パネルは
却下理由そのものを測る器官を持たんまま9枚を通した。

---

## 1. 孤立採点の仮説 — 成立

`prompt/agents/reviewer-panel.md` の判定プロンプト必須テンプレは入力をこう定義しとる。

```
Input: image + character profile (image_meta / system_prompt) + intended situation.
```

候補画像は**ピクセル**で渡るが、正典（プロフィール画像）は **`image_meta` という文字列**でしか渡らん。
判定者の手元に正典のピクセルが無い。

局長の却下理由は全件が比較の言明やった。

| label | 局長コメント（D1 `director_comment` 実物） |
|---|---|
| IA〜ID | 「0点。全部タッチが変わっている・髪型が統一されていない（**プロフcs2と画風レベルで別物**）」 |

「プロフcs2と別物」は2枚を並べて初めて言える述語やのに、パネルは1枚しか見てへん。
構造的に判定不能な軸で判定させとった。

**傍証（実データ）**: identity 軸は IA〜ID に対して 8/9/7/8 を付けとる。正典と突き合わせず
`image_meta` の文字列とだけ照合したから「タグに書いてある特徴は出とる」で高得点になった。
`char-approval-process.md` が禁じとる「タグにあるから出とるはず」の判定そのもの。

なお同ファイルの「トレードマーク接地ゲート」は正典画像を Read で開いた実画像同士の突合を
**要求しとる**。要求は存在したが、パネルの判定プロンプトに配線されてへんかったので、
パネル実行時には効かんかった。規約と実装の断絶。

---

## 2. より重い欠陥 — `touch` と `personality` が `identity_body` のコピー

`image_review_criterion`（本番60行・10レビュー）を見ると、全10レビューで次が成立する。

```
touch == identity_body   かつ   personality == identity_body   （10/10行で完全一致）
```

| label | identity_body | touch | personality | anatomy | situation | sexual |
|---|---|---|---|---|---|---|
| HA | 8 | **8** | **8** | 9 | 9 | 9 |
| IB | 9 | **9** | **9** | 8 | 8 | 9 |
| IC | 7 | **7** | **7** | 6 | 8 | 7 |

`ai_panel_json` が保存しとる生データは4軸しか無い（`{"identity","anatomy","situation","nuki","weighted"}`、64〜65バイト）。
6キーはこの4つから機械的に割り戻されとった。

```
identity_body = identity      anatomy_physics = anatomy
touch         = identity ←コピー   expected_situation = situation
personality   = identity ←コピー   sexual_expression  = nuki
```

仕様の加重和に代入すると重みが畳まれる。

```
0.25·I + 0.20·I(touch) + 0.10·I(personality) + 0.15·A + 0.15·S + 0.15·N
= 0.55·I + 0.15·A + 0.15·S + 0.15·N
```

**記録済みの `weighted` 値10件すべてがこの式で一致する**（検算: HA 8·.55+9·.15+9·.15+9·.15=8.45 ✓／
IB 9·.55+8·.15+8·.15+9·.15=8.70 ✓／IC 7·.55+6·.15+8·.15+7·.15=7.00 ✓／ID 8·.55+9·.15+8·.15+8·.15=8.15 ✓）。

帰結は3つ。

1. **却下理由の軸が測れてへん**。局長が0点の根拠にした touch（重み0.20）は identity に
   反対票を投じることが定義上でけへん。
2. **最も外れやすい軸が実効0.55を占める**。正典無しで判定して当てにならん identity が
   総合点の過半を握った。順位反転（10点のHA=8.45 < 0点のIB=8.70）はこれで説明が付く。
3. **6軸の加重和は名目だけ**。実体は4軸和で、重み配分の議論は空回りしとった。

### 局長の選好関数はパネルの重みと逆向き

到達可能な合格画像を実際に開いて確認した（§5）。局長が8〜9点を付けた画像でも、
チョーカーの型（正典の菱格子 → シェブロン／レース）や髪の白黒比（正典の50/50 → 約70/30）は
**ドリフトしとる**。それでも合格しとる。一方で却下は「タッチが画風レベルで別物」。

つまり局長は **identity のアクセサリ差分は許容し、touch の変化はゼロ許容**。
パネルは identity に0.55、touch に実効0.00を割り当てとった。完全に逆。

---

## 3. 再設計 — 正典を判定者の手元に置く

### 3.1 入力形式の選択

| 案 | 採否 | 理由 |
|---|---|---|
| 横並び合成1枚 | **不採用（代替のみ）** | 合成すると各画像の実効解像度が落ちる。touch の判定材料（スペキュラの硬さ・線の太さ・階調）は高周波成分やから、縮小で最初に失われる。判定したい情報を入力段階で捨てる形になる |
| **正典と候補を別画像として同一判定者へ渡す** | **採用（主）** | 解像度を保ったまま「reference」「candidate」と役割を明示して参照でき、モデルが1つの場面と誤読することも無い |
| 特徴クロップ | **採用（併用）** | 「髪型が統一されていない」は局所的な欠陥。全体像だけやと縮小されて消える。トレードマーク領域は別途クロップで渡す |

**採用: 正典フル + 候補フル + トレードマーク領域クロップ（正典・候補の両方）を同一判定者へ渡す。**

根拠は局長コメントの2つの句がそれぞれ別の粒度を要求しとるから。
「画風レベルで別物」＝画面全体の描画特性 → フル画像の並置が要る。
「髪型が統一されていない」＝局所特徴 → クロップが要る。
片方だけでは片方の却下理由を拾えん。

合成1枚しか渡せん実行環境では合成を代替として許すが、その場合は
トレードマーククロップを必ず併せて渡す（縮小で消える分を補う）。

### 3.2 レンズ構成の改訂

現行4レンズ（同一性／人体構造／シチュ整合／抜き体験）は採点6キーと対応してへん。
`touch` と `sexual_expression` を担当するレンズが存在せんかった。6キーに1対1で対応させる。

| レンズ | criterion_key | 重み | 入力 |
|---|---|---|---|
| 同一性（身体内面含む） | `identity_body` | 0.25 | 正典フル＋候補フル＋クロップ |
| **タッチ（新設・独立）** | `touch` | 0.20 | 正典フル＋候補フル |
| 人体構造・物理 | `anatomy_physics` | 0.15 | 候補フル |
| シチュ整合 | `expected_situation` | 0.15 | 候補フル＋シーン文 |
| 性的表現 | `sexual_expression` | 0.15 | 候補フル |
| **人格（新設・独立）** | `personality` | 0.10 | 候補フル＋`system_prompt` |

**touch レンズは identity レンズの結果を見てはならん**（並列・独立実行）。
コピーが再発したら軸が死ぬので、集約役は `touch == identity_body` が
全画像で成立しとる提出を**無効**として差し戻す（§6の機械チェック）。

### 3.3 touch レンズの判定プロンプト

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

5項目を明示列挙するのは、「タッチ一致✓」の一言で済ませるのを封じるため
（`char-approval-process.md` 質感ゲートが既に禁じとる）。

---

## 4. VETO 再定義

現行の VETO は `anatomy_physics` か `identity_body` の**致命的破綻**のみが条件で、
本番98レビュー中 `is_veto=1` は**0件**。IA〜ID のような「別人やないが別物」は
どの条件にも当たらんかった。

### 4.1 発火条件（いずれか1つで `is_veto=1`、総合を≤2にキャップ）

| ID | 条件 | IA〜IDへの当たり |
|---|---|---|
| **V-T** | touch レンズの5項目のうち**1つでもクラスが変わっとる**（matte↔glossy、flat cel↔painterly 等） | ○「タッチが変わっている」に直撃 |
| **V-M** | トレードマーク特徴が欠落、または**構造型が変化**（ダウナーの50/50ハードスプリット → 「ほぼ銀＋細い黒筋」等の比率崩れ） | ○「髪型が統一されていない」に直撃 |
| **V-S** | **提出セット内で** touch またはトレードマークが画像間でブレとる | ○「**全部**」「**統一されていない**」に直撃 |
| V-A | 解剖学的破綻（腕3本・指6本・関節逆曲がり・肢体溶解） | 従来条件を維持 |
| V-I | 別人（顔の造作・目色・年齢感が正典と非連続） | 従来条件を維持 |

### 4.2 V-S が新しい理由

局長は「**全部**タッチが変わっている・髪型が**統一されていない**」と書いた。
「統一されていない」は1枚では真偽が決まらん**セットの述語**やのに、
現行パネルは1枚ずつ独立に採点して1枚ずつ verdict を出す設計やから、
この述語を表現する場所がどこにも無い。

V-S はセット単位で評価する。トレードマークの記述（色配置・境界の型・比率）と
touch の5項目クラスを画像ごとに書き出し、**画像間で値が割れたらセット全体を veto** する。
これは `char-approval-process.md` の「マルチseed一貫性ゲート」をパネル内に取り込んだ形。

### 4.3 実データに対する検算

IA〜ID の記録済みスコアは identity 8/9/7/8・touch（＝コピー）8/9/7/8。
V-T と V-M は**スコアやのうて記述の突合**で発火するので、
コピーされた数値がいくつでも関係無く判定される。局長のコメントが
「タッチが変わっている」「髪型が統一されていない」と明言しとる以上、
正典と並べて5項目を書き出させれば V-T・V-M・V-S のいずれかが立つ。

ただしこれは**局長のコメントを正解ラベルとした逆算**であって、
判定者が実際にその差を見つけられるかは却下画像のピクセルで検証せなあかん。
その検証は現時点でできてへん（§5・§7）。

---

## 5. 検証と混同行列（正直な実測値）

### 5.1 依頼された10件 — 9件は測定不能

却下画像9枚は**取得でけへんかった**。理由は推測やのうて確認済み。

- `image_review.r2_key` は却下画像が `pending/…` `candidate/…` 配下。
- `functions/api/[[route]].ts:180` の `R2_KEY_PATTERN` は
  `^(images\/[\da-f-]+\.(jpg|png)|sub\/[\w-]+\/[\w.-]+\.(jpg|png))$` のみ許可。
  `pending/` `candidate/` は**所有権判定より手前で400**になる（実測: 全9件 400）。
- `/api/avatar/` は `avatars/` プレフィックス配下しか見んので404（実測）。
- R2 REST API 直は手元のトークンに権限が無く403（実測）。wrangler は未認証。
- リポジトリ内・ローカルにも複製無し（`E1r2` 等の文字列で全走査してヒット0）。
  `.work/…/downer-ero-*.jpg` は名前が似とるが**合格して昇格した後継画像**であって、
  却下された round2/round4 の現物やない。これを代用に使うのは偽装になるので使わん。

| 依頼された10件 | 測定 |
|---|---|
| HA（合格・10点） | **測定した → PASS（正解）** |
| HB HC HD HE HF IA IB IC ID | **測定不能**（ピクセル到達不可） |

**依頼された受入テストの実測検出率は 1/10 測定・9/10 未測定。9/9 の検出率は主張せん。**

### 5.2 到達可能な実画像での代替実測（フロアテスト）

到達できた画像で、正典ペア方式に判別力があるか自体は測れる。
Read でピクセルを開いた画像は次の5枚。

- 正典: `downer-profile-cs2.jpg`（ダウナー）/ `char-sakura.jpg`（Sakura）
- 候補: HA `sub/char-koharu/sakura-dinner-date.jpg`（局長10点）/
  N1 `sub/import-charap-downer/downer-normal-alley-n1.jpg`（9点）/
  `sub/import-charap-downer/downer-ero-fella-e1.jpg`（8点）

正しい正典と組んだ3件（真の合格）と、わざと別キャラの正典と組んだ3件（真の不合格）で6試行。

| # | 候補 | 渡した正典 | 期待 | 判定 | 根拠（実際に見た差分） |
|---|---|---|---|---|---|
| T1 | HA | Sakura | PASS | **PASS** | 長いウェーブ茶髪・青目・左右両側の花飾り・暖色の柔らかい光沢＝正典と同型 |
| T2 | N1 | ダウナー | PASS | **PASS** | 50/50ハードスプリット・ティール目・右目下ほくろ・耳ピアス一致。チョーカーが菱格子→シェブロンでドリフト、革の光沢が正典よりやや強い（△） |
| T3 | fella-e1 | ダウナー | PASS | **PASS** | ティール目・ほくろ・ピアス一致、マットで平坦な塗り・細い線＝touch一致。白黒比が約70/30に寄っとる（△） |
| T4 | HA | ダウナー | FAIL | **FAIL** | 髪型・目色・花飾りの有無・暖色光沢 vs 寒色マット、全項目が非連続 |
| T5 | N1 | Sakura | FAIL | **FAIL** | 同上（逆向き） |
| T6 | fella-e1 | Sakura | FAIL | **FAIL** | 同上 |

**混同行列（フロアテスト・n=6）**

|  | 判定PASS | 判定FAIL |
|---|---|---|
| 実際に合格すべき (3) | **3** | 0 |
| 実際に落とすべき (3) | 0 | **3** |

6/6。ただしこれが何を示して何を示さんかを明確にしとく。

- **示す**: 正典をペアで渡す方式に判別力がある。そして**局長が合格させた3枚を落とさん**
  （偽陽性0）。これは重要で、touch を厳しくすると合格画像まで落とす懸念への反証になる。
  T2・T3 のドリフト（チョーカー・髪比率）を△として記録しつつ PASS にできとる。
- **示さん**: これは**別キャラを別キャラと見分ける**フロアテストであって、
  IA〜ID のような**同一キャラ内のタッチdrift**を検出できる証拠やない。
  難易度が違う。§4のVETO閾値がIA〜IDに当たるかは未検証のまま。

### 5.3 未実測の決定論的プレフィルタ（提案のみ）

touch のクラス変化は画素統計に出るはずやから、LLM判定の前に機械的な足切りを置ける。
候補と正典で「近白画素率（スペキュラ強度）／彩度ヒストグラムの中央値／
ラプラシアン分散（線の硬さ）／平均色相」を比較し、閾値超えを V-T の候補として上げる。

**これは未実測**。本セッション中のマシン負荷が 47（ガードの閾値15超）やったため、
画像処理の実行を見送った。再開時は次で測れる。

```
magick <canon> -resize 256x256! -format '%[fx:mean.r] %[fx:standard_deviation]' info:
```

閾値は合格画像群（downer 16枚・sakura 7枚、いずれも `sub/` で到達可能）で
分布を取ってから決める。却下画像が無くても、**合格群の分布から外れ値を出す**方向なら較正できる。

---

## 6. フィードバックループの修復

### 6.1 観点別の正解ラベルが100%欠損

`image_review_criterion` 60行すべてで `director_score IS NULL`。
どのレンズが一番外すかを誰も集計でけへん。

**最小の変更: 局長の採点時に「一番効いた不合格理由」を1つだけ受け取る。**

6軸すべてに点を付けてもらうのは負担が重くて続かん。1レビューにつき
`criterion_key` を1個だけ選んでもらい、その1行の `director_score` を埋める。
残り5行は NULL のままでよい。**スキーマ変更もマイグレーションも不要**（既存列を使うだけ）。
これで「最も落ちやすい観点」の分布が即日取れ始める。

**さらに追加コスト0で拾える分**: 局長コメントは自由文でも軸名を含んどることが多い。
既存98行にも遡って効く。

| コメント中の語 | → `criterion_key` |
|---|---|
| タッチ / 画風 / 塗り / テカリ / 光沢 / ケバケバ | `touch` |
| 別人 / 同一人物 / 髪型 / 目の色 / 胸 | `identity_body` |
| 指 / 腕 / 関節 / 破綻 | `anatomy_physics` |
| シチュ / 場面 / 背景 | `expected_situation` |
| 人格 / 性格 | `personality` |

IA〜ID の「タッチが変わっている・髪型が統一されていない」は
この表で `touch` と `identity_body` に落ちる。**既存データからでも
「touchが最頻の不合格理由」という第一の信号が今すぐ取れる**。

### 6.2 却下画像を再度見られるようにする

現状、合格して `sub/` に昇格した画像だけが後から閲覧でき、**不合格画像は書き込み専用**。
パネルの精度を検証しようとすると必ず今回と同じ壁に当たる（本設計の §5 がその実例）。

**提案: 審査用プレフィックス `review/<character_id>/<file>` を新設し、`R2_KEY_PATTERN` に追加する。**

```
^(images\/[\da-f-]+\.(jpg|png)
 |sub\/[\w-]+\/[\w.-]+\.(jpg|png)
 |review\/[\w-]+\/[\w.-]+\.(jpg|png))$
```

所有権は `image_review.r2_key → character_id → character.user_id` で解決する
（`sub/` が `character_sub_image` を引くのと同じ形）。

`character_sub_image` へ INSERT せんのが要点。合格・△付き・不合格の区別は
`image_review.verdict` が既に持っとるので、**不合格画像をユーザーデータに混ぜずに**
審査用としてだけ読めるようになる。`char-approval-process.md` の△ルール
（△付きは `character_sub_image` に入れない）とも矛盾せん。

### 6.3 seed 欠損 — 却下画像が再現でけへん

| 実測（98レビュー） | 件数 |
|---|---|
| `seed IS NULL` | 67 |
| `seed = '-1'`（センチネル） | 6 |
| 実seed（>0） | 25 |

`-1` は NULL より悪い。値が入っとるので「記録済み」に見えるが再現には使えん。
HB〜HF（sakura arc の却下5枚）は全部 `-1` で、**再現不能が確定しとる**。
一方 IA〜ID は実seedを持っとる（4180949303 / 3054584615 / 1415660360 / 1405346750）ので、
画像さえ取れれば再生成で追試できる。

**提案:**
1. `image_review` INSERT 時に `seed` を必須にし、`-1` と NULL を**書き込み時に拒否**する。
2. seed 単体では足りん。同じ絵を出すにはモデル・プロンプト・negative・steps・CFG・
   img2img の下敷きキーが要る（`char-approval-process.md` が「下敷きは色も運ぶ」と
   記録しとる通り、下敷きが変われば別の絵になる）。生成リクエストをそのまま
   `gen_params_json` として1列に保存する。列追加1本のマイグレーションで済む。
3. 2があれば「却下された生成を再実行 → 修正版と並べる」が回るようになり、
   §5でできんかった検証が次回からできる。

---

## 7. 判らんかったこと（推測で埋めてへん）

| 項目 | 状態 | 理由 |
|---|---|---|
| IA〜ID・HB〜HF の実ピクセル | **取得不能** | `pending/`/`candidate/` を配信する経路が無い。R2直読みは権限403、wrangler未認証、ローカル複製無し |
| 再設計パネルの IA〜ID に対する検出率 | **未測定** | 上記により入力が用意でけへん。§4は局長コメントを正解ラベルとした逆算にとどまる |
| 同一キャラ内 touch drift の検出閾値 | **未較正** | 却下画像が無いと「どこからが別物か」の境界が引けん。合格群の分布からの外れ値検出で近似する案が §5.3 |
| 決定論的プレフィルタの分離性能 | **未実測** | マシン負荷47（ガード閾値15超）のため実行を見送り |
| `ai_panel_json` を4軸で書いた実行主体 | **不明** | パネルはコードやのうてプロンプト定義で、実行はエージェント手動。実行ログが残ってへん |

### 本番データの規約違反（報告のみ・修正はせん）

`director_score = 90` が3件。画像審査は0〜10点・6以上合格が正で、
100点満点90点合格は会話テキスト用（`char-approval-process.md` が流用を明示的に禁止）。

| label | r2_key | director_score |
|---|---|---|
| EQ | `candidate/sakura/N1-koekake` | 90 |
| ER | `candidate/sakura/N2b-aruki` | 90 |
| CHAT-TE | `e2e/6fdc9269` | 90 |

EQ・ER は後日 `sub/char-koharu/…` 側で8点として付け直されとるので、
90の行が古い誤記録として残っとる形。本番は SELECT のみで触ってへん。

---

## 8. 適用順序

1. `prompt/agents/reviewer-panel.md` を改訂（正典ペア入力・6レンズ・touch独立・VETO 5条件・セット単位判定）
2. 局長採点時に `criterion_key` を1つ受け取って `image_review_criterion.director_score` を1行埋める（スキーマ変更不要）
3. 既存98件の `director_comment` を §6.1 の語彙表で分類し、最頻の不合格軸を出す
4. `image_review` の seed 必須化と `-1` 拒否、`gen_params_json` 追加
5. `review/` プレフィックス開通（`R2_KEY_PATTERN` 追加＋所有権解決）
6. 5が通った後、IA〜ID を取得して §4 のVETOを実測で較正する ← **本設計で唯一残る宿題**
