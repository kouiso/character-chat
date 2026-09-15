-- キャラ設定に無い枠を、本番の champion プロンプトからも外す。
--
-- prompt-variant-defaults.ts を直しても、実際に配られるのは D1 の prompt_variant 行。
-- 2026-07-26 実測: prompt-variant-seed-platform_scene（champion）が
-- 「erotic 以降は禁止」の台詞禁止リストと「受動的であってはいけない」を持っとった。
-- コードだけ直すと本番は変わらんまま。
--
-- 置換であって削除やない。長さの帳尻を合わせるためやのうて、品質指示
-- （具体描写・足踏み禁止）は残して、態度の指定だけを落とすため。

UPDATE prompt_variant
SET body = REPLACE(
  body,
  '[Character agency in sex scenes]
性行為中のキャラクターは受動的であってはいけない。
- 「待って」「ダメ」は intimate phase まで。erotic 以降は禁止。
- erotic phase では積極的に快楽を求める描写を書くこと。
- 身体が勝手に反応する描写（腰が動く、締めつける、足が絡む）を必ず含めること。',
  '[Character reaction in sex scenes]
反応の中身はキャラ設定が決める。設定に無い態度をここで足さん。
- どんな反応であれ、平坦な語りやのうて具体的な身体描写で書くこと。
- 同じ短い台詞を毎ターン繰り返して場面を止めんこと。'
)
WHERE body LIKE '%erotic 以降は禁止%';

UPDATE prompt_variant
SET body = REPLACE(
  body,
  'ユーザーが「中に出す」「注ぐ」「射精」「中出し」と明示したら、キャラの声でその場の射精を必ず受け止める。',
  'ユーザーが「中に出す」「注ぐ」「射精」「中出し」と明示したら、その出来事をキャラの声で必ず描く。反応の中身はキャラ設定に従う。'
)
WHERE body LIKE '%必ず受け止める%';

-- 同じ body の別ブロックに態度の指定が残っとった。上の [Character reaction in sex scenes] を
-- 置き換えても、この2行が羞恥と押し引きの型を先に決めてまうため一緒に外す。

UPDATE prompt_variant
SET body = REPLACE(
  body,
  '- 心理描写を混ぜる: 身体の快感だけでなく、「こんなの初めて」「手が勝手にシーツを掴む」「恥ずかしいのに止められない」など、心の葛藤や驚きを挟む',
  '- 心理描写を混ぜる: 身体の快感だけで終わらせず、その瞬間の内心も書く。内心の中身はキャラ設定に従う'
)
WHERE body LIKE '%心の葛藤や驚きを挟む%';

-- foreplay を最低2ターン維持する要件は直前の行に残る。落とすのは押し引きの型指定だけ。
UPDATE prompt_variant
SET body = REPLACE(
  body,
  '
  キャラが積極的になりかけて→恥ずかしくなって止まる→でもやっぱり求める、というプッシュ＆プルを書く。',
  ''
)
WHERE body LIKE '%プッシュ＆プル%';
