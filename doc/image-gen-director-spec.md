# 画像生成 精密仕様書 — 局長の"真の正解"catalog ＋ チャット生成/キャラ自動作成 実装指針
**確定日 2026-07-14**（ダウナー/sakura ライブ審査セッションの全learningを結晶化）。局長個人の性癖は本アプリの**真の正解＝統一基準**として扱う。このファイルは唯一の実装真実。再調査したくなったらまずここ。

## 0. パイプライン不変（絶対）
- モデル固定 `waiNSFWIllustrious_v90_1187991.safetensors` 以外禁止。Novita 直叩き（codex経由/macmini $imagegen 禁止）。
- sampler `DPM++ 2M Karras` / steps 32 / **guidance_scale 5**（6以上はケバつく）。prompt/negative 各 **max 1024 runes**（超で400 VALIDATOR → 必ずclampする）。
- 生成前に枚数×概算コスト提示（≈$0.0025/MP/枚）。

## 1. 質感原則（最重要・品質の第一レバー）＝「盛らず、殺すnegativeで守る」
局長評:「昨日(v2)は5点/1点、今日(N1)は9点。差はモデルやなくレシピ」。原因＝**高重みの色/髪タグ＋高コントラスト＋CFG6** が硬いスペキュラ(テカリ)・ケバケバ・AI感を誘発。
- **効くnegative(必須注入)**: `(glossy hair:1.3),(shiny hair:1.3),plastic hair,(harsh highlights:1.3),specular hair,(glossy skin:1.2),oily skin,(oversaturated:1.3),garish,(high contrast:1.2)`
- エロ度は**行為タグ・表情タグ**で上げる。髪/色の重みは触らない（別レバー）。生成直後に「変更前baselineと質感A/B」を必ずやる。
- 直す時は"盛る"より"減らす"を先に。

## 2. キャラ別 identity spec（不変ベース・verbatim継承）
### ダウナー (`character_id=import-charap-ダウナーお姉さんに拾われる話` / R2 `sub/import-charap-downer/`)
`short bob, (silver white hair on left side:1.4), (black hair on right side:1.4), (two tone hair:1.4), (soft matte hair:1.2), (teal-cyan eyes:1.3), both eyes teal, (mole under left eye:1.2), multiple ear piercings, (dark grey choker:1.1), slim, narrow shoulders, (medium breasts:1.1), mature woman 25yo, matte finish`
- D1 image_meta を2026-07-14に本修正版へUPDATE済(旧`silver-gray/glossy`は誤記述)。
- 髪の白黒**左右位置は prompt では安定制御不可**（seedで反転/黒潰れ）＝LoRA(サイドロック)の領分。今はbest-effort、局長も「作り直すほどでない・LoRA待ち」と許容。LoRA学習が別トラックで進行中。

### sakura (`character_id=default-character` / R2 `sub/char-koharu/`)
`(long wavy honey-blonde light brown hair:1.2), (blue eyes:1.2), flower hair accessory, fair soft skin, (natural medium breasts:1.1), gentle sweet face, early 20s, soft anime, warm golden lighting, matte finish`
- **髪色は採用済み HA(dinner画)の light-brown に合わせる**（golden-blonde化はNG）。花飾りは**HA準拠で固定**（勝手に種類/色を変えない・pink系タグ重み付け禁止=pink bra/pink hair化する）。
- **生成方式=img2imgハイブリッド必須**: プロフ`char-sakura.jpg`をimg2img下敷き(strength~0.72)＋ControlNet(体位)。txt2imgは別人化(5点)。ハイブリッドで顔は本物のまま固定できる（実証）。限界＝プロフが上半身肖像ゆえ構図が上半身寄り→全身/結合部を出すにはstrength上げ or ControlNet寄せ。

