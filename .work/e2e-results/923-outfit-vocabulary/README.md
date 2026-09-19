# #923 衣装タグ語彙 — 実生成による検証

画像そのものは `.gitignore:70`（`.work/**/*.jpg`）で追跡対象外。生成した 8 枚は
このディレクトリにローカル保存してあり、判定は生成した本人がピクセルを開いて行った。

対象キャラ: `import-charap-ダウナーお姉さんに拾われる話`
モデル: `waiNSFWIllustrious_v90_1187991.safetensors`（Novita txt2img 直叩き）
共通条件: 768x768 / Euler a / steps 28 / guidance 6 / seed 101,202,303,404 / 同一シーン文4種

identity 部分（`buildIdentityPrompt` の出力を本番 D1 の `character_visual` から再現）:

```
silver hair, messy hair, short hair, blue eyes, fair skin, slender, small breasts,
18 years old, young adult woman, adult body proportions
```

衣装部分だけを差し替えた A/B。seed もシーンも同一なので、絵の違いは衣装タグだけに帰属する。

| 画像 | 衣装タグ | 上衣 | choker | ear piercing |
|---|---|---|---|---|
| `postfix-1..4.jpg` | `casual, choker, ear_piercing` | 1:ジャージ / 2:キャミソール / 3:キャミソール / 4:Tシャツ | 4/4 | 4/4 |
| `vocab-1..4.jpg` | `hoodie, choker, ear_piercing` | 4/4 パーカー | 4/4 | 4/4 |

## 読み取れること

1. 語彙内の衣服タグ（`hoodie`）は 4/4 で絵に出る。装飾（`choker` / `ear_piercing`）も 4/4。
   「登録した衣装が絵に反映される」は語彙内の語なら成立する。
2. `casual` は danbooru に 50,013 枚ある実在タグやが、**どの服になるかを決められん**。
   4 枚中 2 枚が issue に書かれた不具合と同じキャミソールになった。
   このため `casual` は衣装語彙（主辞）から外し、修飾語としてのみ残した
   （`casual_hoodie` は通る）。実在するだけでは足りん、という反証がこの 4 枚。
3. 元の登録値 `casual_top` は語彙内の語を一語も含まんので保存されんくなる。
   このキャラの是正後の登録値は `choker` / `ear_piercing` の 2 件。
   衣服が 0 件になるのは「元データに実在する衣服の記述が無かった」ことの反映であって、
   無い根拠から服を推測して埋めることはせん。

`hoodie` はこのキャラの正典やない。語彙内タグが絵を支配することを示すための検証用の値で、
本番 D1 へは書かん。