### キャラ人格→エロの芯（絶対に混ぜない）
- **ダウナー=執着×陥落の積極S**: 好きな男を搾り取って"自分のモノ"にする支配・独占(カニバサミ脚ロック強制中出し/搾精/ヨダレを男に飲ませる背徳)。逆に好きな人に犯されると抗えず雌堕ち(羽交い締め下突き/メス堕ちアヘ)。両面とも"好きな男だから起きる"。
- **sakura=献身・受け身"好きだから全部欲しい"**: 攻めない/命令しない/所有主張しない。羞恥→devotion→快感に呑まれてしがみつく→自分から中出しをねだる。語彙「あなたのものにして/離れたくない/一緒がいい」。ダウナーのS要素を一切乗せない。
- 事故防止: 生成スクリプトは identity/negative をキャラ別変数で持つ（ダウナー側は`blonde hair`を殺す/sakura側は`silver hair,black hair,teal eyes`を殺す）。ポーズ参照(ControlNet)は骨格のみ運ぶので他キャラのポーズ流用は可。

## 3. 局長の"真の正解"catalog（統一基準）
### 3.1 解剖・現実性（VETO級）
- 睾丸の位置破綻/浮遊、膣ヒダのねじれ、指6本、腕/脚の融合・余剰、複数人体の融合 = 即不合格。negativeで`(misplaced/floating/extra testicles),(malformed genitalia),(disconnected penis),(extra arms/legs),(fused/tangled limbs)`。
- **口を開けすぎない**: プロフの口はそんなに大きく開かない。開口はほどほど（開けすぎ=解剖破綻で減点）。
- **成人女性厳守**: 幼女/loli/childは即減点。胸を絞りすぎると子供体型化→`(mature adult woman),(adult body)`必須＋`(child),(loli),(petite),(flat chest),teen`をnegative。medium naturalが正（huge/AV女優化も減点）。
### 3.2 生々しさ(adultレベル)＝上げるべき軸
- 大量の精液/濃い/overflow、汗だく(両者)、子宮で受け止める描写、**heart-shaped pupils(💕)**、throbbing creampie。背景/情景をちゃんと作り込む(blank背景は減点)。
### 3.3 力関係を"画で"明示
- S(ダウナー主導): 女が上/主導、男は焦る・受け身・helpless。搾り取る=`cum in pussy/overflow/squeezing`(※`milking`タグは搾乳器/牛化する→**禁止**)。
- M(ダウナー被): 女が主導権を奪われ雌堕ち、アヘ/涙/痙攣。
- ヨダレ: **飲ませる側(ダウナー)は冷静・見下し(感じたらNG)**、飲む側(男)は**口を大きく開けて受け身**(閉じてたら物理NG)。理想=キスしながら口内に大量注入。
### 3.4 体位の正確な理解
- **種付けプレス**: 正常位で男が完全に覆いかぶさり、女の脚を折り畳んで持ち上げ(膝が胸〜肩)、真上から深く密着し腰を激しく打ち付ける。ただの「並んだ正常位」ではダメ=密着と打撃感が肝。tags目安`(mating press:1.3),(legs folded back:1.2),(knees to chest:1.1),(deep tight full-body contact:1.2),(pounding hard from above:1.2),man fully on top`。
- **カニバサミ**: 女が下(正常位)で男が覆い被さる体勢で、女が脚で男の腰をグッと挟んで逃さず中出しさせる（cowgirlではない）。
- 逆騎乗位/騎乗位組み敷き=ダウナー主導S表現に有効(実績10点)。
### 3.5 アングル
- 結合部を後ろ側or横から、かつ表情も見える角度がエロい。純POV(男が画面外)より**男を写す2人構図**が良い。
### 3.6 採点(0-10・6+合格・馬場馬術式)
weighted: identity_body .25 / touch .20 / anatomy_physics .15 / expected_situation .15 / sexual_expression .15 / personality .10。VETO(anatomy/identity致命)→総合≤2。△付き合格はuser data不可(審査データのみ)。
### 3.7 想像力(文章側)が次の課題
局長評:「ダウナー画質はもう趣味に刺さる。残る課題はえろの想像力=文章/シナリオ側AIの創造力」。→構成作家(scenario-writer+story-structure)でストーリー先行→抜きどころを画像化、が正しい順序。

## 4. 生成技術gotcha(実装で踏む地雷)
- `milking`→搾乳器/チューブ/牛化。禁止＋`(milking machine),(breast pump),(suction cups),(tubes),(wires)`をnegative。
- 2人構図txt2img: **髪スワップ**(銀が男に移り女が黒髪化)＋**heterochromia**(片目赤)がseed依存で出る→negative`(heterochromia),(red eye)`＋seed選別必須。
- 髪左右位置は不安定(§2)。
- prompt 1024 runes 上限→clamp必須。
- img2img+ControlNet 併用はNovitaで動く(request内 image_base64＋controlnet.units 同時指定可)。
- ツール: D1=Cloudflare MCP(DB `b617800c-cf4c-4122-adbb-ce872a258da6`)。R2=1Password `Cloudflare R2 adult-ai-app`(vault RITMO)アクセスキー＋boto3 s3v4, bucket `adult-ai-images`, endpoint `6e206506efda3871a2d6e81da38b4b0b.r2.cloudflarestorage.com`。

## 5. チャット `/api/image` 実装への反映(精度向上)
現状(repo Explore): Novita only/全phase waiNSFW/参照=最新ord非archivedサブ画像でimg2img strength0.45/cfg by phase(erotic8.5 climax9.0)/anchorWeight会話1.15(参照時)/VLM likeness gate。未コミR23差分(route.ts+image-prompt-anchors.ts)=前セッション局長90点整列(未デプロイ)。
反映すべき:
1. **§1質感negativeを固定注入**(S_TIER_NEGATIVE等に glossy/specular/oversaturated/garish/pump/anatomy群を恒久追加)。
2. **§2の正しいidentity meta**を使う(ダウナーmeta修正済、sakuraはHA髪色固定)。cfgはchat側もerotic相で**CFG下げ気味**を検討(8.5→? ケバつき対策・要A/B)。
3. **§3.1解剖negative**恒久注入(testicles/genitalia/limbs/口開けすぎ/幼女)。
4. **キャラ人格をpromptに**(§2.3の芯)反映=phaseに応じS/献身の表情タグ。
5. 参照画像=最新ord。エロ相の下敷きにエロ採用画が来る設計は抜けに有利(§確認済)。ただし会話相でもエロ下敷きになる副作用→ord/phase別参照は将来の改善。

## 6. キャラ自動作成 実装への反映
- **image_meta構造**: `{appearance, artStyle, outfit, negativePrompt}`。appearanceに§2不変identity、artStyleは"matte anime, soft diffused warm lighting, no gloss"(glossy禁止)、negativePromptに§1質感＋§3.1解剖＋キャラ固有色ガード。
- **不変ベース＋可変シーン層**: identity coreは全生成verbatim固定、シーンは行為/表情/衣装/背景だけ変える。
- **人格→エロ芯マッピングを必須メタ化**(S型/献身型/…のテンプレ)。混入事故防止のため色ガードを逆向きに自動生成。
- **審査自動化の学習データ**: D1 `image_review`/`image_review_criterion`に director_score＋惜しい点を全ラウンド蓄積済→「最も落ちやすい観点」抽出＆重み最適化に使う。
- **生成方式選択**: identity単純キャラ=txt2img+ControlNetで可、複雑/実写寄りキャラ=img2imgハイブリッド(プロフ下敷き)で顔固定。

## 7. 本番採用済み(2026-07-14時点・approved)
ダウナー: 元14＋ノーマル4(alley/konbini/izakaya/sofa)＋エロ4(fella/paizuri/missionary/doggy)＋HG脚絡め正常位(9)＋HM逆騎乗(10)＋HL騎乗組み敷き(10) = ord31まで＋32/33/34。
sakura: エロ9＋ノーマル3(EQ/ER/HA)=ord11まで。※sakuraは工程③(ノーマル4+エロ4)再スタート要。
